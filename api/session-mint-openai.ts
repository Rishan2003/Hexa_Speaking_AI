import { createHash } from 'node:crypto';

const API_REVISION = '1.4.2-openai-realtime-formdata';
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

export function buildOpenAIRealtimeFormData(sdp: string, sessionConfig: Record<string, unknown>) {
  // Match OpenAI's unified WebRTC example exactly: both values are plain
  // multipart string fields. Do not add per-part Content-Type headers, a
  // filename, a manual boundary, or Content-Length. Native FormData/fetch
  // handles multipart serialization correctly on the Node 22 Vercel runtime.
  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(sessionConfig));
  return form;
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
      const refundCredits = Math.max(0, Number(reservation.creditCost ?? 1) || 0);
      balanceAfter += refundCredits;
      tx.update(entitlementRef, { creditBalance: balanceAfter, updatedAt: now });
      tx.set(ledgerRef, {
        id: `release-${sessionId}`,
        userId,
        sessionId,
        type: 'TEST_RESERVATION_RELEASED',
        delta: refundCredits,
        balanceAfter,
        note: 'Reservation expired before OpenAI Realtime call authorization.',
        createdAt: now,
      }, { merge: true });
    }
    tx.update(reservationRef, {
      status: 'released',
      releasedAt: now,
      releaseReason: 'Reservation expired before OpenAI Realtime call authorization.',
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
  // v1.3.0 clients could persist a stale IDLE callback as status=incomplete
  // during Part 1. Treat that legacy non-terminal status as resumable so the
  // same paid session can mint the fresh Part 2/3 connection token.
  const activeSession = session.status === 'active' || session.status === 'incomplete';

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
        error: 'A valid paid speaking-session ID is required before an OpenAI Realtime call can be created.',
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
        error: paidAuthorization?.error || 'This speaking session is not authorized to use OpenAI Realtime.',
        code: paidAuthorization?.code || 'PAID_SESSION_NOT_AUTHORIZED',
        stage: 'paid_session_authorization',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    // SDP is a line-oriented wire format. Preserve the browser's offer byte-for-byte
    // as a JS string: in particular, do NOT trim the terminating CRLF.
    const sdp = typeof body.sdp === 'string' ? body.sdp : '';
    if (!sdp || !sdp.startsWith('v=') || sdp.length > 250_000) {
      return send(res, 400, {
        error: 'A valid WebRTC SDP offer is required to create the OpenAI Realtime call.',
        code: 'SDP_OFFER_REQUIRED',
        stage: 'webrtc_offer_validation',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const openaiApiKey = String(runtimeEnv.OPENAI_API_KEY || '').trim();
    if (!openaiApiKey) {
      return send(res, 503, {
        error: 'OPENAI_API_KEY is not configured on the server.',
        code: 'OPENAI_NOT_CONFIGURED',
        stage: 'openai_configuration',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const model = String(runtimeEnv.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1').trim();
    const voice = String(runtimeEnv.OPENAI_REALTIME_VOICE || 'marin').trim();
    const transcriptionModel = String(
      runtimeEnv.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'
    ).trim();
    const systemInstruction = String(body.systemInstruction || '').trim().slice(0, 60_000);
    const manualActivityDetection = body.activityDetectionMode === 'manual';
    const allowInterruption = body.allowInterruption !== false;

    const turnDetection = manualActivityDetection
      ? null
      : {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          // IELTS candidates naturally pause while formulating an answer. Keep
          // this less aggressive than the API default to avoid premature turns.
          silence_duration_ms: 800,
          create_response: true,
          interrupt_response: allowInterruption,
        };

    const sessionConfig = {
      type: 'realtime',
      model,
      output_modalities: ['audio'],
      ...(systemInstruction ? { instructions: systemInstruction } : {}),
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          transcription: {
            model: transcriptionModel,
            language: 'en',
          },
          turn_detection: turnDetection,
        },
        output: {
          voice,
        },
      },
    };

    const realtimeForm = buildOpenAIRealtimeFormData(sdp, sessionConfig);

    const userId = String(authResult.payload.users[0].localId);
    const safetyIdentifier = createHash('sha256')
      .update(`hexa-speaking-ai:${userId}`)
      .digest('hex');

    const openaiController = new AbortController();
    const openaiTimeout = setTimeout(() => openaiController.abort(), 15_000);

    let openaiResponse: Response;
    try {
      openaiResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'OpenAI-Safety-Identifier': safetyIdentifier,
          'X-Client-Request-Id': requestId,
        },
        body: realtimeForm,
        signal: openaiController.signal,
      });
    } catch (error: any) {
      const timedOut = error?.name === 'AbortError';
      return send(res, 502, {
        error: timedOut
          ? 'OpenAI Realtime call creation timed out.'
          : 'Could not reach the OpenAI Realtime service.',
        code: timedOut ? 'OPENAI_REALTIME_TIMEOUT' : 'OPENAI_REALTIME_NETWORK_ERROR',
        stage: 'openai_realtime_call',
        requestId,
        apiRevision: API_REVISION,
      });
    } finally {
      clearTimeout(openaiTimeout);
    }

    const responseText = await openaiResponse.text();
    if (!openaiResponse.ok) {
      let payload: any = {};
      try { payload = responseText ? JSON.parse(responseText) : {}; } catch { /* plain-text upstream error */ }
      return send(res, 502, {
        error: upstreamMessage(payload, `OpenAI Realtime returned HTTP ${openaiResponse.status}.`),
        code: payload?.error?.code || `OPENAI_HTTP_${openaiResponse.status}`,
        stage: 'openai_realtime_call',
        upstreamStatus: openaiResponse.status,
        openaiRequestId: openaiResponse.headers.get('x-request-id') || undefined,
        sdpLength: sdp.length,
        sdpHasAudio: /(?:^|\r?\n)m=audio\s/m.test(sdp),
        sdpHasDataChannel: /(?:^|\r?\n)m=application\s/m.test(sdp),
        sdpEndsWithCrlf: sdp.endsWith('\r\n'),
        requestId,
        apiRevision: API_REVISION,
      });
    }

    if (!responseText.trim().startsWith('v=')) {
      return send(res, 502, {
        error: 'OpenAI Realtime returned no usable SDP answer.',
        code: 'OPENAI_SDP_ANSWER_INVALID',
        stage: 'openai_realtime_call',
        requestId,
        apiRevision: API_REVISION,
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/sdp; charset=utf-8');
    res.setHeader('X-OpenAI-Realtime-Model', model);
    res.setHeader('X-OpenAI-Realtime-Voice', voice);
    res.setHeader('X-Hexa-API-Revision', API_REVISION);
    return res.status(200).send(responseText);
  } catch (error: any) {
    console.error('[OpenAI Realtime call] Unexpected handler error', requestId, error?.name, error?.message);
    return send(res, 500, {
      error: 'The OpenAI Realtime endpoint encountered an unexpected runtime error.',
      code: 'OPENAI_REALTIME_UNEXPECTED_ERROR',
      stage: 'session_mint_openai',
      runtimeErrorName: error?.name || undefined,
      requestId,
      apiRevision: API_REVISION,
    });
  }
}
