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

  it('2. OpenAIRealtimeAdapter is disabled by feature flag and throws on initialize', async () => {
    const openAIAdapter = new OpenAIRealtimeAdapter();
    const statusChanges: string[] = [];
    const errors: Error[] = [];

    const config: RealtimeVoiceConfig = {
      sampleRate: 24000,
      onTranscript: vi.fn(),
      onError: (err) => errors.push(err),
      onStatusChange: (status) => statusChanges.push(status)
    };

    await expect(openAIAdapter.initialize(config)).rejects.toThrow(
      'OpenAI Realtime Adapter is currently disabled by feature flag in this build.'
    );

    expect(statusChanges).toContain('connecting');
    expect(statusChanges[statusChanges.length - 1]).toBe('disconnected');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('disabled by feature flag');
  });

  it('3. OpenAIRealtimeAdapter provides compliant ProviderDiagnostics even when disabled', () => {
    const openAIAdapter = new OpenAIRealtimeAdapter();
    const diagnostics: ProviderDiagnostics = openAIAdapter.getDiagnostics();

    expect(diagnostics.providerName).toBe('OpenAIRealtimeAdapter');
    expect(diagnostics.status).toBe('disconnected');
    expect(diagnostics.model).toBe(OPENAI_REALTIME_CONFIG.model);
    expect(diagnostics.hasWarning).toBe(true);
    expect(diagnostics.warningMessage).toContain('disabled by feature flag');
    expect(Array.isArray(diagnostics.transcriptLog)).toBe(true);
    expect(Array.isArray(diagnostics.rawEventLog)).toBe(true);
  });

  it('4. getRealtimeVoiceProvider factory returns appropriate provider based on config', () => {
    // 1. Production default returns GeminiLiveAdapter
    const defaultProvider = getRealtimeVoiceProvider('gemini-live');
    expect(defaultProvider).toBeInstanceOf(GeminiLiveAdapter);

    // 2. Explicit mock provider returns MockVoiceAdapter
    const mockProvider = getRealtimeVoiceProvider('mock');
    expect(mockProvider).toBeInstanceOf(MockVoiceAdapter);

    // 3. OpenAI request returns OpenAIRealtimeAdapter stub
    const openAIProvider = getRealtimeVoiceProvider('openai-realtime');
    expect(openAIProvider).toBeInstanceOf(OpenAIRealtimeAdapter);
  });

  it('5. getAvailableVoiceProviders lists Gemini as production ready and OpenAI as disabled', () => {
    const providers = getAvailableVoiceProviders();
    expect(providers.length).toBe(3);

    const gemini = providers.find((p) => p.id === 'gemini-live');
    expect(gemini).toBeDefined();
    expect(gemini?.isProductionReady).toBe(true);
    expect(gemini?.enabled).toBe(true);

    const openai = providers.find((p) => p.id === 'openai-realtime');
    expect(openai).toBeDefined();
    expect(openai?.isProductionReady).toBe(false);
    expect(openai?.enabled).toBe(false);
  });
});
