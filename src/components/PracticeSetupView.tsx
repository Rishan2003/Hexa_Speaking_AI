/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../services/routerContext';
import { useAuth } from '../services/authContext';
import { MockPracticeService } from '../services/mockService';
import { isFirebaseEnabled, getFirebaseAuth } from '../services/firebaseClient';
import { CUE_CARDS_BANK, generateTestSnapshot } from '../services/questionBank';
import { APP_CONFIG } from '../config';
import { 
  Compass, 
  BookOpen, 
  Clock, 
  ChevronRight, 
  Play, 
  Mic, 
  MicOff, 
  Check, 
  Volume2, 
  Sliders, 
  AlertTriangle,
  Info,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';

export const PracticeSetupView: React.FC = () => {
  const { navigate, currentRoute } = useRouter();
  const { user } = useAuth();

  // Mode Selection
  // Support pre-selected mode from parameters
  const params = currentRoute.params;
  const initialMode = (params?.mode as 'full' | 'part1' | 'part2' | 'part3') || 'full';
  const [selectedMode, setSelectedMode] = useState<'full' | 'part1' | 'part2' | 'part3'>(initialMode);
  const [selectedCueCardId, setSelectedCueCardId] = useState(CUE_CARDS_BANK[0].id);

  // Difficulty & Custom rules
  const [difficulty, setDifficulty] = useState<'standard' | 'supportive' | 'challenging'>('standard');
  const [recordingConsent, setRecordingConsent] = useState(false);

  // Audio Precheck & Media States
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [micLevel, setMicLevel] = useState(0);
  const [precheckError, setPrecheckError] = useState<string | null>(null);

  // 3-Sec Sample Record State
  const [isRecordingSample, setIsRecordingSample] = useState(false);
  const [sampleAudioUrl, setSampleAudioUrl] = useState<string | null>(null);
  const [isPlayingSample, setIsPlayingSample] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Creating Session Loading state
  const [launching, setLaunching] = useState(false);

  // Audio API Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

  // Reset parameters when mode changes
  useEffect(() => {
    setPrecheckError(null);
  }, [selectedMode]);

  // Request/Listen for Device updates
  useEffect(() => {
    if (micPermission === 'granted') {
      loadDevices();
    }
  }, [micPermission]);

  // Re-run stream capturing when selected device changes
  useEffect(() => {
    if (micPermission === 'granted' && selectedDeviceId) {
      stopMicrophoneStream();
      startMicrophoneStream(selectedDeviceId);
    }
  }, [selectedDeviceId]);

  // Clean up all audio components on unmount
  useEffect(() => {
    return () => {
      stopMicrophoneStream();
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
      }
    };
  }, []);

  // Check browser insecure context
  const isInsecureContext = typeof window !== 'undefined' && !window.isSecureContext;

  const loadDevices = async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
      setDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.warn('Could not list media devices:', err);
    }
  };

  const requestMicPermission = async () => {
    setPrecheckError(null);
    if (isInsecureContext) {
      setMicPermission('denied');
      setPrecheckError('Browser Security Constraint: Microphone access is strictly blocked under insecure contexts (non-HTTPS or non-localhost websites).');
      return;
    }

    try {
      // First request a generic audio stream to provoke permission trigger
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicPermission('granted');
      
      // Load available input devices
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
      setDevices(audioInputs);
      
      const defaultDevice = audioInputs[0]?.deviceId || '';
      setSelectedDeviceId(defaultDevice);

      // Connect volume analyser
      startVolumeAnalyser(stream);
    } catch (err) {
      console.error('Microphone permissions rejected:', err);
      setMicPermission('denied');
      setPrecheckError('Microphone access denied. Please grant permission in your browser settings to proceed.');
    }
  };

  const startMicrophoneStream = async (deviceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      streamRef.current = stream;
      startVolumeAnalyser(stream);
    } catch (err) {
      console.error('Failed to change audio device:', err);
      setPrecheckError('Failed to capture audio from the selected microphone.');
    }
  };

  const startVolumeAnalyser = (stream: MediaStream) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Map average volume to percentage 0-100
        setMicLevel(Math.min(100, Math.round((average / 128) * 100)));

        animationFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (e) {
      console.warn('Web Audio API not supported on this platform, using simulated indicator.');
      let count = 0;
      const interval = setInterval(() => {
        if (streamRef.current) {
          setMicLevel(Math.floor(10 + Math.random() * 40));
        } else {
          clearInterval(interval);
        }
      }, 150);
    }
  };

  const stopMicrophoneStream = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setMicLevel(0);
  };

  // Perform a 3-second recording and playback calibration test
  const startLocalAudioTest = () => {
    if (!streamRef.current) {
      setPrecheckError('Cannot record audio. Ensure microphone is calibrated and connected.');
      return;
    }

    setSampleAudioUrl(null);
    chunksRef.current = [];
    setCountdown(3);

    try {
      const recorder = new MediaRecorder(streamRef.current);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setSampleAudioUrl(audioUrl);
      };

      recorder.start();
      setIsRecordingSample(true);

      // Handle 3 seconds countdown
      let remaining = 3;
      const interval = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(interval);
          if (recorder.state === 'recording') {
            recorder.stop();
          }
          setIsRecordingSample(false);
        }
      }, 1000);

    } catch (err) {
      console.error('Failed to start local audio test recorder:', err);
      setPrecheckError('Browser compatibility failure with MediaRecorder. Try refreshing.');
    }
  };

  const playLocalSample = () => {
    if (!sampleAudioUrl) return;
    setIsPlayingSample(true);
    
    if (sampleAudioRef.current) {
      sampleAudioRef.current.pause();
    }

    const audio = new Audio(sampleAudioUrl);
    sampleAudioRef.current = audio;
    
    audio.onended = () => {
      setIsPlayingSample(false);
    };

    audio.play().catch(err => {
      console.error('Playback failed:', err);
      setIsPlayingSample(false);
    });
  };

  // Create real speakingSession and test snapshot via our secure backend
  const handleLaunchSession = async () => {
    setLaunching(true);
    try {
      // Save Recording Consent option locally for the session context
      localStorage.setItem('speakready_recording_consent', recordingConsent ? 'true' : 'false');
      localStorage.setItem('speakready_difficulty', difficulty);

      // Explicit sandbox mode stays fully local and never touches production APIs or Firestore.
      if (APP_CONFIG.useMocks) {
        const card = CUE_CARDS_BANK.find(c => c.id === selectedCueCardId) || CUE_CARDS_BANK[0];
        const seed = `seed-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const snapshot = generateTestSnapshot(
          seed,
          selectedMode,
          selectedMode === 'part1' ? undefined : card.id
        );
        const localSession = MockPracticeService.createSession(card.title, card.id, snapshot);

        MockPracticeService.upsertSession(localSession);
        stopMicrophoneStream();
        navigate('/practice', { sessionId: localSession.id });
        return;
      }

      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Secure Firebase Token Authorization
      const isFb = isFirebaseEnabled();
      if (isFb) {
        const auth = getFirebaseAuth();
        if (!auth.currentUser) {
          throw new Error('Your sign-in session has expired. Please sign in again.');
        }
        const token = await auth.currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        const uid = user?.uid || 'mock-user-id';
        headers['Authorization'] = `Bearer mock-token-${uid}`;
      }

      const response = await fetch('/api/session/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: selectedMode,
          seed: `seed-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          cueCardId: selectedMode === 'part1' ? undefined : selectedCueCardId
        })
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const details = [
          errorPayload.error || `Could not create the session (${response.status}).`,
          errorPayload.code ? `Code: ${errorPayload.code}` : '',
          errorPayload.stage ? `Stage: ${errorPayload.stage}` : '',
          errorPayload.diagnostic ? `Diagnostic: ${errorPayload.diagnostic}` : '',
          errorPayload.runtimeErrorCode ? `Runtime: ${errorPayload.runtimeErrorCode}` : '',
          errorPayload.requestId ? `Request ID: ${errorPayload.requestId}` : '',
          errorPayload.apiRevision ? `API: ${errorPayload.apiRevision}` : '',
        ].filter(Boolean).join(' · ');
        throw new Error(details);
      }

      const newSession = await response.json();
      
      // Mirror the server-created session locally for recovery and offline rendering.
      if (newSession && newSession.id) {
        MockPracticeService.upsertSession(newSession);

        // Stop precheck audio streams immediately before launching to avoid hardware conflicts!
        stopMicrophoneStream();

        // Direct routing redirect
        navigate('/practice', { sessionId: newSession.id });
      }
    } catch (err: any) {
      console.error('Error starting speaking session:', err);

      setPrecheckError(err.message || 'Could not create a secure practice session. Please sign in again and retry.');
    } finally {
      setLaunching(false);
    }
  };

  const selectedCueCard = CUE_CARDS_BANK.find(c => c.id === selectedCueCardId) || CUE_CARDS_BANK[0];

  return (
    <div id="practice-setup-view-container" className="max-w-4xl mx-auto py-10 px-4 font-sans space-y-8">
      
      <div className="rounded-[2rem] hexa-brand-panel text-white p-6 md:p-7 shadow-xl relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-[var(--hexa-red)]/20 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <span className="text-[10px] font-black text-white/60 uppercase tracking-[0.2em]">HEXA'S Speaking AI</span>
          <h1 className="text-3xl font-black mt-1 tracking-tight">Prepare your IELTS speaking session</h1>
          <p className="text-white/65 text-sm mt-2 max-w-2xl">
            Choose the test mode, check your microphone and launch a structured HEXA'S practice session.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        
        {/* Left Column - Configurations (3 cols) */}
        <div className="lg:col-span-3 space-y-8">
          
          {/* STEP 1: Choose Practice Mode */}
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4">
            <h2 className="text-base font-black text-gray-950 flex items-center gap-2">
              <Compass size={18} className="text-gray-400" />
              <span>Step 1: Choose Practice Mode</span>
            </h2>

            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'part1', title: 'Part 1', desc: 'Conversational Warmup' },
                { id: 'part2', title: 'Part 2', desc: 'Cue Card Monologue' },
                { id: 'part3', title: 'Part 3', desc: 'Connected Discussion' },
                { id: 'full', title: 'Full Exam', desc: 'Complete 3-Part Mock' },
              ].map((mode) => {
                const isSelected = selectedMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setSelectedMode(mode.id as any)}
                    className={`border text-left p-4 rounded-2xl transition cursor-pointer flex flex-col justify-between h-24 ${
                      isSelected 
                        ? 'border-[var(--hexa-navy)] bg-[var(--hexa-soft-blue)] shadow-sm ring-1 ring-[rgba(47,51,127,.08)]' 
                        : 'border-gray-100 bg-white hover:bg-gray-50/30'
                    }`}
                  >
                    <span className="text-xs font-black text-gray-950">{mode.title}</span>
                    <span className="text-gray-500 text-[10px] leading-tight font-medium">{mode.desc}</span>
                  </button>
                );
              })}
            </div>

            {/* Mode-specific explanations of what will happen */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs text-gray-600 leading-relaxed">
              {selectedMode === 'part1' && (
                <p>
                  <strong>Part 1 Warmup:</strong> You will engage in an introductory 4-5 minute dialogue answering general topics like home, structure, apps, sports, or food. Perfect for practicing fluent, unprompted responses. Feedback is displayed at the end.
                </p>
              )}
              {selectedMode === 'part2' && (
                <p>
                  <strong>Part 2 Cue Card:</strong> You will receive a randomized cue card topic. You have exactly 1 minute to draft structured notes inside the side panel, followed by a continuous 2-minute spoken monologue. Feedback is calculated after completion.
                </p>
              )}
              {selectedMode === 'part3' && (
                <p>
                  <strong>Part 3 Discussion:</strong> Engage in abstract and critical verbal exchanges based directly on Part 2 cue topics. You will answer 5 connected questions that evaluate your grammatical range and advanced coherent organization. Feedback appears at the end.
                </p>
              )}
              {selectedMode === 'full' && (
                <p>
                  <strong>Full Speaking Mock:</strong> Complete a complete 11-14 minute examination mirroring official British Council and IDP standards. Moves seamlessly from Part 1 Warmup to Part 2 Monologue, and concludes with Part 3 connected analytical discussions. Complete grading tables are processed upon conclusion.
                </p>
              )}
            </div>
          </div>

          {/* TOPIC SELECTION (Only show for Part 2, Part 3, or Full Exam where cue cards are applicable) */}
          {selectedMode !== 'part1' && (
            <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-black text-gray-950 flex items-center gap-2">
                <BookOpen size={18} className="text-gray-400" />
                <span>Select Cue Card Topic</span>
              </h2>
              
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {CUE_CARDS_BANK.map((card) => {
                  const isCardSelected = card.id === selectedCueCardId;
                  return (
                    <div
                      key={card.id}
                      onClick={() => setSelectedCueCardId(card.id)}
                      className={`border rounded-xl p-4 transition cursor-pointer flex justify-between items-start gap-4 ${
                        isCardSelected 
                          ? 'border-[var(--hexa-navy)] bg-[var(--hexa-soft-blue)]' 
                          : 'border-gray-100 hover:bg-gray-50/30'
                      }`}
                    >
                      <div>
                        <h4 className="text-xs font-extrabold text-gray-950">{card.title}</h4>
                        <p className="text-gray-500 text-[10px] mt-0.5 italic line-clamp-1">"{card.taskStatement}"</p>
                      </div>
                      <input
                        type="radio"
                        name="cueCardSelect"
                        checked={isCardSelected}
                        onChange={() => setSelectedCueCardId(card.id)}
                        className="accent-[var(--hexa-red)] w-4 h-4 cursor-pointer mt-0.5"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Bullet previews for chosen card */}
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Part 2 Cue Prompts:</span>
                {selectedCueCard.bulletPrompts.map((bp, i) => (
                  <p key={i} className="text-xs text-gray-600 flex items-center gap-2 font-medium">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
                    <span>{bp}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: Custom Preferences */}
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4">
            <h2 className="text-base font-black text-gray-950 flex items-center gap-2">
              <Sliders size={18} className="text-gray-400" />
              <span>Step 2: Custom Preferences</span>
            </h2>

            <div className="space-y-4">
              {/* Difficulty */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-700 block">AI Examiner Demeanor</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'supportive', label: 'Supportive', tip: 'Longer feedback & warm tones' },
                    { id: 'standard', label: 'Standard', tip: 'Official IELTS neutral timing' },
                    { id: 'challenging', label: 'Challenging', tip: 'Fast-paced & strict critique' },
                  ].map((diff) => {
                    const isDiffSelected = difficulty === diff.id;
                    return (
                      <button
                        key={diff.id}
                        type="button"
                        onClick={() => setDifficulty(diff.id as any)}
                        className={`border py-2.5 px-3 rounded-xl text-center cursor-pointer transition ${
                          isDiffSelected 
                            ? 'border-[var(--hexa-navy)] bg-[var(--hexa-soft-blue)] font-bold text-[var(--hexa-navy)]' 
                            : 'border-gray-100 bg-white hover:bg-gray-50/50 text-gray-500 font-semibold'
                        }`}
                      >
                        <span className="text-xs block">{diff.label}</span>
                        <span className="text-[8px] text-gray-400 font-normal mt-0.5 block leading-none">{diff.tip}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Consent Toggle */}
              <div className="border-t border-gray-100 pt-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-950 block">GDPR Audio Saving Consent</label>
                  <p className="text-gray-500 text-[10px] leading-relaxed max-w-md">
                    Allow HEXA'S Speaking AI to temporarily store local microphone recordings for self-review playback inside results. Off by default.
                  </p>
                </div>
                
                <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={recordingConsent}
                    onChange={(e) => setRecordingConsent(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--hexa-navy)]"></div>
                </label>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column - Precheck & Launch (2 cols) */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* STEP 3: Microphone Precheck & Calibration */}
          <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-black text-gray-950 uppercase tracking-wider text-gray-500">
                Mic Precheck & Calibration
              </h2>
              {micPermission === 'granted' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                  <Check size={10} /> Active
                </span>
              )}
            </div>

            {micPermission !== 'granted' ? (
              <div className="space-y-3.5 py-2">
                <p className="text-gray-500 text-xs leading-normal">
                  To participate in verbal exam segments, HEXA'S Speaking AI needs microphone access. Accept the browser request below.
                </p>
                <button
                  id="request-mic-permission-btn"
                  onClick={requestMicPermission}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--hexa-navy)] hover:bg-[var(--hexa-navy-deep)] text-white text-xs font-bold py-3.5 px-4 rounded-xl transition cursor-pointer"
                >
                  <Mic size={14} />
                  <span>Grant Microphone Access</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                {/* Device Selector */}
                {devices.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Input Device:</label>
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => setSelectedDeviceId(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl px-3 py-2 text-xs text-gray-900 font-semibold focus:outline-none"
                    >
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone ${d.deviceId.substring(0, 5)}...`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Volume Level Meter */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    <span>Live Input Volume:</span>
                    <span className="font-mono">{micLevel}%</span>
                  </div>
                  <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-75 ${
                        micLevel > 70 ? 'bg-red-500' : micLevel > 30 ? 'bg-[var(--hexa-navy)]' : 'bg-emerald-500'
                      }`} 
                      style={{ width: `${micLevel}%` }}
                    ></div>
                  </div>
                  <span className="text-[9px] text-gray-400 block font-medium">Please speak to confirm the volume slider responds dynamically.</span>
                </div>

                {/* 3-Second Record/Playback Test */}
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Record/Playback Calibration</span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isRecordingSample}
                      onClick={startLocalAudioTest}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 px-3 rounded-xl border transition cursor-pointer ${
                        isRecordingSample
                          ? 'bg-red-50 border-red-200 text-red-600 font-extrabold animate-pulse'
                          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <Mic size={13} />
                      <span>{isRecordingSample ? `Recording (${countdown}s)...` : 'Record 3s Test'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={!sampleAudioUrl || isRecordingSample || isPlayingSample}
                      onClick={playLocalSample}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 px-3 rounded-xl border transition cursor-pointer ${
                        !sampleAudioUrl 
                          ? 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed' 
                          : isPlayingSample 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-600 animate-pulse font-extrabold'
                            : 'bg-[var(--hexa-soft-blue)] border-[rgba(47,51,127,.12)] text-[var(--hexa-navy)] hover:bg-[rgba(47,51,127,.08)]'
                      }`}
                    >
                      <Volume2 size={13} />
                      <span>{isPlayingSample ? 'Playing...' : 'Play Sample'}</span>
                    </button>
                  </div>
                  
                  {sampleAudioUrl && !isPlayingSample && (
                    <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                      <Check size={10} /> Local test successful! Audio calibration confirmed.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Recovery Instructions Alert */}
            {precheckError && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 text-xs text-red-900 space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-600" />
                  <div className="leading-relaxed font-semibold">
                    {/(session|api|server|bootstrap|initialization|404|500|503|request id|stage:)/i.test(precheckError)
                      ? 'Session Launch Error:'
                      : 'Microphone Hardware Alert:'}
                  </div>
                </div>
                <p className="text-gray-600 text-[10px] leading-normal pl-6">
                  {precheckError}
                </p>
                {/(session|api|server|bootstrap|initialization|404|500|503|request id|stage:)/i.test(precheckError) ? (
                  <div className="pl-6 pt-1 space-y-1 text-gray-500 text-[9px] leading-relaxed">
                    <p><strong>Session API recovery:</strong></p>
                    <p>1. Open <code>/api/health</code>; it should return HTTP 200 JSON.</p>
                    <p>2. Open <code>/api/readiness</code>; fix any missing Firebase/Gemini/ALLOWED_ORIGINS settings it reports.</p>
                    <p>3. If a code/stage/request ID is shown above, use it in the matching Vercel Function log. Microphone permissions do not cause API 500/503 errors.</p>
                  </div>
                ) : (
                  <div className="pl-6 pt-1 space-y-1 text-gray-500 text-[9px] leading-relaxed">
                    <p><strong>To Recover:</strong></p>
                    <p>1. <strong>Chrome/Edge:</strong> Click the lock icon in your browser URL address bar and change <em>Microphone</em> to "Allow".</p>
                    <p>2. <strong>Firefox/Safari:</strong> Access Site Settings via your browser preferences to reset blocked permissions, then refresh this page.</p>
                    <p>3. <strong>Context restrictions:</strong> Ensure this app is loaded over secure context (HTTPS) or localhost. Plain HTTP blocks hardware devices.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LAUNCH BAR (Disable if mic not granted) */}
          <div className="space-y-4">
            <button
              id="launch-mock-exam-btn"
              disabled={micPermission !== 'granted' || launching}
              onClick={handleLaunchSession}
              className={`w-full flex items-center justify-center gap-2 font-black py-4 px-6 rounded-2xl transition duration-150 shadow-lg ${
                micPermission !== 'granted'
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none border border-gray-100'
                  : 'hexa-primary-btn text-white cursor-pointer'
              }`}
            >
              {launching ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Generating Secure Exam Snapshot...</span>
                </>
              ) : (
                <>
                  <Play size={16} />
                  <span>Start HEXA'S Practice Session</span>
                </>
              )}
            </button>
            
            {micPermission !== 'granted' && (
              <p className="text-center text-[10px] font-bold text-gray-400">
                ⚠️ Calibration required: complete microphone precheck to enable start button.
              </p>
            )}

            {/* No Permanent Gemini Connection Disclaimer */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-[10px] text-gray-500 flex gap-2.5 items-start">
              <Info size={14} className="shrink-0 mt-0.5 text-gray-400" />
              <div className="leading-normal">
                <strong>No Live Connections Start Yet:</strong> No Gemini models or websocket connections will start during setup. Your connection is minted and established only when you confirm the calibration and click the Start button.
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};

export default PracticeSetupView;
