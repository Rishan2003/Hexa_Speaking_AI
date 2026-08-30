import { ensureSessionFirebaseAdmin, firebaseCredentialPresence } from './_firebaseSessionAdmin';

const API_REVISION = '1.2.0-openai-realtime';

export default async function readiness(_req: any, res: any) {
  const geminiApiKeyConfigured = Boolean(
    process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
    process.env.GEMINI_API_KEY.trim()
  );
  const openaiApiKeyConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const firebaseServerConfigured = firebaseCredentialPresence();
  const allowedOriginsConfigured = Boolean(process.env.ALLOWED_ORIGINS?.trim());

  let firebaseAdminInitialized = false;
  let firestoreReachable = false;
  let firebaseDiagnostic: string | undefined;

  if (firebaseServerConfigured) {
    try {
      const { db } = ensureSessionFirebaseAdmin();
      firebaseAdminInitialized = true;
      await Promise.race([
        db.collection('__hexa_health__').limit(1).get(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore probe timed out after 6 seconds.')), 6000)),
      ]);
      firestoreReachable = true;
    } catch (error: any) {
      firebaseDiagnostic = String(error?.message || 'Firebase Admin/Firestore probe failed.').slice(0, 500);
    }
  }

  const ready = geminiApiKeyConfigured && openaiApiKeyConfigured && firebaseServerConfigured && firebaseAdminInitialized;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(ready ? 200 : 503).json({
    status: ready ? (firestoreReachable ? 'ready' : 'degraded') : 'misconfigured',
    runtime: 'vercel',
    apiRevision: API_REVISION,
    timestamp: Date.now(),
    environment: {
      geminiApiKeyConfigured,
      openaiApiKeyConfigured,
      openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
      openaiRealtimeVoice: process.env.OPENAI_REALTIME_VOICE || 'marin',
      firebaseServerConfigured,
      firebaseAdminInitialized,
      firestoreReachable,
      allowedOriginsConfigured,
      geminiLiveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
      geminiEvaluationModel: process.env.GEMINI_EVALUATION_MODEL || 'gemini-3.6-flash',
    },
    warnings: [
      ...(!openaiApiKeyConfigured ? ['OPENAI_API_KEY is missing; live speaking sessions cannot start.'] : []),
      ...(!geminiApiKeyConfigured ? ['GEMINI_API_KEY is missing or invalid; post-test evaluation cannot run.'] : []),
      ...(!firebaseServerConfigured ? ['Firebase Admin credentials are missing.'] : []),
      ...(firebaseServerConfigured && !firebaseAdminInitialized ? ['Firebase Admin credentials are present but cannot initialize.'] : []),
      ...(firebaseAdminInitialized && !firestoreReachable ? ['Firebase Admin initialized, but Firestore is not reachable. Session launch will use recovery persistence.'] : []),
      ...(!allowedOriginsConfigured ? ['ALLOWED_ORIGINS is not configured.'] : []),
    ],
    ...(firebaseDiagnostic ? { firebaseDiagnostic } : {}),
  });
}
