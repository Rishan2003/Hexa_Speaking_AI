/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiLiveAdapter, LIVE_CONFIG } from '../realtime/geminiLiveAdapter';
import { RealtimeVoiceConfig, ProviderDiagnostics } from '../realtime/voiceContract';
import { APP_CONFIG } from '../config';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 1);
  }

  send(data: string): void {
    this.sentMessages.push(data);
    const payload = JSON.parse(data);
    if (payload.setup) {
      setTimeout(() => this.simulateMessage({ setupComplete: {} }), 0);
    }
  }

  close(code = 1000, reason = 'Normal close'): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  simulateBlobMessage(data: unknown): void {
    this.onmessage?.({
      data: new Blob([JSON.stringify(data)], { type: 'application/json' }),
    } as MessageEvent);
  }
}

describe('GeminiLiveAdapter', () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let originalFetch: typeof globalThis.fetch;
  let originalUseMocks: boolean;

  beforeEach(() => {
    originalUseMocks = APP_CONFIG.useMocks;
    APP_CONFIG.useMocks = false;
    MockWebSocket.instances = [];
    originalWebSocket = globalThis.WebSocket;
    originalFetch = globalThis.fetch;

    (globalThis as any).WebSocket = MockWebSocket;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/session/mint') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ token: 'mock-ephemeral-token-12345' }),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Not Found' }),
      } as Response;
    });
  });

  afterEach(() => {
    APP_CONFIG.useMocks = originalUseMocks;
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('mints a token, waits for setupComplete, and sends current setup payload', async () => {
    const provider = new GeminiLiveAdapter();
    const statusChanges: string[] = [];
    let receivedError: Error | null = null;

    const config: RealtimeVoiceConfig = {
      sampleRate: 16000,
      sessionId: 'session-test-paid-access',
      systemInstruction: 'You are an official IELTS examiner.',
      onTranscript: () => {},
      onError: (error) => { receivedError = error; },
      onStatusChange: (status) => statusChanges.push(status),
    };

    await provider.initialize(config);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/session/mint',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: 'session-test-paid-access' }),
      })
    );
    expect(statusChanges).toContain('connecting');
    expect(statusChanges).toContain('connected');
    expect(receivedError).toBeNull();

    const socket = MockWebSocket.instances[0];
    expect(socket.url).toContain('v1beta.GenerativeService.BidiGenerateContentConstrained');
    expect(socket.url).toContain('access_token=mock-ephemeral-token-12345');
    expect(socket.url).not.toContain('key=');

    const setupPayload = JSON.parse(socket.sentMessages[0]);
    expect(setupPayload.setup.model).toBe(`models/${LIVE_CONFIG.model}`);
    expect(
      setupPayload.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName
    ).toBe(LIVE_CONFIG.voiceName);
    expect(setupPayload.setup.systemInstruction.parts[0].text).toBe(
      'You are an official IELTS examiner.'
    );
    expect(setupPayload.setup.realtimeInputConfig.activityHandling).toBe(
      'START_OF_ACTIVITY_INTERRUPTS'
    );

    await provider.disconnect();
  });

  it('uses manual activity boundaries when requested for a Part 2 long turn', async () => {
    const provider = new GeminiLiveAdapter();

    await provider.initialize({
      sampleRate: 16000,
      activityDetectionMode: 'manual',
      allowInterruption: false,
      onTranscript: () => {},
      onError: () => {},
      onStatusChange: () => {},
    });

    const socket = MockWebSocket.instances[0];
    const setupPayload = JSON.parse(socket.sentMessages[0]);
    expect(setupPayload.setup.realtimeInputConfig.automaticActivityDetection).toEqual({
      disabled: true,
    });
    expect(setupPayload.setup.realtimeInputConfig.activityHandling).toBe('NO_INTERRUPTION');

    provider.startUserActivity();
    provider.sendAudio(new Int16Array([100, -100, 250, -250]));
    provider.endUserActivity();

    const realtimeMessages = socket.sentMessages.slice(1).map((message) => JSON.parse(message));
    expect(realtimeMessages[0]).toEqual({ realtimeInput: { activityStart: {} } });
    expect(realtimeMessages[1].realtimeInput.audio).toBeDefined();
    expect(realtimeMessages[2]).toEqual({ realtimeInput: { activityEnd: {} } });

    await provider.disconnect();
  });

  it('accepts setupComplete when Gemini sends the JSON envelope as a Blob', async () => {
    const originalSend = MockWebSocket.prototype.send;
    MockWebSocket.prototype.send = function sendWithoutAutomaticSetup(data: string): void {
      this.sentMessages.push(data);
      const payload = JSON.parse(data);
      if (payload.setup) {
        setTimeout(() => this.simulateBlobMessage({ setupComplete: {} }), 0);
      }
    };

    try {
      const provider = new GeminiLiveAdapter();
      const statusChanges: string[] = [];
      await provider.initialize({
        sampleRate: 16000,
        onTranscript: () => {},
        onError: () => {},
        onStatusChange: (status) => statusChanges.push(status),
      });

      expect(statusChanges).toContain('connected');
      await provider.disconnect();
    } finally {
      MockWebSocket.prototype.send = originalSend;
    }
  });

  it('can trigger the examiner with an internal control turn without a fake candidate transcript', async () => {
    const provider = new GeminiLiveAdapter();
    const transcripts: unknown[] = [];
    await provider.initialize({
      sampleRate: 16000,
      onTranscript: (...args) => transcripts.push(args),
      onError: () => {},
      onStatusChange: () => {},
    });

    const socket = MockWebSocket.instances[0];
    provider.sendControlMessage?.('Begin the test now.');

    const payload = JSON.parse(socket.sentMessages[1]);
    expect(payload.realtimeInput.text).toBe('Begin the test now.');
    expect(payload.clientContent).toBeUndefined();
    expect(transcripts).toHaveLength(0);

    await provider.disconnect();
  });

  it('sends microphone PCM through realtimeInput.audio', async () => {
    const provider = new GeminiLiveAdapter();
    await provider.initialize({
      sampleRate: 16000,
      onTranscript: () => {},
      onError: () => {},
      onStatusChange: () => {},
    });

    const socket = MockWebSocket.instances[0];
    provider.sendAudio(new Int16Array([100, -200, 300, -400, 500]));

    expect(socket.sentMessages).toHaveLength(2);
    const audioMessage = JSON.parse(socket.sentMessages[1]);
    expect(audioMessage.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(typeof audioMessage.realtimeInput.audio.data).toBe('string');

    await provider.disconnect();
  });

  it('normalizes audio, transcription, turn state, and usage metadata', async () => {
    const provider = new GeminiLiveAdapter();
    const transcripts: { speaker: string; text: string }[] = [];
    const usageUpdates: unknown[] = [];
    const turnChanges: unknown[] = [];
    let audioOutputPcm: Int16Array | null = null;
    let audioRate = 0;

    await provider.initialize({
      sampleRate: 16000,
      onTranscript: (speaker, text) => transcripts.push({ speaker, text }),
      onAudioOutput: (pcm, sampleRate) => {
        audioOutputPcm = pcm;
        audioRate = sampleRate;
      },
      onTurnChange: (speaker, isComplete) => turnChanges.push({ speaker, isComplete }),
      onUsageUpdate: (usage) => usageUpdates.push(usage),
      onError: () => {},
      onStatusChange: () => {},
    });

    MockWebSocket.instances[0].simulateMessage({
      usageMetadata: {
        promptTokenCount: 120,
        responseTokenCount: 45,
        totalTokenCount: 165,
      },
      serverContent: {
        outputTranscription: { text: 'Hello candidate, welcome to Part 1.' },
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AABBCCDD' } }],
        },
        turnComplete: true,
      },
    });

    expect(transcripts).toEqual([
      { speaker: 'examiner', text: 'Hello candidate, welcome to Part 1.' },
    ]);
    expect(turnChanges).toEqual([{ speaker: 'examiner', isComplete: true }]);
    expect(usageUpdates).toEqual([
      { promptTokens: 120, candidatesTokens: 45, totalTokens: 165 },
    ]);
    expect(audioOutputPcm).not.toBeNull();
    expect(audioRate).toBe(24000);

    await provider.disconnect();
  });

  it('reconnects with the latest session-resumption handle', async () => {
    const provider = new GeminiLiveAdapter();
    await provider.initialize({
      sampleRate: 16000,
      onTranscript: () => {},
      onError: () => {},
      onStatusChange: () => {},
    });

    MockWebSocket.instances[0].simulateMessage({
      sessionResumptionUpdate: {
        resumable: true,
        newHandle: 'resume-handle-1',
      },
    });

    await provider.reconnect();
    const replacementSocket = MockWebSocket.instances[1];
    const setupPayload = JSON.parse(replacementSocket.sentMessages[0]);
    expect(setupPayload.setup.sessionResumption.handle).toBe('resume-handle-1');

    await provider.disconnect();
  });

  it('handles interruptions when enabled', async () => {
    const provider = new GeminiLiveAdapter();
    let interrupted = false;

    await provider.initialize({
      sampleRate: 16000,
      allowInterruption: true,
      onInterrupted: () => { interrupted = true; },
      onTranscript: () => {},
      onError: () => {},
      onStatusChange: () => {},
    });

    MockWebSocket.instances[0].simulateMessage({ serverContent: { interrupted: true } });
    expect(interrupted).toBe(true);
    await provider.disconnect();
  });

  it('reports connected provider diagnostics', async () => {
    const provider = new GeminiLiveAdapter();
    await provider.initialize({
      sampleRate: 16000,
      onTranscript: () => {},
      onError: () => {},
      onStatusChange: () => {},
    });

    const diagnostics: ProviderDiagnostics = provider.getDiagnostics!();
    expect(diagnostics.providerName).toBe('GeminiLiveProvider');
    expect(diagnostics.status).toBe('connected');
    expect(diagnostics.model).toBe(LIVE_CONFIG.model);
    expect(diagnostics.voiceName).toBe(LIVE_CONFIG.voiceName);
    expect(diagnostics.canInterrupt).toBe(true);
    expect(diagnostics.rawEventLog.length).toBeGreaterThan(0);

    await provider.disconnect();
  });

  it('disconnects cleanly without false errors', async () => {
    const provider = new GeminiLiveAdapter();
    const errors: Error[] = [];
    let finalStatus = '';

    await provider.initialize({
      sampleRate: 16000,
      onTranscript: () => {},
      onError: (error) => errors.push(error),
      onStatusChange: (status) => { finalStatus = status; },
    });

    await provider.disconnect();
    expect(errors).toHaveLength(0);
    expect(finalStatus).toBe('disconnected');
  });
});
