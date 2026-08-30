/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RealtimeVoiceProvider, RealtimeProviderType } from './voiceContract';
import { GeminiLiveAdapter } from './geminiLiveAdapter';
import { MockVoiceAdapter } from './mockVoiceAdapter';
import { OpenAIRealtimeAdapter, OPENAI_REALTIME_CONFIG } from './openaiRealtimeAdapter';
import { APP_CONFIG } from '../config';

/**
 * Normalized Voice Provider Factory.
 * Instantiates the appropriate RealtimeVoiceProvider adapter based on configuration and feature flags.
 *
 * @param requestedProvider Optional provider override ('gemini-live' | 'mock' | 'openai-realtime')
 * @returns An initialized RealtimeVoiceProvider instance
 */
export function getRealtimeVoiceProvider(
  requestedProvider?: RealtimeProviderType
): RealtimeVoiceProvider {
  // 1. Check if global mock mode is forced
  if (APP_CONFIG.useMocks || requestedProvider === 'mock') {
    return new MockVoiceAdapter();
  }

  const selectedProvider = requestedProvider || APP_CONFIG.defaultRealtimeProvider || 'gemini-live';

  switch (selectedProvider) {
    case 'openai-realtime':
      return new OpenAIRealtimeAdapter();

    case 'mock':
      return new MockVoiceAdapter();

    case 'gemini-live':
    default:
      return new GeminiLiveAdapter();
  }
}

/**
 * Get available voice providers for admin/diagnostic inspection without exposing unfinished features to students.
 */
export function getAvailableVoiceProviders(): Array<{
  id: RealtimeProviderType;
  name: string;
  isProductionReady: boolean;
  enabled: boolean;
}> {
  return [
    {
      id: 'gemini-live',
      name: 'Gemini Live Voice Examiner (fallback)',
      isProductionReady: true,
      enabled: true
    },
    {
      id: 'mock',
      name: 'Local Browser Sandbox Examiner',
      isProductionReady: true,
      enabled: true
    },
    {
      id: 'openai-realtime',
      name: 'OpenAI Realtime Examiner (WebRTC)',
      isProductionReady: true,
      enabled: OPENAI_REALTIME_CONFIG.enabled || APP_CONFIG.enableOpenAIRealtime
    }
  ];
}
