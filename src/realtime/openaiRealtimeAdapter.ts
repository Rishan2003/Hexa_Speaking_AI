/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RealtimeVoiceProvider,
  RealtimeVoiceConfig,
  ProviderDiagnostics,
  ProviderDiagnosticsLog,
} from './voiceContract';
import { APP_CONFIG } from '../config';
import { getFirebaseIdToken } from '../services/firebaseClient';

export interface OpenAIRealtimeConfigOptions {
  enabled: boolean;
  model: string;
  voice: string;
  transportType: 'webrtc_sdp';
  mintEndpoint: string;
  sampleRate: number;
  setupTimeoutMs: number;
}

export const OPENAI_REALTIME_CONFIG: OpenAIRealtimeConfigOptions = {
  enabled: true,
  model: APP_CONFIG.openaiRealtimeModel,
  voice: APP_CONFIG.openaiRealtimeVoice,
  transportType: 'webrtc_sdp',
  mintEndpoint: '/api/session/mint-openai',
  // Realtime's PCM output format is 24 kHz. WebRTC itself negotiates Opus.
  sampleRate: 24_000,
  setupTimeoutMs: 15_000,
};

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
type RealtimeServerEvent = Record<string, any> & { type?: string };

/**
 * OpenAI Realtime WebRTC adapter.
 *
 * Audio travels natively over the RTCPeerConnection. The data channel is used
 * only for Realtime control/events, transcript events, manual turn boundaries,
 * and usage metadata. This keeps the rest of the IELTS application provider-neutral.
 */
export class OpenAIRealtimeAdapter implements RealtimeVoiceProvider {
  private config: RealtimeVoiceConfig | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private status: ConnectionStatus = 'disconnected';
  private allowInterruption = true;
  private manualActivityDetection = false;
  private userActivityActive = false;
  private intentionalDisconnect = false;
  private responseInProgress = false;
  private sessionStartedAt = 0;
  private reconnectCount = 0;
  private packetsSent = 0;
  private packetsReceived = 0;
  private hasWarning = false;
  private warningMessage: string | null = null;
  private usage = { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };
  private transcriptLog: ProviderDiagnostics['transcriptLog'] = [];
  private rawEventLog: ProviderDiagnosticsLog[] = [];
  private outputTranscriptBuffers = new Map<string, string>();
  private clearedResponseIds = new Set<string>();

  async initialize(config: RealtimeVoiceConfig): Promise<void> {
    if (!OPENAI_REALTIME_CONFIG.enabled && !APP_CONFIG.enableOpenAIRealtime) {
      throw new Error('OpenAI Realtime is disabled by application configuration.');
    }
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('This browser does not support WebRTC, which is required for OpenAI Realtime.');
    }
    if (!config.mediaStream || config.mediaStream.getAudioTracks().length === 0) {
      throw new Error('OpenAI Realtime requires an active microphone MediaStream.');
    }

    await this.closeTransport(false);
    this.config = config;
    this.allowInterruption = config.allowInterruption ?? true;
    this.manualActivityDetection = config.activityDetectionMode === 'manual';
    this.userActivityActive = false;
    this.intentionalDisconnect = false;
    this.responseInProgress = false;
    this.outputTranscriptBuffers.clear();
    this.clearedResponseIds.clear();
    this.updateStatus('connecting');
    this.addLog('info', `Starting OpenAI Realtime WebRTC connection (${OPENAI_REALTIME_CONFIG.model}).`);

    try {
      const pc = new RTCPeerConnection();
      this.peerConnection = pc;

      const audioElement = new Audio();
      audioElement.autoplay = true;
      this.remoteAudioElement = audioElement;

      pc.ontrack = (event) => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        audioElement.srcObject = stream;
        void audioElement.play().catch((error) => {
          const message = `Examiner audio autoplay was blocked: ${this.toError(error).message}`;
          this.hasWarning = true;
          this.warningMessage = message;
          this.addLog('warning', message);
          this.config?.onWarning?.({ code: 'AUDIO_AUTOPLAY_BLOCKED', message });
        });
      };

