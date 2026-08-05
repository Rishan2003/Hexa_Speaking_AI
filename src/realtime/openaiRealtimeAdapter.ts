/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RealtimeVoiceProvider,
  RealtimeVoiceConfig,
  ProviderDiagnostics,
  ProviderDiagnosticsLog
} from './voiceContract';
import { APP_CONFIG } from '../config';

/**
 * Configuration options for the future OpenAI Realtime Provider adapter.
 */
export interface OpenAIRealtimeConfigOptions {
  enabled: boolean;
  model: string;
  voice: string;
  transportType: 'webrtc_sdp' | 'websocket';
  mintEndpoint: string;
  sampleRate: number;
}

/**
 * Central configuration for OpenAI Realtime API.
 * Feature flag `enabled` defaults to false in production builds.
 */
export const OPENAI_REALTIME_CONFIG: OpenAIRealtimeConfigOptions = {
  enabled: false, // Disabled feature flag - Gemini Live remains active production provider
  model: 'gpt-4o-realtime-preview-2024-12-17',
  voice: 'alloy', // Options: 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'
  transportType: 'webrtc_sdp',
  mintEndpoint: '/api/session/mint-openai',
  sampleRate: 24000
};

/**
 * Disabled Stub OpenAI Realtime Provider Adapter.
 *
 * TRANSPORT ARCHITECTURE NOTE:
 * Browser transport for OpenAI Realtime API uses WebRTC (via ephemeral session token
 * and SDP offer/answer exchange to https://api.openai.com/v1/realtime) or WebSockets
 * (wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17).
 * This browser transport architecture differs from Gemini Live Bidi WebSockets
 * (which uses PCM16 audio chunks over wss://generativelanguage.googleapis.com/...),
 * but stays completely encapsulated within this OpenAIRealtimeAdapter class.
 *
 * All incoming and outgoing events (`sendAudio`, `sendTextMessage`, `onAudioOutput`,
 * `onTranscript`, `onError`, `onStatusChange`, `getDiagnostics`) conform to the unified
 * `RealtimeVoiceProvider` interface, allowing the rest of the application (IELTS state
 * machine, UI components, exam engine, audio controller) to stay 100% provider-agnostic.
 *
 * ============================================================================
 * FUTURE IMPLEMENTATION CHECKLIST (For when OpenAI Realtime Milestone begins)
 * Official Documentation Reference: https://platform.openai.com/docs/guides/realtime
 * ============================================================================
 *
 * STEP 1: Server Ephemeral Session Token Minting Endpoint (/api/session/mint-openai)
 * - Implement POST endpoint on server using OPENAI_API_KEY secret.
 * - Call https://api.openai.com/v1/realtime/sessions with session model and voice options.
 * - Return client ephemeral token (`client_secret.value`) to browser.
 *
 * STEP 2: Browser Transport Connection (WebRTC / DataChannel)
 * - Instantiate RTCPeerConnection and create RTCDataChannel("oai-events").
 * - Add local microphone track from BrowserAudioController.
 * - Generate WebRTC SDP offer and POST to https://api.openai.com/v1/realtime with Bearer ephemeral token.
 * - Receive SDP answer and set RemoteDescription.
 * - Handle incoming audio track onontrack to route examiner audio output.
 *
 * STEP 3: Normalized Event & State Mapping
 * - Send `session.update` payload to inject IELTS Examiner prompt instructions.
 * - Listen for `response.audio.delta` -> trigger `config.onAudioOutput(pcmChunk)`.
 * - Listen for `response.audio_transcript.delta` -> trigger `config.onTranscript('examiner', delta, false)`.
 * - Listen for `conversation.item.created` -> trigger `config.onTranscript('examiner', fullText, true)`.
 * - Listen for `input_audio_buffer.speech_started` -> trigger `config.onInterrupted()`.
 *
 * STEP 4: Token Usage & Teardown
 * - Parse `response.done.usage` ({ prompt_tokens, completion_tokens, total_tokens }).
 * - Emit `config.onUsageUpdate()`.
 * - Safely close DataChannel, RTCPeerConnection, and stop audio tracks on `disconnect()`.
 * ============================================================================
 */
export class OpenAIRealtimeAdapter implements RealtimeVoiceProvider {
  private config: RealtimeVoiceConfig | null = null;
  private status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private allowInterruption = true;
  private rawEventLog: ProviderDiagnosticsLog[] = [];

  async initialize(config: RealtimeVoiceConfig): Promise<void> {
    this.config = config;
    this.status = 'connecting';
    config.onStatusChange(this.status);

    // Enforce feature flag check
    const isEnabled = OPENAI_REALTIME_CONFIG.enabled || APP_CONFIG.enableOpenAIRealtime;

    if (!isEnabled) {
      this.status = 'disconnected';
      config.onStatusChange(this.status);
      const errorMsg =
        'OpenAI Realtime Adapter is currently disabled by feature flag in this build. Gemini Live is the active production provider.';
      
      this.addLog('warning', errorMsg);
      const err = new Error(errorMsg);
      config.onError(err);
      throw err;
    }

    // Placeholder for future live connection setup
    throw new Error('OpenAI Realtime provider connection logic is not implemented yet.');
  }

  sendAudio(chunk: Int16Array): void {
    if (this.status !== 'connected') return;
    // In future implementation: encode PCM16 chunk to base64 and send via DataChannel/WS
  }

  sendTextMessage(text: string): void {
    if (this.status !== 'connected') return;
    // In future implementation: send conversation.item.create event via DataChannel/WS
  }

  setAllowInterruption(allow: boolean): void {
    this.allowInterruption = allow;
  }

  async reconnect(): Promise<void> {
    if (!this.config) return;
    await this.initialize(this.config);
  }

  getDiagnostics(): ProviderDiagnostics {
    return {
      providerName: 'OpenAIRealtimeAdapter',
      status: this.status,
      model: OPENAI_REALTIME_CONFIG.model,
      voiceName: OPENAI_REALTIME_CONFIG.voice,
      sessionDurationSeconds: 0,
      reconnectCount: 0,
      packetsSent: 0,
      packetsReceived: 0,
      lastPingMs: null,
      hasWarning: true,
      warningMessage: 'OpenAI Realtime Provider is disabled by feature flag.',
      canInterrupt: this.allowInterruption,
      usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 },
      transcriptLog: [],
      rawEventLog: [...this.rawEventLog]
    };
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    if (this.config) {
      this.config.onStatusChange(this.status);
    }
  }

  private addLog(type: ProviderDiagnosticsLog['type'], details: string): void {
    const entry: ProviderDiagnosticsLog = {
      id: `oai-log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
      type,
      details
    };
    this.rawEventLog.unshift(entry);
    if (this.rawEventLog.length > 100) {
      this.rawEventLog.pop();
    }
  }
}
