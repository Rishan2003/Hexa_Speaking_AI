import { randomUUID } from 'node:crypto';
import { generateTestSnapshot } from '../src/services/questionBank';
import { ensureSessionFirebaseAdmin } from './_firebaseSessionAdmin';

const API_REVISION = '1.1.9';
const SESSION_LIMIT = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function cleanForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function publicError(error: any) {
  const code = typeof error?.code === 'string' || typeof error?.code === 'number'
    ? String(error.code)
    : undefined;
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

async function checkSessionQuotaBestEffort(userId: string): Promise<{ allowed: boolean; message?: string }> {
  try {
    const { db } = ensureSessionFirebaseAdmin();
    const ref = db.collection('userLimits').doc(userId);
    const snap = await ref.get();
    const now = Date.now();
    const raw = snap.exists ? (snap.data() || {}) : {};
    const lastReset = Number(raw.lastResetTimestamp) || now;
    const resetRequired = now - lastReset > DAY_MS;
    const sessionsToday = resetRequired ? 0 : (Number(raw.sessionsToday) || 0);

    if (sessionsToday >= SESSION_LIMIT) {
      return {
        allowed: false,
        message: `Daily practice session limit reached (${sessionsToday}/${SESSION_LIMIT}).`,
      };
    }

    const next = {
      userId,
      sessionsToday: sessionsToday + 1,
      tokensMintedToday: resetRequired ? 0 : (Number(raw.tokensMintedToday) || 0),
      evaluationsToday: resetRequired ? 0 : (Number(raw.evaluationsToday) || 0),
      lastResetTimestamp: resetRequired || !snap.exists ? now : lastReset,
    };

    await ref.set(next, { merge: true });
    return { allowed: true };
  } catch (error) {
    // Quota persistence must never prevent an authenticated learner from launching a test.
    console.warn('[HEXA session-create] quota check degraded; allowing session launch', publicError(error));
    return { allowed: true };
  }
}

export default async function handler(req: any, res: any) {
  setCommonHeaders(req, res);
  const requestId = String(req.headers?.['x-request-id'] || `req-${randomUUID()}`);
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-HEXA-API-Revision', API_REVISION);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
      stage: 'request',
      requestId,
      apiRevision: API_REVISION,
    });
  }

  let stage = 'authentication';
  try {
    const decoded = await verifyUser(req);
    const userId = decoded.uid;

    stage = 'request_validation';
    const body = requestBody(req);
    const mode: PracticeMode = body.mode ?? 'full';
    if (!['full', 'part1', 'part2', 'part3'].includes(mode)) {
      return res.status(400).json({
        error: 'Invalid mode. Expected full, part1, part2, or part3.',
        code: 'INVALID_SESSION_MODE',
        stage,
        requestId,
        apiRevision: API_REVISION,
      });
    }

    const seed = typeof body.seed === 'string' && body.seed.length <= 200
      ? body.seed
      : `seed-${randomUUID()}`;
    const cueCardId = typeof body.cueCardId === 'string' ? body.cueCardId : undefined;

    stage = 'quota_check';
    const quota = await checkSessionQuotaBestEffort(userId);
    if (!quota.allowed) {
      return res.status(429).json({
        error: quota.message,
        code: 'SESSION_DAILY_LIMIT',
        stage,
        requestId,
        apiRevision: API_REVISION,
      });
    }

    stage = 'test_generation';
    const snapshot = generateTestSnapshot(seed, mode, cueCardId);
    const sessionId = `session-${randomUUID()}`;
    const now = Date.now();

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
    });

    stage = 'firestore_persistence';
    let serverPersistence: 'firestore' | 'recovery' = 'recovery';
    try {
      const { db } = ensureSessionFirebaseAdmin();
      const sessionRef = db.collection('speakingSessions').doc(sessionId);
      await sessionRef.set(session);

      const batch = db.batch();
      [1, 2, 3].forEach((partIndex) => {
        const partRef = sessionRef.collection('parts').doc(`part-${partIndex}`);
        batch.set(partRef, {
          id: `part-${partIndex}`,
          sessionId,
          partIndex,
          status: 'idle',
          startedAt: now,
        });
      });
      await batch.commit();
      serverPersistence = 'firestore';
    } catch (error) {
      // Session creation succeeds even if Firestore is temporarily unavailable.
      console.warn('[HEXA session-create] Firestore persistence degraded; returning recoverable session', {
        requestId,
        ...publicError(error),
      });
    }

    return res.status(201).json({
      ...session,
      serverPersistence,
      requestId,
      apiRevision: API_REVISION,
    });
  } catch (error: any) {
    const safe = publicError(error);
    const status = Number(error?.httpStatus) || 500;
    console.error('[HEXA session-create] failed', {
      requestId,
      stage,
      errorCode: safe.code,
      publicCode: error?.publicCode,
      causeCode: error?.causeCode,
      message: safe.message,
    });

    return res.status(status).json({
      error: status === 500 ? `Session creation failed during ${stage}.` : safe.message,
      code: error?.publicCode || 'SESSION_CREATE_FAILED',
      stage,
      requestId,
      apiRevision: API_REVISION,
      ...(status === 500 ? { diagnostic: safe.message, runtimeErrorCode: safe.code } : {}),
      ...(error?.causeCode ? { runtimeErrorCode: String(error.causeCode) } : {}),
    });
  }
}
