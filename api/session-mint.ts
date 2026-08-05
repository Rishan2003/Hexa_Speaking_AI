import { randomUUID } from 'node:crypto';
import { ensureSessionFirebaseAdmin, firebaseCredentialPresence } from './_firebaseSessionAdmin';

const API_REVISION = '1.2.0-mint-rest';
const TOKEN_LIMIT_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function requestId() {
  return `mint-${randomUUID()}`;
}

function send(res: any, status: number, body: Record<string, unknown>) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

async function incrementTokenQuota(db: any, userId: string) {
  const ref = db.collection('userLimits').doc(userId);
  const now = Date.now();

  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const raw = snap.exists ? (snap.data() || {}) : {};
    const lastResetTimestamp = Number(raw.lastResetTimestamp) || now;
    const resetRequired = now - lastResetTimestamp >= DAY_MS;
    const current = resetRequired ? 0 : (Number(raw.tokensMintedToday) || 0);

    if (current >= TOKEN_LIMIT_PER_DAY) {
      return {
        allowed: false,
        current,
        resetTimeMs: Math.max(0, lastResetTimestamp + DAY_MS - now),
      };
    }

    tx.set(ref, {
      userId,
      sessionsToday: resetRequired ? 0 : (Number(raw.sessionsToday) || 0),
      tokensMintedToday: current + 1,
      evaluationsToday: resetRequired ? 0 : (Number(raw.evaluationsToday) || 0),
      lastResetTimestamp: resetRequired ? now : lastResetTimestamp,
    }, { merge: true });

    return { allowed: true, current: current + 1, resetTimeMs: 0 };
  });
}

function normalizeGoogleError(payload: any, fallback: string) {
  const upstream = payload?.error;
  const message = typeof upstream?.message === 'string'
    ? upstream.message
    : typeof payload?.message === 'string'
      ? payload.message
      : fallback;
  const code = typeof upstream?.status === 'string'
    ? upstream.status
    : typeof upstream?.code === 'number'
      ? `GOOGLE_${upstream.code}`
      : 'GEMINI_TOKEN_REQUEST_FAILED';
  return { message, code };
}

export default async function handler(req: any, res: any) {
  const id = requestId();

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, {
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
      requestId: id,
      apiRevision: API_REVISION,
    });
  }

  try {
    if (!firebaseCredentialPresence()) {
      return send(res, 503, {
        error: 'Firebase Admin authentication is not configured on the server.',
        code: 'AUTH_NOT_CONFIGURED',
        stage: 'firebase_configuration',
        requestId: id,
        apiRevision: API_REVISION,
      });
    }

    const authHeader = String(req.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) {
      return send(res, 401, {
        error: 'Authentication is required to start a live voice session.',
        code: 'AUTH_REQUIRED',
        stage: 'authentication',
        requestId: id,
        apiRevision: API_REVISION,
      });
    }

    const { auth, db } = ensureSessionFirebaseAdmin();
    const idToken = authHeader.slice('Bearer '.length).trim();

    let userId: string;
    try {
      const decoded = await auth.verifyIdToken(idToken);
      userId = decoded.uid;
    } catch (error: any) {
      console.error('[Gemini mint] Firebase token verification failed', id, error?.code, error?.message);
      return send(res, 401, {
        error: 'Your sign-in token could not be verified. Sign in again and retry.',
        code: 'FIREBASE_TOKEN_VERIFY_FAILED',
        stage: 'authentication',
        requestId: id,
        apiRevision: API_REVISION,
      });
    }

    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return send(res, 503, {
        error: 'GEMINI_API_KEY is not configured on the server.',
        code: 'GEMINI_NOT_CONFIGURED',
        stage: 'gemini_configuration',
        requestId: id,
        apiRevision: API_REVISION,
      });
    }

    // Keep the cost-control quota, but do not let a temporary Firestore outage
    // prevent an otherwise valid Live session from starting.
    try {
      const quota = await incrementTokenQuota(db, userId);
      if (!quota.allowed) {
        return send(res, 429, {
          error: `Daily Gemini Live token limit reached (${TOKEN_LIMIT_PER_DAY}/${TOKEN_LIMIT_PER_DAY}).`,
          code: 'TOKEN_DAILY_LIMIT_REACHED',
          stage: 'quota',
          resetTimeMs: quota.resetTimeMs,
          requestId: id,
          apiRevision: API_REVISION,
        });
      }
    } catch (error: any) {
      console.warn('[Gemini mint] Firestore quota check unavailable; continuing with token mint.', id, error?.code, error?.message);
      res.setHeader('X-Hexa-Quota-Mode', 'degraded');
    }

    // Use Google's documented REST endpoint directly instead of loading the
    // full GenAI SDK inside the Vercel function. An unconstrained ephemeral
    // token is still single-use, short-lived, and Live-API-only; the browser
    // supplies the model/system instruction in its Live setup message.
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    let googleResponse: Response;
    try {
      googleResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
        }),
        signal: controller.signal,
      });
    } catch (error: any) {
      const timedOut = error?.name === 'AbortError';
      console.error('[Gemini mint] Google token request transport failure', id, error?.name, error?.message);
      return send(res, 502, {
        error: timedOut
          ? 'Gemini token provisioning timed out.'
          : 'Could not reach the Gemini token service.',
        code: timedOut ? 'GEMINI_TOKEN_TIMEOUT' : 'GEMINI_TOKEN_NETWORK_ERROR',
        stage: 'gemini_token_request',
        requestId: id,
        apiRevision: API_REVISION,
      });
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await googleResponse.text();
    let googlePayload: any = {};
    try {
      googlePayload = rawText ? JSON.parse(rawText) : {};
    } catch {
      googlePayload = {};
    }

    if (!googleResponse.ok) {
      const normalized = normalizeGoogleError(
        googlePayload,
        `Gemini token service returned HTTP ${googleResponse.status}.`
      );
      console.error('[Gemini mint] Google rejected token provisioning', id, googleResponse.status, normalized.code, normalized.message);
      return send(res, 502, {
        error: normalized.message,
        code: normalized.code,
        stage: 'gemini_token_request',
        upstreamStatus: googleResponse.status,
        requestId: id,
        apiRevision: API_REVISION,
      });
    }

    const token = typeof googlePayload?.name === 'string' ? googlePayload.name : '';
    if (!token) {
      console.error('[Gemini mint] Google returned no token name', id, rawText.slice(0, 500));
      return send(res, 502, {
        error: 'Gemini token provisioning succeeded but returned no usable token.',
        code: 'GEMINI_TOKEN_EMPTY',
        stage: 'gemini_token_response',
        requestId: id,
        apiRevision: API_REVISION,
      });
    }

    return send(res, 200, {
      token,
      sandbox: false,
      expiresAt: googlePayload?.expireTime || expireTime,
      apiVersion: 'v1beta',
      apiRevision: API_REVISION,
      requestId: id,
    });
  } catch (error: any) {
    console.error('[Gemini mint] Unhandled function failure', id, error?.code, error?.message, error?.stack);
    return send(res, 500, {
      error: 'The Gemini token function failed before token provisioning completed.',
      code: 'GEMINI_MINT_FUNCTION_FAILED',
      stage: 'session_mint',
      runtimeErrorCode: typeof error?.code === 'string' ? error.code : undefined,
      runtimeErrorName: error?.name || undefined,
      requestId: id,
      apiRevision: API_REVISION,
    });
  }
}
