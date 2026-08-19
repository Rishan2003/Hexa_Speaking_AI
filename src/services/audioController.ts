/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AudioDeviceState,
  LocalRecordingState,
  BrowserAudioControllerOptions
} from '../types';

/**
 * Interface contract for Browser Audio Controller
 */
export interface BrowserAudioController {
  initialize(options?: BrowserAudioControllerOptions): Promise<void>;
  startMicrophone(deviceId?: string): Promise<MediaStream | null>;
  stopMicrophone(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  getInputLevel(): number;
  getMediaStream(): MediaStream | null;
  getAudioContext(): AudioContext | null;

  // Remote Examiner Audio Playback Queue
  playAudioChunk(data: ArrayBuffer | Float32Array | Int16Array, sampleRate?: number): Promise<void>;
  clearAudioQueue(): void;
  resumeAudioContextIfNeeded(): Promise<void>;

  // Optional Local Recording
  startRecording(): boolean;
  stopRecording(): Promise<Blob | null>;
  deleteRecording(): void;
  setRecordingConsent(consent: boolean): void;
  getRecordingState(): LocalRecordingState;

  // Device & Permission State
  getDeviceState(): AudioDeviceState;
  dispose(): void;
}

/**
 * Browser Audio Controller implementation utilizing Web Audio API & MediaRecorder
 */
export class BrowserAudioControllerService implements BrowserAudioController {
  private options: BrowserAudioControllerOptions = {};
  
  private deviceState: AudioDeviceState = {
    permissionState: 'prompt',
    devices: [],
    selectedDeviceId: null,
    isMuted: false,
    inputLevel: 0,
    error: null,
  };

  private recordingState: LocalRecordingState = {
    isRecording: false,
    isSupported: false,
    consentGiven: false,
    durationSeconds: 0,
    recordingBlob: null,
    recordingUrl: null,
    mimeType: null,
  };

  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private processingSinkGain: GainNode | null = null;

  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingTimer: NodeJS.Timeout | null = null;
  private animFrameId: number | null = null;

  private activeAudioSources: Set<AudioBufferSourceNode> = new Set();
  private nextScheduledTime: number = 0;
  private gestureListenersAttached: boolean = false;

  constructor(options?: BrowserAudioControllerOptions) {
    if (options) {
      this.options = { ...options };
      if (options.userConsentForRecording !== undefined) {
        this.recordingState.consentGiven = options.userConsentForRecording;
      }
    }
  }

  /**
   * Initializes device enumeration, feature detection, and mobile gesture handlers
   */
  public async initialize(options?: BrowserAudioControllerOptions): Promise<void> {
    if (options) {
      this.options = { ...this.options, ...options };
      if (options.userConsentForRecording !== undefined) {
        this.recordingState.consentGiven = options.userConsentForRecording;
      }
    }

    // Check MediaRecorder support & preferred mimeType
    this.detectMediaRecorderSupport();

    // Query device permission state & devices if supported
    await this.refreshDevices();

    // Attach mobile touch/click listeners to auto-resume AudioContext on first gesture
    this.attachUserGestureListeners();
  }

  private detectMediaRecorderSupport(): void {
    if (typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined') {
      this.recordingState.isSupported = true;
      this.recordingState.mimeType = this.getPreferredMimeType();
    } else {
      this.recordingState.isSupported = false;
      this.recordingState.mimeType = null;
    }
    this.notifyRecordingState();
  }

  private getPreferredMimeType(): string | null {
    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      return null;
    }

    const candidateTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg'
    ];

