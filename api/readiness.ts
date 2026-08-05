function hasFirebaseAdminCredentials(): boolean {
  const hasThreePartServiceAccount = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );

  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    hasThreePartServiceAccount ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

export default function readiness(_req: any, res: any) {
  const geminiApiKeyConfigured = Boolean(
    process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
    process.env.GEMINI_API_KEY.trim()
  );
  const firebaseServerConfigured = hasFirebaseAdminCredentials();
  const allowedOriginsConfigured = Boolean(process.env.ALLOWED_ORIGINS?.trim());
  const ready = geminiApiKeyConfigured && firebaseServerConfigured;

  res.setHeader('Cache-Control', 'no-store');
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'misconfigured',
    runtime: 'vercel',
    apiRevision: '1.1.8',
    timestamp: Date.now(),
    environment: {
      geminiApiKeyConfigured,
      firebaseServerConfigured,
      allowedOriginsConfigured,
      geminiLiveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
      geminiEvaluationModel: process.env.GEMINI_EVALUATION_MODEL || 'gemini-3.6-flash',
    },
    warnings: [
      ...(!geminiApiKeyConfigured ? ['GEMINI_API_KEY is missing or invalid.'] : []),
      ...(!firebaseServerConfigured ? ['Firebase Admin credentials are missing.'] : []),
      ...(!allowedOriginsConfigured ? ['ALLOWED_ORIGINS is not configured.'] : []),
    ],
  });
}