      pc.onconnectionstatechange = () => {
        this.addLog('ws', `WebRTC connection state: ${pc.connectionState}.`);
        if (!this.intentionalDisconnect && ['failed', 'closed'].includes(pc.connectionState)) {
          this.updateStatus('disconnected');
          const error = new Error(`OpenAI Realtime WebRTC connection ${pc.connectionState}.`);
          this.addLog('error', error.message);
          this.config?.onError(error);
        }
      };

      for (const track of config.mediaStream.getAudioTracks()) {
        pc.addTrack(track, config.mediaStream);
      }

      const dc = pc.createDataChannel('oai-events');
      this.dataChannel = dc;
      dc.onmessage = (event) => this.handleDataChannelMessage(event);
      dc.onclose = () => {
        this.addLog('ws', 'OpenAI Realtime data channel closed.');
        if (!this.intentionalDisconnect && this.status === 'connected') {
          this.updateStatus('disconnected');
          const error = new Error('OpenAI Realtime control channel closed unexpectedly.');
          this.addLog('error', error.message);
          this.config?.onError(error);
        }
      };

      const channelReady = this.waitForDataChannelOpen(dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Use the SDP string from createOffer(), matching OpenAI's current
      // unified WebRTC example. setLocalDescription() is still required to
      // initialize the peer connection, but its asynchronously-mutated SDP is
      // not what we forward to the server.
      const offerSdp = offer.sdp;
      if (!offerSdp || !offerSdp.trim().startsWith('v=')) {
        throw new Error('The browser could not create a valid WebRTC SDP offer.');
      }

      const idToken = await getFirebaseIdToken();
      const response = await fetch(OPENAI_REALTIME_CONFIG.mintEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          sessionId: config.sessionId || '',
          sdp: offerSdp,
          systemInstruction: config.systemInstruction || '',
          activityDetectionMode: this.manualActivityDetection ? 'manual' : 'automatic',
          allowInterruption: this.allowInterruption,
        }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        let body: any = {};
        try { body = responseText ? JSON.parse(responseText) : {}; } catch { /* SDP endpoint may return plain text */ }
        const detail = body?.error || response.statusText || `HTTP ${response.status}`;
        const diagnostics = [
          body?.code ? `Code: ${body.code}` : '',
          body?.stage ? `Stage: ${body.stage}` : '',
          body?.upstreamStatus ? `OpenAI HTTP: ${body.upstreamStatus}` : '',
          body?.openaiRequestId ? `OpenAI Request ID: ${body.openaiRequestId}` : '',
          Number.isFinite(body?.sdpLength) ? `SDP length: ${body.sdpLength}` : '',
          typeof body?.sdpHasAudio === 'boolean' ? `SDP audio: ${body.sdpHasAudio ? 'yes' : 'no'}` : '',
          typeof body?.sdpHasDataChannel === 'boolean' ? `SDP data: ${body.sdpHasDataChannel ? 'yes' : 'no'}` : '',
          typeof body?.sdpEndsWithCrlf === 'boolean' ? `SDP CRLF: ${body.sdpEndsWithCrlf ? 'yes' : 'no'}` : '',
          body?.requestId ? `Request ID: ${body.requestId}` : '',
          body?.apiRevision ? `API: ${body.apiRevision}` : '',
        ].filter(Boolean).join(' · ');
        throw new Error(`Failed to create OpenAI Realtime call: ${detail}${diagnostics ? `\n${diagnostics}` : ''}`);
      }
      if (!responseText.trim().startsWith('v=')) {
        throw new Error('OpenAI Realtime call endpoint returned an invalid SDP answer.');
      }

      await pc.setRemoteDescription({ type: 'answer', sdp: responseText });
      await channelReady;

