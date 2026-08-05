const API_REVISION = '1.2.1-mint-zero-imports';
const runtimeEnv: Record<string, string | undefined> = (globalThis as any)?.process?.env || {};

function makeRequestId() {
  return `mint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function send(res: any, status: number, body: Record<string, unknown>) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

async function readJsonSafe(response: Response) {
  const text = await response.text();
  try {
    return { payload: text ? JSON.parse(text) : {}, text };
  } catch {
    return { payload: {}, text };
  }
}

function upstreamMessage(payload: any, fallback: string) {
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}

export default async function handler(req: any, res: any) {
  const requestId = makeRequestId();

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, {
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
      requestId,
      apiRevision: API_REVISION,
    });
  }

  try {
    const authHeader = String(req.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) {
      return send(res, 401, {
        error: 'Authentication is required to start a live voice session.',
        code: 'AUTH_REQUIRED',
        stage: 'authentication',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      return send(res, 401, {
        error: 'The Firebase ID token is empty.',
        code: 'AUTH_TOKEN_EMPTY',
        stage: 'authentication',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    // Verify the Firebase ID token without importing firebase-admin. This keeps
    // the Vercel function bootstrap extremely small and avoids the dependency
    // that was crashing before the request handler could execute.
    const firebaseWebApiKey = String(
      runtimeEnv.FIREBASE_WEB_API_KEY || runtimeEnv.VITE_FIREBASE_API_KEY || ''
    ).trim();

    if (!firebaseWebApiKey) {
      return send(res, 503, {
        error: 'Firebase Web API key is not available to the server function.',
        code: 'FIREBASE_WEB_API_KEY_MISSING',
        stage: 'firebase_configuration',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const authController = new AbortController();
    const authTimeout = setTimeout(() => authController.abort(), 10_000);

    let authResponse: Response;
    try {
      authResponse = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
          signal: authController.signal,
        }
      );
    } catch (error: any) {
      const timedOut = error?.name === 'AbortError';
      return send(res, 502, {
        error: timedOut
          ? 'Firebase authentication verification timed out.'
          : 'Could not reach Firebase Authentication to verify the user.',
        code: timedOut ? 'FIREBASE_AUTH_TIMEOUT' : 'FIREBASE_AUTH_NETWORK_ERROR',
        stage: 'authentication',
        requestId,
        apiRevision: API_REVISION,
      });
    } finally {
      clearTimeout(authTimeout);
    }

    const authResult = await readJsonSafe(authResponse);
    if (!authResponse.ok || !Array.isArray(authResult.payload?.users) || !authResult.payload.users[0]?.localId) {
      const firebaseCode = authResult.payload?.error?.message || 'INVALID_ID_TOKEN';
      return send(res, 401, {
        error: 'Your sign-in session could not be verified. Sign in again and retry.',
        code: String(firebaseCode),
        stage: 'authentication',
        upstreamStatus: authResponse.status,
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const geminiApiKey = String(runtimeEnv.GEMINI_API_KEY || '').trim();
    if (!geminiApiKey || geminiApiKey === 'MY_GEMINI_API_KEY') {
      return send(res, 503, {
        error: 'GEMINI_API_KEY is not configured on the server.',
        code: 'GEMINI_NOT_CONFIGURED',
        stage: 'gemini_configuration',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    const geminiController = new AbortController();
    const geminiTimeout = setTimeout(() => geminiController.abort(), 12_000);

    let geminiResponse: Response;
    try {
      geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
        }),
        signal: geminiController.signal,
      });
    } catch (error: any) {
      const timedOut = error?.name === 'AbortError';
      return send(res, 502, {
        error: timedOut
          ? 'Gemini token provisioning timed out.'
          : 'Could not reach the Gemini token service.',
        code: timedOut ? 'GEMINI_TOKEN_TIMEOUT' : 'GEMINI_TOKEN_NETWORK_ERROR',
        stage: 'gemini_token_request',
        requestId,
        apiRevision: API_REVISION,
      });
    } finally {
      clearTimeout(geminiTimeout);
    }

    const geminiResult = await readJsonSafe(geminiResponse);
    if (!geminiResponse.ok) {
      const errorStatus = typeof geminiResult.payload?.error?.status === 'string'
        ? geminiResult.payload.error.status
        : `GEMINI_HTTP_${geminiResponse.status}`;

      return send(res, 502, {
        error: upstreamMessage(
          geminiResult.payload,
          `Gemini token service returned HTTP ${geminiResponse.status}.`
        ),
        code: errorStatus,
        stage: 'gemini_token_request',
        upstreamStatus: geminiResponse.status,
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const token = typeof geminiResult.payload?.name === 'string'
      ? geminiResult.payload.name
      : '';

    if (!token) {
      return send(res, 502, {
        error: 'Gemini token provisioning returned no usable ephemeral token.',
        code: 'GEMINI_TOKEN_EMPTY',
        stage: 'gemini_token_response',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    return send(res, 200, {
      token,
      sandbox: false,
      expiresAt: geminiResult.payload?.expireTime || expireTime,
      apiVersion: 'v1beta',
      apiRevision: API_REVISION,
      requestId,
    });
  } catch (error: any) {
    console.error('[Gemini mint zero-imports] Unexpected handler error', requestId, error?.name, error?.message);
    return send(res, 500, {
      error: 'The Gemini token endpoint encountered an unexpected runtime error.',
      code: 'GEMINI_MINT_UNEXPECTED_ERROR',
      stage: 'session_mint',
      runtimeErrorName: error?.name || undefined,
      requestId,
      apiRevision: API_REVISION,
    });
  }
}
