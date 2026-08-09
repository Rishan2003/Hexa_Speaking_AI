const API_REVISION = '1.2.9-paid-mint-direct-firestore-auth';
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

function requestBody(req: any): any {
  if (!req?.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body)); } catch { return {}; }
}


interface ServiceAccountShape {
  projectId?: string;
  project_id?: string;
  clientEmail?: string;
  client_email?: string;
  privateKey?: string;
  private_key?: string;
}

type AdminHandles = { db: any };
let adminHandlesPromise: Promise<AdminHandles> | null = null;

function parseServiceAccount(raw: string): ServiceAccountShape | null {
  const candidates = [raw.trim()];
  try { candidates.push(Buffer.from(raw.trim(), 'base64').toString('utf8')); } catch { /* ignore */ }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as ServiceAccountShape;
    } catch { /* try next */ }
  }
  return null;
}

function configuredServiceAccount() {
  let account: ServiceAccountShape | null = null;
  if (runtimeEnv.FIREBASE_SERVICE_ACCOUNT?.trim()) {
    account = parseServiceAccount(runtimeEnv.FIREBASE_SERVICE_ACCOUNT);
    if (!account) throw Object.assign(new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON or base64-encoded JSON.'), { publicCode: 'FIREBASE_SERVICE_ACCOUNT_INVALID' });
  } else {
    account = {
      projectId: runtimeEnv.FIREBASE_PROJECT_ID,
      clientEmail: runtimeEnv.FIREBASE_CLIENT_EMAIL,
      privateKey: runtimeEnv.FIREBASE_PRIVATE_KEY,
    };
  }

  const projectId = account.projectId || account.project_id;
  const clientEmail = account.clientEmail || account.client_email;
  const privateKey = (account.privateKey || account.private_key)?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw Object.assign(new Error('Firebase Admin credentials are incomplete.'), { publicCode: 'FIREBASE_ADMIN_CREDENTIALS_INCOMPLETE' });
  }
  return { projectId, clientEmail, privateKey };
}

async function ensureFirestoreAdmin(): Promise<AdminHandles> {
  if (!adminHandlesPromise) {
    adminHandlesPromise = (async () => {
      const [appModule, firestoreModule] = await Promise.all([
        import('firebase-admin/app'),
        import('firebase-admin/firestore'),
      ]);

      if (appModule.getApps().length === 0) {
        const account = configuredServiceAccount();
        appModule.initializeApp({
          credential: appModule.cert({
            projectId: account.projectId,
            clientEmail: account.clientEmail,
            privateKey: account.privateKey,
          }),
          ...(runtimeEnv.FIREBASE_STORAGE_BUCKET ? { storageBucket: runtimeEnv.FIREBASE_STORAGE_BUCKET } : {}),
        });
      }
      return { db: firestoreModule.getFirestore() };
    })().catch((error) => {
      adminHandlesPromise = null;
      throw error;
    });
  }
  return adminHandlesPromise;
}

async function releaseExpiredReservation(db: any, userId: string, sessionId: string) {
  const reservationRef = db.collection('testReservations').doc(sessionId);
  const entitlementRef = db.collection('testEntitlements').doc(userId);
  const ledgerRef = db.collection('entitlementLedger').doc(`release-${sessionId}`);
  const now = Date.now();

  return db.runTransaction(async (tx: any) => {
    const [reservationSnap, entitlementSnap] = await Promise.all([
      tx.get(reservationRef),
      tx.get(entitlementRef),
    ]);
    if (!reservationSnap.exists) return;
    const reservation = reservationSnap.data() || {};
    if (reservation.userId !== userId || reservation.status !== 'reserved') return;
    if (Number(reservation.expiresAt || 0) > now) return;

    let balanceAfter = Number(entitlementSnap.data()?.creditBalance) || 0;
    if (reservation.chargeType === 'credit' && entitlementSnap.exists) {
      balanceAfter += 1;
      tx.update(entitlementRef, { creditBalance: balanceAfter, updatedAt: now });
      tx.set(ledgerRef, {
        id: `release-${sessionId}`,
        userId,
        sessionId,
        type: 'TEST_RESERVATION_RELEASED',
        delta: 1,
        balanceAfter,
        note: 'Reservation expired before Gemini token authorization.',
        createdAt: now,
      }, { merge: true });
    }
    tx.update(reservationRef, {
      status: 'released',
      releasedAt: now,
      releaseReason: 'Reservation expired before Gemini token authorization.',
    });
  });
}

async function authorizePaidSession(userId: string, sessionId: string) {
  const { db } = await ensureFirestoreAdmin();
  const [reservationSnap, sessionSnap] = await Promise.all([
    db.collection('testReservations').doc(sessionId).get(),
    db.collection('speakingSessions').doc(sessionId).get(),
  ]);

  if (!reservationSnap.exists || !sessionSnap.exists) {
    return { ok: false, status: 403, code: 'PAID_SESSION_NOT_AUTHORIZED', error: 'This live session is not authorized for paid access.' };
  }

  const reservation = reservationSnap.data() || {};
  const session = sessionSnap.data() || {};
  const owned = reservation.userId === userId && session.userId === userId;
  const linked = session.billingReservationId === sessionId && reservation.sessionId === sessionId;
  const activeReservation = reservation.status === 'reserved' || reservation.status === 'consumed';
  const activeSession = session.status === 'active';

  if (!owned || !linked || !activeReservation || !activeSession) {
    return { ok: false, status: 403, code: 'PAID_SESSION_NOT_AUTHORIZED', error: 'This live session is not authorized for paid access.' };
  }

  if (reservation.status === 'reserved' && Number(reservation.expiresAt || 0) <= Date.now()) {
    await releaseExpiredReservation(db, userId, sessionId).catch(() => undefined);
    return { ok: false, status: 409, code: 'RESERVATION_EXPIRED', error: 'This test reservation expired. Start a new test; the reserved credit has been returned.' };
  }

  return { ok: true, reservationStatus: String(reservation.status || '') };
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

    const body = requestBody(req);
    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId || sessionId.length > 180) {
      return send(res, 400, {
        error: 'A valid paid speaking-session ID is required before a Gemini Live token can be minted.',
        code: 'SESSION_ID_REQUIRED',
        stage: 'paid_session_authorization',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    // Authorize the exact server-created paid session directly in Firestore.
    // Do not call this deployment over HTTP: Vercel Preview Protection can
    // intercept server-to-server requests and return "Protected deployment"
    // before /api/billing is reached.
    let paidAuthorization: any;
    try {
      paidAuthorization = await authorizePaidSession(String(authResult.payload.users[0].localId), sessionId);
    } catch (error: any) {
      return send(res, 503, {
        error: `Paid-session authorization storage could not initialize: ${String(error?.message || error)}`,
        code: error?.publicCode || 'PAID_AUTH_STORAGE_FAILED',
        stage: 'paid_session_authorization',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    if (!paidAuthorization?.ok) {
      return send(res, Number(paidAuthorization?.status) || 403, {
        error: paidAuthorization?.error || 'This speaking session is not authorized to use Gemini Live.',
        code: paidAuthorization?.code || 'PAID_SESSION_NOT_AUTHORIZED',
        stage: 'paid_session_authorization',
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