      this.sessionStartedAt = Date.now();
      this.updateStatus('connected');
      this.addLog('info', 'OpenAI Realtime WebRTC data channel connected.');
    } catch (error) {
      const normalized = this.toError(error);
      this.addLog('error', normalized.message);
      await this.closeTransport(false);
      this.updateStatus('disconnected');
      throw normalized;
    }
  }

  /** WebRTC carries microphone audio natively, so PCM callbacks are intentionally ignored. */
  sendAudio(_chunk: Int16Array): void {
    // No-op by design.
  }

  sendTextMessage(text: string): void {
    const normalized = text.trim();
    if (!normalized || !this.isChannelOpen()) return;
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: normalized }],
      },
    });
    this.recordTranscript('candidate', normalized, true);
    this.sendEvent({ type: 'response.create' });
  }

  sendControlMessage(text: string): void {
    const normalized = text.trim();
    if (!normalized || !this.isChannelOpen()) return;

    // Realtime response-level instructions OVERRIDE the session instructions
    // for that response. Repeat the base examiner prompt here so internal app
    // controls (opening a part, ending Part 2 prep, etc.) cannot accidentally
    // discard the IELTS script for the response they trigger.
    const baseInstructions = this.config?.systemInstruction?.trim() || '';
    const responseInstructions = baseInstructions
      ? `${baseInstructions}

INTERNAL APPLICATION CONTROL FOR THIS RESPONSE:
${normalized}`
      : normalized;

    // Trigger the examiner without inserting a fake candidate utterance into
    // the conversation transcript/history.
    this.sendEvent({
      type: 'response.create',
      response: {
        instructions: responseInstructions,
        output_modalities: ['audio'],
      },
    });
    this.addLog('info', 'Sent an internal OpenAI Realtime examiner control instruction.');
  }

  endAudioStream(): void {
    if (!this.manualActivityDetection || !this.isChannelOpen()) return;
    // During Part 2 preparation there should be no candidate turn pending.
    // Clear any disabled-track/silence frames before the next explicit activity.
    if (!this.userActivityActive) {
      this.sendEvent({ type: 'input_audio_buffer.clear' });
      this.addLog('turn', 'Cleared the manual input buffer outside a candidate activity.');
    }
  }

  startUserActivity(): void {
    if (!this.manualActivityDetection || this.userActivityActive || !this.isChannelOpen()) return;
    this.sendEvent({ type: 'input_audio_buffer.clear' });
    this.userActivityActive = true;
    this.config?.onTurnChange?.('candidate', false);
    this.addLog('turn', 'Started an app-controlled OpenAI candidate activity.');
  }

  endUserActivity(): void {
    if (!this.manualActivityDetection || !this.userActivityActive || !this.isChannelOpen()) return;
    this.userActivityActive = false;
    this.sendEvent({ type: 'input_audio_buffer.commit' });
    this.sendEvent({ type: 'response.create' });
    this.config?.onTurnChange?.('candidate', true);
    this.addLog('turn', 'Committed the app-controlled candidate activity and requested the examiner response.');
  }

  setAllowInterruption(allow: boolean): void {
    this.allowInterruption = allow;
    if (!this.manualActivityDetection && this.isChannelOpen()) {
      this.sendEvent({
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: {
            input: {
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 800,
                create_response: true,
                interrupt_response: allow,
              },
            },
          },
        },
      });
    }
  }

  async reconnect(): Promise<void> {
    if (!this.config) return;
    this.reconnectCount++;
    const config = this.config;
    await this.initialize(config);
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    await this.closeTransport(true);
    this.updateStatus('disconnected');
    this.addLog('info', 'Cleanly disconnected OpenAI Realtime WebRTC session.');
  }

  getDiagnostics(): ProviderDiagnostics {
    return {
      providerName: 'OpenAIRealtimeProvider',
      status: this.status,
      model: OPENAI_REALTIME_CONFIG.model,
      voiceName: OPENAI_REALTIME_CONFIG.voice,
      sessionDurationSeconds: this.sessionStartedAt
        ? Math.max(0, Math.floor((Date.now() - this.sessionStartedAt) / 1000))
        : 0,
      reconnectCount: this.reconnectCount,
      packetsSent: this.packetsSent,
      packetsReceived: this.packetsReceived,
      lastPingMs: null,
      hasWarning: this.hasWarning,
      warningMessage: this.warningMessage,
      canInterrupt: this.allowInterruption,
      usage: { ...this.usage },
      transcriptLog: [...this.transcriptLog],
      rawEventLog: [...this.rawEventLog],
    };
  }

  private handleDataChannelMessage(message: MessageEvent): void {
    this.packetsReceived++;
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(String(message.data));
    } catch (error) {
      this.addLog('error', `Could not parse OpenAI Realtime event: ${this.toError(error).message}`);
      return;
    }

    const type = String(event.type || 'unknown');
    this.addLog('ws', `Received ${type}.`);

    if (type === 'error') {
      // Realtime protocol errors are usually recoverable and the session remains
      // open. Surface them as warnings; transport failures are handled separately.
      const messageText = event.error?.message || 'OpenAI Realtime server error.';
      this.hasWarning = true;
      this.warningMessage = messageText;
      this.addLog('warning', messageText);
      this.config?.onWarning?.({
        code: String(event.error?.code || 'OPENAI_REALTIME_EVENT_ERROR'),
        message: messageText,
      });
      return;
    }

    if (type === 'session.created' || type === 'session.updated') {
      return;
    }

    if (type === 'response.created') {
      this.responseInProgress = true;
      this.config?.onTurnChange?.('examiner', false);
      return;
    }

    if (type === 'input_audio_buffer.speech_started') {
      this.config?.onTurnChange?.('candidate', false);
      if (this.allowInterruption && this.responseInProgress) {
        this.addLog('interrupted', 'Candidate speech interrupted an in-progress examiner response.');
        this.config?.onInterrupted?.();
      }
      return;
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      this.config?.onTurnChange?.('candidate', true);
      return;
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      if (typeof event.transcript === 'string') {
        this.recordTranscript('candidate', event.transcript, true);
      }
      return;
    }

    if (type === 'conversation.item.input_audio_transcription.failed') {
      const messageText = event.error?.message || 'Candidate audio transcription failed.';
      this.hasWarning = true;
      this.warningMessage = messageText;
      this.addLog('warning', messageText);
      this.config?.onWarning?.({ code: 'INPUT_TRANSCRIPTION_FAILED', message: messageText });
      return;
    }

    if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
      const key = this.transcriptEventKey(event);
      const delta = typeof event.delta === 'string' ? event.delta : '';
      if (delta) this.outputTranscriptBuffers.set(key, (this.outputTranscriptBuffers.get(key) || '') + delta);
      return;
    }

    if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
      const key = this.transcriptEventKey(event);
      const transcript = typeof event.transcript === 'string'
        ? event.transcript
        : typeof event.text === 'string'
          ? event.text
          : (this.outputTranscriptBuffers.get(key) || '');
      this.outputTranscriptBuffers.delete(key);
      if (transcript) this.recordTranscript('examiner', transcript, true);
      return;
    }

    if (type === 'output_audio_buffer.cleared') {
      const responseId = String(event.response_id || '');
      if (responseId) this.clearedResponseIds.add(responseId);
      this.responseInProgress = false;
      return;
    }

    if (type === 'output_audio_buffer.stopped') {
      const responseId = String(event.response_id || '');
      const wasInterrupted = responseId ? this.clearedResponseIds.delete(responseId) : false;
      this.responseInProgress = false;
      if (!wasInterrupted) {
        // WebRTC emits this only after response.done AND after the server output
        // audio buffer has fully drained, making it the safest examiner-turn boundary.
        this.config?.onTurnChange?.('examiner', true);
      }
      return;
    }

    if (type === 'response.done') {
      const usage = event.response?.usage;
      if (usage) {
        this.usage = {
          promptTokens: Number(usage.input_tokens) || 0,
          candidatesTokens: Number(usage.output_tokens) || 0,
          totalTokens: Number(usage.total_tokens) || 0,
        };
        this.config?.onUsageUpdate?.(this.usage);
      }
      const responseStatus = String(event.response?.status || '');
      if (responseStatus === 'failed') {
        this.responseInProgress = false;
        const error = new Error(event.response?.status_details?.error?.message || event.response?.error?.message || 'OpenAI Realtime examiner response failed.');
        this.addLog('error', error.message);
        this.config?.onError(error);
      } else if (responseStatus === 'incomplete') {
        const messageText = 'OpenAI Realtime examiner response ended incomplete.';
        this.hasWarning = true;
        this.warningMessage = messageText;
        this.addLog('warning', messageText);
        this.config?.onWarning?.({ code: 'RESPONSE_INCOMPLETE', message: messageText });
      }
      // Do not emit examiner turn-complete here: response.done means generation
      // is finished, but WebRTC audio may still be playing. Wait for
      // output_audio_buffer.stopped instead.
      return;
    }
  }

  private transcriptEventKey(event: RealtimeServerEvent): string {
    return [event.response_id, event.item_id, event.output_index, event.content_index]
      .filter((value) => value !== undefined && value !== null)
      .join(':') || 'current';
  }

  private sendEvent(event: Record<string, unknown>): boolean {
    if (!this.isChannelOpen() || !this.dataChannel) return false;
    this.dataChannel.send(JSON.stringify(event));
    this.packetsSent++;
    return true;
  }

  private isChannelOpen(): boolean {
    return this.status === 'connected' && this.dataChannel?.readyState === 'open';
  }

  private waitForDataChannelOpen(channel: RTCDataChannel): Promise<void> {
    if (channel.readyState === 'open') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('OpenAI Realtime WebRTC data channel timed out while connecting.'));
      }, OPENAI_REALTIME_CONFIG.setupTimeoutMs);

      channel.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      channel.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error('OpenAI Realtime WebRTC data channel failed to open.'));
      };
    });
  }

  private async closeTransport(resetSessionClock: boolean): Promise<void> {
    const channel = this.dataChannel;
    this.dataChannel = null;
    if (channel) {
      // Detach handlers before closing. Part rotations reconnect immediately,
      // so a late close event from the old channel must not affect the new one.
      channel.onopen = null;
      channel.onmessage = null;
      channel.onerror = null;
      channel.onclose = null;
      if (channel.readyState !== 'closed') {
        try { channel.close(); } catch { /* ignore */ }
      }
    }

    const pc = this.peerConnection;
    this.peerConnection = null;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try { pc.close(); } catch { /* ignore */ }
    }

    const audio = this.remoteAudioElement;
    this.remoteAudioElement = null;
    if (audio) {
      try { audio.pause(); } catch { /* ignore */ }
      audio.srcObject = null;
    }

    this.responseInProgress = false;
    this.userActivityActive = false;
    this.outputTranscriptBuffers.clear();
    this.clearedResponseIds.clear();
    if (resetSessionClock) this.sessionStartedAt = 0;
  }

  private updateStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.config?.onStatusChange(status);
  }

  private recordTranscript(
    speaker: 'examiner' | 'candidate',
    text: string,
    isFinal: boolean
  ): void {
    const normalized = text.trim();
    if (!normalized) return;

    const last = this.transcriptLog[this.transcriptLog.length - 1];
    if (last && last.speaker === speaker && last.text === normalized && Date.now() - last.timestamp < 2_000) {
      return;
    }

    const item = {
      id: `oai-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      speaker,
      text: normalized,
      isFinal,
    };
    this.transcriptLog.push(item);
    if (this.transcriptLog.length > 50) this.transcriptLog.shift();
    this.addLog('transcript', `[${speaker.toUpperCase()}] ${normalized}`);
    this.config?.onTranscript(speaker, normalized, isFinal);
  }

  private addLog(type: ProviderDiagnosticsLog['type'], details: string): void {
    this.rawEventLog.push({
      id: `oai-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      type,
      details,
    });
    if (this.rawEventLog.length > 100) this.rawEventLog.shift();
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export { OpenAIRealtimeAdapter as OpenAIRealtimeProvider };
