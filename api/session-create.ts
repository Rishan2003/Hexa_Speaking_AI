import { randomUUID } from 'node:crypto';
import { generateTestSnapshot } from '../src/services/questionBank';
import { ensureSessionFirebaseAdmin } from './_firebaseSessionAdmin';
import { releaseReservation, reserveTestCredit } from './_billing';

const API_REVISION = '1.2.0-paid-access';
type PracticeMode = 'full' | 'part1' | 'part2' | 'part3';

function setCommonHeaders(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers?.origin;
  const allowed = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
}

function requestBody(req: any): any {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function cleanForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function publicError(error: any) {
  const code = typeof error?.code === 'string' || typeof error?.code === 'number' ? String(error.code) : undefined;
  const message = typeof error?.message === 'string' ? error.message : 'Unknown server error';
  return { code, message: message.slice(0, 500) };
}

async function verifyUser(req: any) {
  const authorization = String(req.headers?.authorization || '');
  if (!authorization.startsWith('Bearer ')) {
    const error: any = new Error('Authentication is required.');
    error.httpStatus = 401;
    error.publicCode = 'AUTH_REQUIRED';
    throw error;
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    const error: any = new Error('Authentication token is empty.');
    error.httpStatus = 401;
    error.publicCode = 'AUTH_REQUIRED';
    throw error;
  }
  try {
    const { auth } = ensureSessionFirebaseAdmin();
    return await auth.verifyIdToken(token);
  } catch (cause: any) {
    const error: any = new Error(cause?.message || 'Firebase ID token verification failed.');
    error.httpStatus = 401;
    error.publicCode = 'FIREBASE_TOKEN_VERIFY_FAILED';
    error.causeCode = cause?.code;
    throw error;
  }
}

export default async function handler(req: any, res: any) {
  setCommonHeaders(req, res);
  const requestId = String(req.headers?.['x-request-id'] || `req-${randomUUID()}`);
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-HEXA-API-Revision', API_REVISION);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED', requestId, apiRevision: API_REVISION });

  let stage = 'authentication';
  let userId = '';
  let sessionId = '';
  let reservationCreated = false;
  try {
    const decoded = await verifyUser(req);
    userId = decoded.uid;

    stage = 'request_validation';
    const body = requestBody(req);
    const mode: PracticeMode = body.mode ?? 'full';
    if (!['full', 'part1', 'part2', 'part3'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Expected full, part1, part2, or part3.', code: 'INVALID_SESSION_MODE', stage, requestId, apiRevision: API_REVISION });
    }

    const seed = typeof body.seed === 'string' && body.seed.length <= 200 ? body.seed : `seed-${randomUUID()}`;
    const cueCardId = typeof body.cueCardId === 'string' ? body.cueCardId : undefined;

    stage = 'test_generation';
    const snapshot = generateTestSnapshot(seed, mode, cueCardId);
    sessionId = `session-${randomUUID()}`;
    const now = Date.now();

    stage = 'billing_reservation';
    const billingReservation = await reserveTestCredit(userId, sessionId, mode);
    reservationCreated = billingReservation?.status === 'reserved';

    const session = cleanForFirestore({
      id: sessionId,
      userId,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      currentPart: mode === 'part3' ? 'PART_3' : mode === 'part2' ? 'PART_2' : 'PART_1',
      currentState: 'IDLE',
      topic: snapshot.part2CueCard?.title || snapshot.part1Topic?.title || 'Speaking Practice',
      ...(snapshot.part2CueCard ? {
        cueCard: {
          id: snapshot.part2CueCard.id,
          topic: snapshot.part2CueCard.taskStatement,
          bulletPoints: snapshot.part2CueCard.bulletPrompts,
          followUpQuestions: snapshot.part3Questions?.map((q) => q.text) || [],
        },
      } : {}),
      transcript: [],
      selectedTestSnapshot: snapshot,
      billingReservationId: sessionId,
    });

    stage = 'firestore_persistence';
    try {
      const { db } = ensureSessionFirebaseAdmin();
      const sessionRef = db.collection('speakingSessions').doc(sessionId);
      await sessionRef.set(session);
      const batch = db.batch();
      [1, 2, 3].forEach((partIndex) => {
        const partRef = sessionRef.collection('parts').doc(`part-${partIndex}`);
        batch.set(partRef, { id: `part-${partIndex}`, sessionId, partIndex, status: 'idle', startedAt: now });
      });
      await batch.commit();
    } catch (firestoreError: any) {
      if (reservationCreated) {
        await releaseReservation(userId, sessionId, 'Authoritative session persistence failed before test launch.').catch(() => undefined);
        reservationCreated = false;
      }
      const error: any = new Error('The test could not be stored securely, so no credit was charged. Please retry.');
      error.httpStatus = 503;
      error.publicCode = 'SESSION_PERSISTENCE_FAILED';
      error.cause = firestoreError;
      throw error;
    }

    return res.status(201).json({ ...session, serverPersistence: 'firestore', billingReservation, requestId, apiRevision: API_REVISION });
  } catch (error: any) {
    if (reservationCreated && userId && sessionId) {
      await releaseReservation(userId, sessionId, `Session creation failed during ${stage}.`).catch(() => undefined);
    }
    const safe = publicError(error);
    const status = Number(error?.httpStatus) || 500;
    console.error('[HEXA session-create] failed', { requestId, stage, publicCode: error?.publicCode, causeCode: error?.causeCode, message: safe.message });
    return res.status(status).json({
      error: status === 500 ? `Session creation failed during ${stage}.` : safe.message,
      code: error?.publicCode || 'SESSION_CREATE_FAILED',
      stage,
      requestId,
      apiRevision: API_REVISION,
      ...(error?.causeCode ? { runtimeErrorCode: String(error.causeCode) } : {}),
    });
  }
}
