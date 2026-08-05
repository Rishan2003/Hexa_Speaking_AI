/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LOCAL_HISTORY_STORAGE_KEY, LOCAL_USER_STORAGE_KEY } from './config.shared';

// Safe browser-facing environment variables
// Vite injects import.meta.env in browser bundles, but shared modules are also imported by Node.
// Reading through this guarded object keeps the same config module safe in both runtimes.
type BrowserEnv = Partial<Record<
  | 'VITE_USE_MOCKS'
  | 'VITE_GEMINI_LIVE_MODEL'
  | 'VITE_GEMINI_EVALUATION_MODEL'
  | 'VITE_APP_URL',
  string
>>;

const viteEnv: BrowserEnv =
  (import.meta as ImportMeta & { env?: BrowserEnv }).env ?? {};

const storedMockPreference = (() => {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('speakready_use_mocks_flag_v1_0_5');
  } catch {
    return null;
  }
})();

// Real voice is the safe default. Mock mode must be explicitly enabled.
const defaultMockMode = viteEnv.VITE_USE_MOCKS === 'true';

export const APP_CONFIG = {
  // Use mock mode if explicitly configured, or fallback if credentials/Firebase are unconfigured
  useMocks: storedMockPreference === null ? defaultMockMode : storedMockPreference === 'true',

  // Active production real-time voice provider
  defaultRealtimeProvider: 'gemini-live' as 'gemini-live' | 'mock' | 'openai-realtime',

  // Feature flag for future OpenAI Realtime Provider adapter (Disabled)
  enableOpenAIRealtime: false,

  // Live real-time audio voice examiner model identifier
  geminiVoiceModel: viteEnv.VITE_GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',

  // Written evaluation and grading feedback model identifier
  geminiEvaluationModel: viteEnv.VITE_GEMINI_EVALUATION_MODEL || 'gemini-3.6-flash',

  // Target App URL
  appUrl:
    viteEnv.VITE_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'),

  // Simple key for local development mock storage
  localHistoryStorageKey: LOCAL_HISTORY_STORAGE_KEY,
  localUserStorageKey: LOCAL_USER_STORAGE_KEY,
};
