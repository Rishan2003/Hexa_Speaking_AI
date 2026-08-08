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

export const LIVE_CONFIG = {
  model: import.meta.env.VITE_GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
  voiceName: import.meta.env.VITE_GEMINI_LIVE_VOICE || 'Kore',
  rotationWarningSeconds: 480,
  rotationRequestedSeconds: 540,
  maxReconnectAttempts: 5,
  setupTimeoutMs: 12_000,
};

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export class GeminiLiveAdapter implements RealtimeVoiceProvider {
  private config: RealtimeVoiceConfig | null = null;
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';

  private reconnectCount = 0;
  private isIntentionalDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionTimer: ReturnType<typeof setInterval> | null = null;
  private setupTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionDurationSeconds = 0;
  private allowInterruption = true;
  private manualActivityDetection = false;
  private userActivityActive = false;
  private setupComplete = false;
  private resumptionHandle: string | null = null;
  private rotationRequested = false;
  private pendingConnectResolve: (() => void) | null = null;
  private pendingConnectReject: ((error: Error) => void) | null = null;

  private packetsSent = 0;
  private packetsReceived = 0;
  private lastPingMs: number | null = null;
  private pingStartTime: number | null = null;
  private hasWarning = false;
  private warningMessage: string | null = null;
  private usage = { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 };
  private transcriptLog: {
    id: string;
    timestamp: number;
    speaker: 'examiner' | 'candidate';
    text: string;
    isFinal: boolean;
  }[] = [];
  private rawEventLog: ProviderDiagnosticsLog[] = [];

  async initialize(config: RealtimeVoiceConfig): Promise<void> {
    this.config = config;
    this.isIntentionalDisconnect = false;
    this.allowInterruption = config.allowInterruption ?? true;
    this.manualActivityDetection = config.activityDetectionMode === 'manual';
    this.userActivityActive = false;
    this.resumptionHandle = null;
    this.rotationRequested = false;

    if (APP_CONFIG.useMocks) {
      throw new Error('Gemini Live cannot run while VITE_USE_MOCKS is enabled.');
    }

    await this.connectWithToken();
  }

  private async connectWithToken(): Promise<void> {
    this.clearSetupTimer();
    this.setupComplete = false;
    this.updateStatus('connecting');
    this.addLog('ws', `Initiating connection attempt ${this.reconnectCount + 1}/${LIVE_CONFIG.maxReconnectAttempts}`);

    try {
      const idToken = await getFirebaseIdToken();
      const response = await fetch('/api/session/mint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ sessionId: this.config?.sessionId || '' }),
      });

      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = responseBody?.error || response.statusText || `HTTP ${response.status}`;
        const diagnostics = [
          responseBody?.code ? `Code: ${responseBody.code}` : '',
          responseBody?.stage ? `Stage: ${responseBody.stage}` : '',
          responseBody?.upstreamStatus ? `Google HTTP: ${responseBody.upstreamStatus}` : '',
          responseBody?.requestId ? `Request ID: ${responseBody.requestId}` : '',
          responseBody?.apiRevision ? `API: ${responseBody.apiRevision}` : '',
        ].filter(Boolean).join(' · ');
        throw new Error(
          `Failed to mint a Gemini Live token: ${detail}${diagnostics ? `\n${diagnostics}` : ''}`
        );
      }

      const ephemeralToken = responseBody?.token;
      if (!ephemeralToken || typeof ephemeralToken !== 'string') {
        throw new Error('The token endpoint returned an invalid Gemini Live token.');
      }

      // Keep token provisioning and the constrained WebSocket on the same API version.
      // The server currently returns v1beta, but reading this value prevents a future
      // server/client mismatch if Google changes the supported ephemeral-token version.
      const apiVersion = responseBody?.apiVersion === 'v1alpha' ? 'v1alpha' : 'v1beta';
      const wsUrl =
        'wss://generativelanguage.googleapis.com/ws/' +
        `google.ai.generativelanguage.${apiVersion}.GenerativeService.` +
        `BidiGenerateContentConstrained?access_token=${encodeURIComponent(ephemeralToken)}`;

      await new Promise<void>((resolve, reject) => {
        this.pendingConnectResolve = resolve;
        this.pendingConnectReject = reject;

        try {
          const socket = new WebSocket(wsUrl);
          this.socket = socket;

          socket.onopen = () => {
            if (this.socket !== socket) return;
            this.sendSetupConfiguration();
            this.addLog('info', 'WebSocket opened; waiting for Gemini setupComplete.');
            this.setupTimer = setTimeout(() => {
              if (this.socket !== socket) return;
              const error = new Error('Gemini Live setup timed out before setupComplete was received.');
              this.rejectPendingConnection(error);
              this.config?.onError(error);
              socket.close(1011, 'Setup timeout');
            }, LIVE_CONFIG.setupTimeoutMs);
          };

          socket.onmessage = (event) => {
            if (this.socket !== socket) return;
            void this.handleSocketMessage(event).catch((error) => {
              const normalized = this.toError(error);
              this.addLog('error', `Failed to process Gemini WebSocket payload: ${normalized.message}`);
              this.rejectPendingConnection(normalized);
              this.config?.onError(normalized);
            });
          };

          socket.onerror = (event) => {
            if (this.socket !== socket) return;
            const error = new Error(`Gemini Live WebSocket transport error: ${String(event)}`);
            this.addLog('error', error.message);
            this.rejectPendingConnection(error);
            this.config?.onError(error);
          };

          socket.onclose = (event) => {
            // Ignore close events from a socket that has already been replaced.
            if (this.socket !== socket) return;

            this.clearSetupTimer();
            if (this.sessionTimer) {
              clearInterval(this.sessionTimer);
              this.sessionTimer = null;
            }

            this.addLog('ws', `WebSocket closed with code ${event.code}; reason: ${event.reason || 'none'}`);
            if (!this.setupComplete) {
              this.rejectPendingConnection(
                new Error(`Gemini Live connection closed before setup completed (code ${event.code}).`)
              );
            }

            this.socket = null;
            this.updateStatus('disconnected');

            if (!this.isIntentionalDisconnect) {
              this.handleUnexpectedClose();
            }
          };
        } catch (error) {
          this.rejectPendingConnection(this.toError(error));
        }
      });
    } catch (error) {
      const normalized = this.toError(error);
      this.updateStatus('disconnected');
      this.addLog('error', normalized.message);
      throw normalized;
    }
  }

  private sendSetupConfiguration(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const formattedModel = LIVE_CONFIG.model.startsWith('models/')
      ? LIVE_CONFIG.model
      : `models/${LIVE_CONFIG.model}`;

    const setupMessage = {
      setup: {
        model: formattedModel,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: LIVE_CONFIG.voiceName },
            },
          },
        },
        systemInstruction: this.config?.systemInstruction
          ? { parts: [{ text: this.config.systemInstruction }] }
          : undefined,
        realtimeInputConfig: {
          activityHandling: this.allowInterruption
            ? 'START_OF_ACTIVITY_INTERRUPTS'
            : 'NO_INTERRUPTION',
          automaticActivityDetection: this.manualActivityDetection
            ? { disabled: true }
            : {
                disabled: false,
                // Keep normal Parts 1/3 conversational while allowing ordinary
                // thinking pauses to survive longer than Gemini's aggressive
                // default turn segmentation.
                endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                silenceDurationMs: 800,
              },
        },
        sessionResumption: this.resumptionHandle
          ? { handle: this.resumptionHandle }
          : {},
        outputAudioTranscription: {},
        inputAudioTranscription: {},
      },
    };

    this.socket.send(JSON.stringify(setupMessage));
    this.packetsSent++;
  }

  sendAudio(chunk: Int16Array): void {
    if (!this.socket || this.status !== 'connected' || this.socket.readyState !== WebSocket.OPEN) return;

    const sampleRate = this.config?.sampleRate || 16_000;
    const message = {
      realtimeInput: {
        audio: {
          mimeType: `audio/pcm;rate=${sampleRate}`,
          data: this.int16ArrayToBase64(chunk),
        },
      },
    };

    this.socket.send(JSON.stringify(message));
    this.packetsSent++;
  }

  sendTextMessage(text: string): void {
    if (!this.sendRealtimeText(text)) return;
    this.recordTranscript('candidate', text, true);
  }

  sendControlMessage(text: string): void {
    if (this.sendRealtimeText(text)) {
      this.addLog('info', 'Sent an internal realtime text turn to start the examiner response.');
    }
  }

  endAudioStream(): void {
    if (!this.socket || this.status !== 'connected' || this.socket.readyState !== WebSocket.OPEN) return;

    // Gemini's documented manual-VAD mode uses activityStart/activityEnd and
    // does not use audioStreamEnd. Keep this helper harmless during Part 2.
    if (this.manualActivityDetection) {
      this.addLog('info', 'Skipped audioStreamEnd because manual activity detection is enabled.');
      return;
    }

    this.socket.send(JSON.stringify({
      realtimeInput: { audioStreamEnd: true },
    }));
    this.packetsSent++;
    this.addLog('info', 'Closed the current realtime audio stream cleanly.');
  }

  startUserActivity(): void {
    if (!this.manualActivityDetection || this.userActivityActive) return;
    if (!this.socket || this.status !== 'connected' || this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(JSON.stringify({
      realtimeInput: { activityStart: {} },
    }));
    this.packetsSent++;
    this.userActivityActive = true;
    this.addLog('turn', 'Started an app-controlled user activity.');
  }

  endUserActivity(): void {
    if (!this.manualActivityDetection || !this.userActivityActive) return;
    if (!this.socket || this.status !== 'connected' || this.socket.readyState !== WebSocket.OPEN) return;

    this.socket.send(JSON.stringify({
      realtimeInput: { activityEnd: {} },
    }));
    this.packetsSent++;
    this.userActivityActive = false;
    this.addLog('turn', 'Ended the app-controlled user activity.');
  }

  /**
   * Gemini 3.1 Live accepts conversational text through realtimeInput.
   * clientContent is reserved for seeding initial history and is not reliable
   * for normal turns after the first model response.
   */
  private sendRealtimeText(text: string): boolean {
    const normalizedText = text.trim();
    if (!normalizedText) return false;
    if (!this.socket || this.status !== 'connected' || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify({
      realtimeInput: { text: normalizedText },
    }));
    this.packetsSent++;
    return true;
  }

  setAllowInterruption(allow: boolean): void {
    this.allowInterruption = allow;
    this.addLog('info', `Interruption mode set to ${allow}; it applies to the next connection setup.`);
  }

  async reconnect(): Promise<void> {
    this.addLog('info', 'Manual reconnect requested.');
    this.isIntentionalDisconnect = true;
    this.userActivityActive = false;
    this.clearTimers();

    const previousSocket = this.socket;
    this.socket = null;
    if (previousSocket && previousSocket.readyState < WebSocket.CLOSING) {
      previousSocket.close(1000, 'Manual reconnect');
    }

    this.updateStatus('disconnected');
    this.reconnectCount = 0;
    this.isIntentionalDisconnect = false;
    await this.connectWithToken();
  }

  async disconnect(): Promise<void> {
    this.isIntentionalDisconnect = true;
    this.clearTimers();
    this.rejectPendingConnection(new Error('Gemini Live connection was cancelled.'));

    const previousSocket = this.socket;
    this.socket = null;
    if (previousSocket && previousSocket.readyState < WebSocket.CLOSING) {
      previousSocket.close(1000, 'Client disconnect');
    }

    this.resumptionHandle = null;
    this.rotationRequested = false;
    this.updateStatus('disconnected');
    this.addLog('info', 'Cleanly disconnected Gemini Live session.');
  }

  private async handleSocketMessage(event: MessageEvent): Promise<void> {
    this.packetsReceived++;
    const now = Date.now();

    if (this.pingStartTime) {
      this.lastPingMs = now - this.pingStartTime;
      this.pingStartTime = null;
    }

    try {
      // Gemini may deliver its JSON envelope as a text frame, Blob, or ArrayBuffer.
      // JSON.parse(Blob) becomes JSON.parse('[object Blob]'), silently discarding the
      // setupComplete event and eventually causing the setup timeout seen in browsers.
      let rawPayload: string;
      if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
        rawPayload = await event.data.text();
      } else if (event.data instanceof ArrayBuffer) {
        rawPayload = new TextDecoder().decode(event.data);
      } else if (ArrayBuffer.isView(event.data)) {
        rawPayload = new TextDecoder().decode(
          new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
        );
      } else {
        rawPayload = String(event.data);
      }

      const data = JSON.parse(rawPayload);
      this.addLog('ws', `Received event keys: ${Object.keys(data).join(', ')}`);

      if (Object.prototype.hasOwnProperty.call(data, 'setupComplete')) {
        this.setupComplete = true;
        this.clearSetupTimer();
        this.reconnectCount = 0;
        this.updateStatus('connected');
        this.startSessionTimer();
        this.resolvePendingConnection();
        this.addLog('info', 'Gemini Live setup completed successfully.');
      }

      if (data.error) {
        const error = new Error(data.error.message || 'Gemini Live server error.');
        this.addLog('error', error.message);
        this.rejectPendingConnection(error);
        this.config?.onError(error);
        return;
      }

      if (data.warning) {
        const warningText = data.warning.message || 'Gemini Live server warning.';
        this.hasWarning = true;
        this.warningMessage = warningText;
        this.addLog('warning', warningText);
        this.config?.onWarning?.({ code: 'SERVER_WARNING', message: warningText });
      }

      if (data.goAway) {
        const warningText = data.goAway.timeLeft
          ? `Gemini Live requested session migration; time left: ${data.goAway.timeLeft}.`
          : 'Gemini Live requested session migration.';
        this.hasWarning = true;
        this.warningMessage = warningText;
        this.rotationRequested = true;
        this.addLog('warning', warningText);
        this.config?.onWarning?.({ code: 'GO_AWAY', message: warningText });
      }

      if (data.sessionResumptionUpdate) {
        if (data.sessionResumptionUpdate.resumable && data.sessionResumptionUpdate.newHandle) {
          this.resumptionHandle = data.sessionResumptionUpdate.newHandle;
          this.addLog('info', 'Received an updated Gemini session-resumption handle.');
        } else if (data.sessionResumptionUpdate.resumable === false) {
          this.resumptionHandle = null;
        }
      }

      const usageMetadata = data.usageMetadata || data.serverContent?.usageMetadata;
      if (usageMetadata) {
        this.usage = {
          promptTokens: usageMetadata.promptTokenCount || 0,
          candidatesTokens:
            usageMetadata.responseTokenCount || usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0,
        };
        this.config?.onUsageUpdate?.(this.usage);
      }

      const serverContent = data.serverContent;
      if (!serverContent) return;

      if (serverContent.interrupted) {
        this.addLog('interrupted', 'Barge-in signal received.');
        if (this.allowInterruption) this.config?.onInterrupted?.();
      }

      if (serverContent.turnComplete !== undefined) {
        const complete = Boolean(serverContent.turnComplete);
        this.addLog('turn', `Turn state complete: ${complete}`);
        this.config?.onTurnChange?.('examiner', complete);

        if (complete && this.rotationRequested && this.resumptionHandle) {
          this.rotationRequested = false;
          this.addLog('info', 'Rotating the Live connection at a turn boundary with session resumption.');
          void this.reconnect().catch((error) => {
            this.config?.onError(this.toError(error));
          });
        }
      }

      const outputTranscript =
        serverContent.outputTranscription?.text ||
        serverContent.outputAudioTranscription?.text;
      if (outputTranscript) this.recordTranscript('examiner', outputTranscript, true);

      const inputTranscript =
        serverContent.inputTranscription?.text ||
        serverContent.inputAudioTranscription?.text;
      if (inputTranscript) this.recordTranscript('candidate', inputTranscript, true);

      if (serverContent.modelTurn?.parts) {
        for (const part of serverContent.modelTurn.parts) {
          if (part.text) this.recordTranscript('examiner', part.text, true);
          if (part.inlineData?.data) {
            const pcm16 = this.base64ToInt16Array(part.inlineData.data);
            const sampleRate = this.parsePcmSampleRate(part.inlineData.mimeType) || 24_000;
            this.addLog('audio', `Received audio PCM chunk of ${pcm16.length} samples.`);
            this.config?.onAudioOutput?.(pcm16, sampleRate);
          }
        }
      }
    } catch (error) {
      this.addLog('error', `Failed to parse WebSocket payload: ${this.toError(error).message}`);
    }
  }

  private handleUnexpectedClose(): void {
    if (this.isIntentionalDisconnect) return;

    if (this.reconnectCount >= LIVE_CONFIG.maxReconnectAttempts) {
      const error = new Error(
        `Gemini Live connection failed after ${LIVE_CONFIG.maxReconnectAttempts} reconnection attempts.`
      );
      this.addLog('error', error.message);
      this.updateStatus('disconnected');
      this.config?.onError(error);
      return;
    }

    this.reconnectCount++;
    const delayMs = Math.min(1_000 * Math.pow(1.5, this.reconnectCount - 1), 10_000);
    this.addLog(
      'warning',
      `Unexpected disconnect. Reconnect attempt ${this.reconnectCount} starts in ${Math.round(delayMs)}ms.`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWithToken().catch((error) => {
        const normalized = this.toError(error);
        this.addLog('error', `Reconnect failed: ${normalized.message}`);
        if (!this.isIntentionalDisconnect) this.handleUnexpectedClose();
      });
    }, delayMs);
  }

  private startSessionTimer(): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    this.sessionDurationSeconds = 0;
    this.rotationRequested = false;
    this.hasWarning = false;
    this.warningMessage = null;

    this.sessionTimer = setInterval(() => {
      this.sessionDurationSeconds++;

      if (this.sessionDurationSeconds >= LIVE_CONFIG.rotationWarningSeconds && !this.hasWarning) {
        this.hasWarning = true;
        this.warningMessage =
          'The Live connection will rotate at the next safe turn boundary to preserve the session.';
        this.addLog('warning', this.warningMessage);
        this.config?.onWarning?.({
          code: 'DURATION_LIMIT_APPROACHING',
          message: this.warningMessage,
        });
      }

      if (this.sessionDurationSeconds >= LIVE_CONFIG.rotationRequestedSeconds) {
        this.rotationRequested = true;
      }
    }, 1_000);
  }

  private resolvePendingConnection(): void {
    const resolve = this.pendingConnectResolve;
    this.pendingConnectResolve = null;
    this.pendingConnectReject = null;
    resolve?.();
  }

  private rejectPendingConnection(error: Error): void {
    const reject = this.pendingConnectReject;
    this.pendingConnectResolve = null;
    this.pendingConnectReject = null;
    reject?.(error);
  }

  private clearSetupTimer(): void {
    if (this.setupTimer) {
      clearTimeout(this.setupTimer);
      this.setupTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
    this.clearSetupTimer();
  }

  private updateStatus(newStatus: ConnectionStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this.config?.onStatusChange(newStatus);
  }

  private recordTranscript(
    speaker: 'examiner' | 'candidate',
    text: string,
    isFinal: boolean
  ): void {
    const normalizedText = text.trim();
    if (!normalizedText) return;

    const lastItem = this.transcriptLog[this.transcriptLog.length - 1];
    if (
      lastItem &&
      lastItem.speaker === speaker &&
      lastItem.text === normalizedText &&
      Date.now() - lastItem.timestamp < 2_000
    ) {
      return;
    }

    const item = {
      id: `diag-tx-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
      speaker,
      text: normalizedText,
      isFinal,
    };
    this.transcriptLog.push(item);
    if (this.transcriptLog.length > 50) this.transcriptLog.shift();
    this.addLog('transcript', `[${speaker.toUpperCase()}] ${normalizedText}`);
    this.config?.onTranscript(speaker, normalizedText, isFinal);
  }

  private addLog(type: ProviderDiagnosticsLog['type'], details: string): void {
    const entry: ProviderDiagnosticsLog = {
      id: `log-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
      type,
      details,
    };
    this.rawEventLog.push(entry);
    if (this.rawEventLog.length > 100) this.rawEventLog.shift();
  }

  getDiagnostics(): ProviderDiagnostics {
    return {
      providerName: 'GeminiLiveProvider',
      status: this.status,
      model: LIVE_CONFIG.model,
      voiceName: LIVE_CONFIG.voiceName,
      sessionDurationSeconds: this.sessionDurationSeconds,
      reconnectCount: this.reconnectCount,
      packetsSent: this.packetsSent,
      packetsReceived: this.packetsReceived,
      lastPingMs: this.lastPingMs,
      hasWarning: this.hasWarning,
      warningMessage: this.warningMessage,
      canInterrupt: this.allowInterruption,
      usage: { ...this.usage },
      transcriptLog: [...this.transcriptLog],
      rawEventLog: [...this.rawEventLog],
    };
  }

  private parsePcmSampleRate(mimeType?: string): number | null {
    const match = mimeType?.match(/rate=(\d+)/i);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private int16ArrayToBase64(int16: Int16Array): string {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let binary = '';
    for (let index = 0; index < bytes.length; index++) {
      binary += String.fromCharCode(bytes[index]);
    }
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
      return window.btoa(binary);
    }
    return Buffer.from(binary, 'binary').toString('base64');
  }

  private base64ToInt16Array(base64: string): Int16Array {
    let binary = '';
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      binary = window.atob(base64);
    } else {
      binary = Buffer.from(base64, 'base64').toString('binary');
    }
    const evenLength = binary.length - (binary.length % 2);
    const bytes = new Uint8Array(evenLength);
    for (let index = 0; index < evenLength; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Int16Array(bytes.buffer);
  }
}

export { GeminiLiveAdapter as GeminiLiveProvider };
