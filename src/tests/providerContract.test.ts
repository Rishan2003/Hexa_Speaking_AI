/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeVoiceProvider, RealtimeVoiceConfig, ProviderDiagnostics } from '../realtime/voiceContract';
import { GeminiLiveAdapter } from '../realtime/geminiLiveAdapter';
import { MockVoiceAdapter } from '../realtime/mockVoiceAdapter';
import { OpenAIRealtimeAdapter, OPENAI_REALTIME_CONFIG } from '../realtime/openaiRealtimeAdapter';
import { getRealtimeVoiceProvider, getAvailableVoiceProviders } from '../realtime/providerFactory';
import { APP_CONFIG } from '../config';

describe('RealtimeVoiceProvider Contract & Feature Flag Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('1. All adapters implement the core RealtimeVoiceProvider interface methods', () => {
    const mockAdapter = new MockVoiceAdapter();
    const geminiAdapter = new GeminiLiveAdapter();
    const openAIAdapter = new OpenAIRealtimeAdapter();

    const adapters: RealtimeVoiceProvider[] = [mockAdapter, geminiAdapter, openAIAdapter];

    adapters.forEach((adapter) => {
      expect(typeof adapter.initialize).toBe('function');
      expect(typeof adapter.sendAudio).toBe('function');
      expect(typeof adapter.sendTextMessage).toBe('function');
      expect(typeof adapter.disconnect).toBe('function');

      // Optional contract methods
      if (adapter.getDiagnostics) {
        expect(typeof adapter.getDiagnostics).toBe('function');
      }
      if (adapter.reconnect) {
        expect(typeof adapter.reconnect).toBe('function');
      }
      if (adapter.setAllowInterruption) {
        expect(typeof adapter.setAllowInterruption).toBe('function');
      }
    });
  });

  it('2. OpenAIRealtimeAdapter requires an active microphone MediaStream', async () => {
    const openAIAdapter = new OpenAIRealtimeAdapter();
    const config: RealtimeVoiceConfig = {
      sampleRate: 24000,
      onTranscript: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn()
    };

    await expect(openAIAdapter.initialize(config)).rejects.toThrow(
      'OpenAI Realtime requires an active microphone MediaStream.'
    );
  });

  it('3. OpenAIRealtimeAdapter provides compliant ProviderDiagnostics before connection', () => {
    const openAIAdapter = new OpenAIRealtimeAdapter();
    const diagnostics: ProviderDiagnostics = openAIAdapter.getDiagnostics();

    expect(diagnostics.providerName).toBe('OpenAIRealtimeProvider');
    expect(diagnostics.status).toBe('disconnected');
    expect(diagnostics.model).toBe(OPENAI_REALTIME_CONFIG.model);
    expect(diagnostics.hasWarning).toBe(false);
    expect(diagnostics.warningMessage).toBeNull();
    expect(Array.isArray(diagnostics.transcriptLog)).toBe(true);
    expect(Array.isArray(diagnostics.rawEventLog)).toBe(true);
  });

  it('4. getRealtimeVoiceProvider factory returns appropriate provider based on config', () => {
    // 1. Production default is OpenAI Realtime
    const defaultProvider = getRealtimeVoiceProvider('openai-realtime');
    expect(defaultProvider).toBeInstanceOf(OpenAIRealtimeAdapter);

    // Gemini remains available as an explicit fallback
    const geminiProvider = getRealtimeVoiceProvider('gemini-live');
    expect(geminiProvider).toBeInstanceOf(GeminiLiveAdapter);

    // 2. Explicit mock provider returns MockVoiceAdapter
    const mockProvider = getRealtimeVoiceProvider('mock');
    expect(mockProvider).toBeInstanceOf(MockVoiceAdapter);

    // 3. OpenAI request returns OpenAIRealtimeAdapter
    const openAIProvider = getRealtimeVoiceProvider('openai-realtime');
    expect(openAIProvider).toBeInstanceOf(OpenAIRealtimeAdapter);
  });

  it('5. getAvailableVoiceProviders lists OpenAI and Gemini as production-ready providers', () => {
    const providers = getAvailableVoiceProviders();
    expect(providers.length).toBe(3);

    const gemini = providers.find((p) => p.id === 'gemini-live');
    expect(gemini).toBeDefined();
    expect(gemini?.isProductionReady).toBe(true);
    expect(gemini?.enabled).toBe(true);

    const openai = providers.find((p) => p.id === 'openai-realtime');
    expect(openai).toBeDefined();
    expect(openai?.isProductionReady).toBe(true);
    expect(openai?.enabled).toBe(true);
  });
});