    if (typeof MediaRecorder.isTypeSupported === 'function') {
      for (const type of candidateTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          return type;
        }
      }
    }

    return null;
  }

  /**
   * Refresh available input devices and query permission status
   */
  public async refreshDevices(): Promise<MediaDeviceInfo[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      this.deviceState.permissionState = 'unsupported';
      this.notifyDeviceState();
      return [];
    }

    try {
      // Check query permissions if supported by browser
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (perm.state === 'granted') {
            this.deviceState.permissionState = 'granted';
          } else if (perm.state === 'denied') {
            this.deviceState.permissionState = 'denied';
          } else {
            this.deviceState.permissionState = 'prompt';
          }
        } catch {
          // Ignore permissions query failure on unsupported browsers
        }
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
      this.deviceState.devices = audioInputs;

      if (audioInputs.length > 0 && !this.deviceState.selectedDeviceId) {
        this.deviceState.selectedDeviceId = audioInputs[0].deviceId || 'default';
      }

      this.notifyDeviceState();
      return audioInputs;
    } catch (err: any) {
      this.deviceState.error = err.message || 'Failed to enumerate devices';
      this.notifyDeviceState();
      return [];
    }
  }

  /**
   * Safely requests and opens the microphone stream
   */
  public async startMicrophone(deviceId?: string): Promise<MediaStream | null> {
    // Create and resume the AudioContext immediately inside the user's click/tap.
    // Creating it only after awaiting getUserMedia loses transient user activation
    // in Chrome/Safari, leaving both microphone processing and examiner playback silent.
    const audioContext = this.ensureAudioContext();
    if (audioContext?.state === 'suspended') {
      void audioContext.resume().catch((err) => {
        console.warn('AudioContext could not be unlocked during microphone start:', err);
      });
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.deviceState.permissionState = 'unsupported';
      this.deviceState.error = 'Browser does not support getUserMedia audio capture.';
      this.notifyDeviceState();
      return null;
    }

    // Stop existing stream first to avoid resource locks
    this.stopMicrophoneStream();

    const targetDeviceId = deviceId || this.deviceState.selectedDeviceId;
    let stream: MediaStream | null = null;

    try {
      const audioConstraints: MediaTrackConstraints = {
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      if (targetDeviceId && targetDeviceId !== 'default') {
        audioConstraints.deviceId = { exact: targetDeviceId };
      }

      const constraints: MediaStreamConstraints = {
        audio: audioConstraints
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      // Fallback: If exact deviceId constraint failed, try standard 16kHz audio constraint
      if (targetDeviceId && targetDeviceId !== 'default') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: 16000, echoCancellation: true, noiseSuppression: true } 
          });
        } catch (fallbackErr: any) {
          err = fallbackErr;
        }
      }

      if (!stream) {
        const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
        this.deviceState.permissionState = isDenied ? 'denied' : 'unsupported';
        this.deviceState.error = isDenied
          ? 'Microphone access denied by user or system policy.'
          : (err.message || 'Failed to open microphone stream.');
        this.notifyDeviceState();
        return null;
      }
    }

    this.mediaStream = stream;
    this.deviceState.permissionState = 'granted';
    this.deviceState.error = null;
    this.deviceState.isMuted = false;

    // Track chosen deviceId
    const tracks = stream.getAudioTracks();
    if (tracks.length > 0) {
      const settings = tracks[0].getSettings();
      if (settings.deviceId) {
        this.deviceState.selectedDeviceId = settings.deviceId;
      }
    }

    // Refresh devices list since permissions granted allows full device labels
    await this.refreshDevices();

    // Setup Web Audio API nodes for input level monitoring & PCM extraction
    this.setupAudioNodes(stream);
    await this.resumeAudioContextIfNeeded();

    this.notifyDeviceState();
    return stream;
  }

  /**
   * Setup Web Audio nodes (AudioContext -> Analyser)
   */
  private setupAudioNodes(stream: MediaStream): void {
    try {
      const audioContext = this.ensureAudioContext();
      if (!audioContext) return;

      this.sourceNode = audioContext.createMediaStreamSource(stream);
      this.analyserNode = audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.sourceNode.connect(this.analyserNode);

      // Start input level detection loop without storing raw audio
      this.startInputLevelMonitoring();

      // Setup optional PCM chunk capture for future Live provider
      if (this.options.onAudioChunk) {
        this.setupScriptProcessorNode();
      }
    } catch (err) {
      console.warn('Web Audio API initialization warning:', err);
    }
  }

  /**
   * Input level monitoring loop (RMS calculation normalized 0 - 100)
   */
  private startInputLevelMonitoring(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }

    const dataArray = new Uint8Array(this.analyserNode ? this.analyserNode.frequencyBinCount : 0);

    const updateLevel = () => {
      if (!this.analyserNode || !this.mediaStream || this.deviceState.isMuted) {
        this.deviceState.inputLevel = 0;
        if (this.options.onInputLevelChange) {
          this.options.onInputLevelChange(0);
        }
        return;
      }

      this.analyserNode.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const normalizedLevel = Math.min(100, Math.round((avg / 128) * 100));

      this.deviceState.inputLevel = normalizedLevel;
      if (this.options.onInputLevelChange) {
        this.options.onInputLevelChange(normalizedLevel);
      }

      this.animFrameId = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }

  /**
   * Optional PCM streaming processor
   */
  private setupScriptProcessorNode(): void {
    if (!this.audioContext || !this.sourceNode) return;

    try {
      this.scriptProcessor = this.audioContext.createScriptProcessor(512, 1, 1);
      this.scriptProcessor.onaudioprocess = (e) => {
        if (this.deviceState.isMuted || !this.options.onAudioChunk || !this.audioContext) return;

        const inputBuffer = e.inputBuffer.getChannelData(0);
        const targetSampleRate = this.options.sampleRate || 16_000;
        const normalizedInput = this.resampleFloat32(
          inputBuffer,
          this.audioContext.sampleRate,
          targetSampleRate
        );

        // Gemini Live expects signed 16-bit little-endian PCM at 16 kHz.
        const pcm16 = new Int16Array(normalizedInput.length);
        for (let i = 0; i < normalizedInput.length; i++) {
          const sample = Math.max(-1, Math.min(1, normalizedInput[i]));
          pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        this.options.onAudioChunk(pcm16);
      };

      this.sourceNode.connect(this.scriptProcessor);

      // ScriptProcessor must remain connected to an output to keep firing in
      // several browsers. Route it through a zero-gain sink so no microphone
      // signal is played back to the candidate.
      this.processingSinkGain = this.audioContext.createGain();
      this.processingSinkGain.gain.value = 0;
      this.scriptProcessor.connect(this.processingSinkGain);
      this.processingSinkGain.connect(this.audioContext.destination);
    } catch (e) {
      console.warn('ScriptProcessor setup warning:', e);
    }
  }

  private resampleFloat32(
    input: Float32Array,
    inputSampleRate: number,
    outputSampleRate: number
  ): Float32Array {
    if (input.length === 0 || inputSampleRate <= 0 || outputSampleRate <= 0) {
      return new Float32Array();
    }
    if (inputSampleRate === outputSampleRate) {
      return new Float32Array(input);
    }

    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const sourcePosition = i * ratio;
      const leftIndex = Math.floor(sourcePosition);
      const rightIndex = Math.min(leftIndex + 1, input.length - 1);
      const fraction = sourcePosition - leftIndex;
      output[i] = input[leftIndex] * (1 - fraction) + input[rightIndex] * fraction;
    }

    return output;
  }

  /**
   * Stop microphone stream and disconnect processing nodes
   */
  public stopMicrophone(): void {
    // If recording was active, stop recording first
    if (this.recordingState.isRecording) {
      this.stopRecording();
    }

    this.stopMicrophoneStream();
    this.deviceState.inputLevel = 0;
    this.notifyDeviceState();
  }

  private stopMicrophoneStream(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {}
      this.scriptProcessor = null;
    }

    if (this.processingSinkGain) {
      try {
        this.processingSinkGain.disconnect();
      } catch {}
      this.processingSinkGain = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {}
      this.analyserNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {}
      });
      this.mediaStream = null;
    }
  }

  /**
   * Mute or unmute the microphone without closing the session
   */
  public setMuted(muted: boolean): void {
    this.deviceState.isMuted = muted;

    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }

    if (muted) {
      this.deviceState.inputLevel = 0;
      if (this.options.onInputLevelChange) {
        this.options.onInputLevelChange(0);
      }
    } else if (this.mediaStream) {
      this.startInputLevelMonitoring();
    }

    this.notifyDeviceState();
  }

  public isMuted(): boolean {
    return this.deviceState.isMuted;
  }

  public getInputLevel(): number {
    return this.deviceState.inputLevel;
  }

  public getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Play remote examiner audio through AudioContext with controlled queue
   */
  public async playAudioChunk(
    data: ArrayBuffer | Float32Array | Int16Array,
    sampleRate: number = 24000
  ): Promise<void> {
    const audioContext = this.ensureAudioContext();
    if (!audioContext) return;

    await this.resumeAudioContextIfNeeded();
    if (audioContext.state !== 'running') {
      this.deviceState.error = 'Audio playback is blocked by the browser. Click the page once, then retry the session.';
      this.notifyDeviceState();
      return;
    }

    let float32Data: Float32Array;

    if (data instanceof Float32Array) {
      float32Data = data;
    } else if (data instanceof Int16Array) {
      float32Data = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        float32Data[i] = data[i] / 32768.0;
      }
    } else {
      const int16 = new Int16Array(data);
      float32Data = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32Data[i] = int16[i] / 32768.0;
      }
    }

    if (float32Data.length === 0) return;

    try {
      const audioBuffer = audioContext.createBuffer(1, float32Data.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32Data);

      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(audioContext.destination);

      const currentTime = audioContext.currentTime;
      if (this.nextScheduledTime < currentTime) {
        this.nextScheduledTime = currentTime;
      }

      sourceNode.start(this.nextScheduledTime);
      this.nextScheduledTime += audioBuffer.duration;

      this.activeAudioSources.add(sourceNode);

      sourceNode.onended = () => {
        this.activeAudioSources.delete(sourceNode);
      };
    } catch (err) {
      console.warn('Audio queue playback error:', err);
    }
  }

  /**
   * Clear active remote audio queue
   */
  public clearAudioQueue(): void {
    this.activeAudioSources.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    });
    this.activeAudioSources.clear();
    if (this.audioContext) {
      this.nextScheduledTime = this.audioContext.currentTime;
    } else {
      this.nextScheduledTime = 0;
    }
  }

  /**
   * Create a browser-native AudioContext without forcing a hardware sample rate.
   * Input is resampled to 16 kHz before transmission and output buffers declare
   * their own 24 kHz sample rate, so using the device's native rate is safer.
   */
  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.audioContext && this.audioContext.state !== 'closed') return this.audioContext;

    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return null;

    try {
      this.audioContext = new AudioCtxClass({ latencyHint: 'interactive' });
    } catch {
      // Older Safari versions reject constructor options.
      this.audioContext = new AudioCtxClass();
    }
    return this.audioContext;
  }

  /**
   * Handle mobile browser user interaction requirement to resume AudioContext
   */
  public async resumeAudioContextIfNeeded(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (err) {
        console.warn('Could not resume AudioContext automatically:', err);
      }
    }
  }

  private attachUserGestureListeners(): void {
    if (this.gestureListenersAttached || typeof window === 'undefined') return;

    const resumeOnGesture = () => {
      this.resumeAudioContextIfNeeded();
      if (this.audioContext && this.audioContext.state === 'running') {
        window.removeEventListener('touchstart', resumeOnGesture);
        window.removeEventListener('click', resumeOnGesture);
        window.removeEventListener('keydown', resumeOnGesture);
        this.gestureListenersAttached = false;
      }
    };

    window.addEventListener('touchstart', resumeOnGesture, { passive: true });
    window.addEventListener('click', resumeOnGesture, { passive: true });
    window.addEventListener('keydown', resumeOnGesture, { passive: true });
    this.gestureListenersAttached = true;
  }

  /**
   * Optional Local Session Recording
   */
  public startRecording(): boolean {
    if (!this.recordingState.consentGiven) {
      console.warn('Cannot start recording: User recording consent flag is false.');
      return false;
    }

    if (!this.recordingState.isSupported || typeof window.MediaRecorder === 'undefined') {
      console.warn('MediaRecorder is unsupported in this environment.');
      return false;
    }

    if (!this.mediaStream) {
      console.warn('Cannot start recording: Microphone stream is inactive.');
      return false;
    }

    try {
      this.deleteRecording(); // Clear old recording if exists
      this.recordingChunks = [];

      const options: MediaRecorderOptions = {};
      if (this.recordingState.mimeType) {
        options.mimeType = this.recordingState.mimeType;
      }

      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordingChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const mimeType = this.recordingState.mimeType || 'audio/webm';
        const blob = new Blob(this.recordingChunks, { type: mimeType });
        this.recordingState.recordingBlob = blob;
        this.recordingState.recordingUrl = URL.createObjectURL(blob);
        this.recordingState.isRecording = false;
        this.notifyRecordingState();
      };

      this.mediaRecorder.start(1000); // 1s slice
      this.recordingState.isRecording = true;
      this.recordingState.durationSeconds = 0;

      if (this.recordingTimer) clearInterval(this.recordingTimer);
      this.recordingTimer = setInterval(() => {
        this.recordingState.durationSeconds += 1;
        this.notifyRecordingState();
      }, 1000);

      this.notifyRecordingState();
      return true;
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      this.recordingState.isRecording = false;
      this.notifyRecordingState();
      return false;
    }
  }

  public async stopRecording(): Promise<Blob | null> {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      this.recordingState.isRecording = false;
      this.notifyRecordingState();
      return this.recordingState.recordingBlob;
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.recordingState.mimeType || 'audio/webm';
        const blob = new Blob(this.recordingChunks, { type: mimeType });
        this.recordingState.recordingBlob = blob;
        this.recordingState.recordingUrl = URL.createObjectURL(blob);
        this.recordingState.isRecording = false;
        this.notifyRecordingState();
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  public deleteRecording(): void {
    if (this.recordingState.recordingUrl) {
      try {
        URL.revokeObjectURL(this.recordingState.recordingUrl);
      } catch {}
    }
    this.recordingState.recordingBlob = null;
    this.recordingState.recordingUrl = null;
    this.recordingState.durationSeconds = 0;
    this.recordingChunks = [];
    this.notifyRecordingState();
  }

  public setRecordingConsent(consent: boolean): void {
    this.recordingState.consentGiven = consent;
    if (!consent && this.recordingState.isRecording) {
      this.stopRecording();
      this.deleteRecording();
    }
    this.notifyRecordingState();
  }

  public getRecordingState(): LocalRecordingState {
    return { ...this.recordingState };
  }

  public getDeviceState(): AudioDeviceState {
    return { ...this.deviceState };
  }

  private notifyDeviceState(): void {
    if (this.options.onStateChange) {
      this.options.onStateChange({ ...this.deviceState });
    }
  }

  private notifyRecordingState(): void {
    if (this.options.onRecordingStateChange) {
      this.options.onRecordingStateChange({ ...this.recordingState });
    }
  }

  /**
   * Complete resource cleanup on unmount or session teardown
   */
  public dispose(): void {
    this.clearAudioQueue();

    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    if (this.recordingState.isRecording) {
      try {
        this.mediaRecorder?.stop();
      } catch {}
    }

    this.deleteRecording();
    this.stopMicrophoneStream();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    this.deviceState.permissionState = 'prompt';
    this.deviceState.inputLevel = 0;
    this.deviceState.isMuted = false;
  }
}

// Global Singleton Instance Helper
let globalAudioController: BrowserAudioController | null = null;

export function getAudioController(options?: BrowserAudioControllerOptions): BrowserAudioController {
  if (!globalAudioController) {
    globalAudioController = new BrowserAudioControllerService(options);
  } else if (options) {
    globalAudioController.initialize(options);
  }
  return globalAudioController;
}
