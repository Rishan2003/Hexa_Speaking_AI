/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RealtimeProviderType = 'gemini-live' | 'mock' | 'openai-realtime';

/**
 * Normalized Voice Configuration for Realtime Voice Examiners.
 * Individual provider adapters (Gemini Live WebSocket, OpenAI Realtime WebRTC/WS, Mock)
 * encapsulate their specific browser transport dynamics internally while emitting
 * normalized events to the application.
 */
export interface RealtimeVoiceConfig {
  sampleRate: number;
  onAudioData?: (chunk: Int16Array) => void;
  onTranscript: (speaker: 'examiner' | 'candidate', text: string, isFinal: boolean) => void;
  onError: (error: Error) => void;
  onStatusChange: (status: 'disconnected' | 'connecting' | 'connected') => void;
  
  // Normalized Gemini Live events
  onAudioOutput?: (audioPcm: Int16Array, sampleRate: number) => void;
  onTurnChange?: (speaker: 'examiner' | 'candidate' | 'idle', isComplete: boolean) => void;
  onInterrupted?: () => void;
  onUsageUpdate?: (usage: { promptTokens: number; candidatesTokens: number; totalTokens: number }) => void;
  onWarning?: (warning: { code: string; message: string }) => void;
  systemInstruction?: string;
  allowInterruption?: boolean;
  /** Use app-controlled activity boundaries instead of Gemini server-side VAD. */
  activityDetectionMode?: 'automatic' | 'manual';
}

export interface ProviderDiagnosticsLog {
  id: string;
  timestamp: number;
  type: 'info' | 'audio' | 'transcript' | 'turn' | 'interrupted' | 'warning' | 'error' | 'ws';
  details: string;
}

export interface ProviderDiagnostics {
  providerName: string;
  status: 'disconnected' | 'connecting' | 'connected';
  model: string;
  voiceName: string;
  sessionDurationSeconds: number;
  reconnectCount: number;
  packetsSent: number;
  packetsReceived: number;
  lastPingMs: number | null;
  hasWarning: boolean;
  warningMessage: string | null;
  canInterrupt: boolean;
  usage: { promptTokens: number; candidatesTokens: number; totalTokens: number };
  transcriptLog: { id: string; timestamp: number; speaker: 'examiner' | 'candidate'; text: string; isFinal: boolean }[];
  rawEventLog: ProviderDiagnosticsLog[];
}

export interface RealtimeVoiceProvider {
  initialize(config: RealtimeVoiceConfig): Promise<void>;
  sendAudio(chunk: Int16Array): void;
  sendTextMessage(text: string): void;
  /** Send an internal turn that triggers the model without adding a fake candidate transcript. */
  sendControlMessage?(text: string): void;
  /** Explicitly close the current realtime audio stream while automatic VAD is enabled. */
  endAudioStream?(): void;
  /** Start one app-controlled user speech activity when manual VAD is enabled. */
  startUserActivity?(): void;
  /** End the app-controlled user speech activity and let the model respond. */
  endUserActivity?(): void;
  disconnect(): Promise<void>;
  
  // Optional diagnostics and live controls
  getDiagnostics?(): ProviderDiagnostics;
  reconnect?(): Promise<void>;
  setAllowInterruption?(allow: boolean): void;
}

