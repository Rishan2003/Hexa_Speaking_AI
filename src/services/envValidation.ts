/**
 * SpeakReady IELTS Environment Variable Inspector and Validator
 * @license Apache-2.0
 */

export interface EnvValidationReport {
  geminiApiKeyConfigured: boolean;
  geminiLiveModel: string;
  geminiEvaluationModel: string;
  firebaseServerConfigured: boolean;
  allowedOriginsConfigured: boolean;
  status: 'ready' | 'degraded_sandbox' | 'misconfigured';
  warnings: string[];
}

function hasFirebaseAdminCredentials(): boolean {
  const hasThreePartServiceAccount = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );

  const hasDefaultCredentialContext = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.K_SERVICE ||
    process.env.FUNCTION_TARGET ||
    process.env.GAE_ENV ||
    process.env.FIREBASE_CONFIG
  );

  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    hasThreePartServiceAccount ||
    hasDefaultCredentialContext
  );
}

export function validateEnvironmentVariables(): EnvValidationReport {
  const warnings: string[] = [];

  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiApiKeyConfigured = Boolean(
    geminiApiKey && geminiApiKey !== 'MY_GEMINI_API_KEY' && geminiApiKey.trim() !== ''
  );

  if (!geminiApiKeyConfigured) {
    warnings.push('GEMINI_API_KEY is missing or set to a placeholder. Gemini Live token minting and server-side AI evaluation are unavailable.');
  }

  const geminiLiveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
  const geminiEvaluationModel = process.env.GEMINI_EVALUATION_MODEL || 'gemini-3.6-flash';

  const firebaseServerConfigured = hasFirebaseAdminCredentials();
  if (!firebaseServerConfigured) {
    warnings.push(
      'Firebase Admin credentials are not configured. A Firebase project ID or web-client config alone is not a server credential.'
    );
  }

  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  const allowedOriginsConfigured = Boolean(allowedOrigins && allowedOrigins.trim() !== '');
  if (process.env.NODE_ENV === 'production' && !allowedOriginsConfigured) {
    warnings.push('ALLOWED_ORIGINS is empty in production; cross-origin browser requests will not be permitted.');
  }

  const isReady = geminiApiKeyConfigured && firebaseServerConfigured;
  const status: EnvValidationReport['status'] = isReady
    ? 'ready'
    : process.env.NODE_ENV === 'production'
      ? 'misconfigured'
      : 'degraded_sandbox';

  return {
    geminiApiKeyConfigured,
    geminiLiveModel,
    geminiEvaluationModel,
    firebaseServerConfigured,
    allowedOriginsConfigured,
    status,
    warnings,
  };
}
