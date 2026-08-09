const API_REVISION = '1.3.0-session-configurable-credit-costs';
const RESERVATION_TTL_MS = 20 * 60 * 1000;

type PracticeMode = 'full' | 'part1' | 'part2' | 'part3';
type AdminHandles = { db: any };

let adminHandlesPromise: Promise<AdminHandles> | null = null;

function setCommonHeaders(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-HEXA-API-Revision', API_REVISION);

  const origin = String(req.headers?.origin || '');
  const allowed = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
}

function requestBody(req: any): any {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function makeError(message: string, publicCode: string, httpStatus = 500, causeCode?: any) {
  const error: any = new Error(message);
  error.publicCode = publicCode;
  error.httpStatus = httpStatus;
  if (causeCode != null) error.causeCode = causeCode;
  return error;
}

function requestId(req: any): string {
  const supplied = String(req.headers?.['x-request-id'] || '').trim();
  if (supplied) return supplied.slice(0, 160);
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `req-${random}`;
}

function cleanForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function validateSnapshot(raw: any, mode: PracticeMode) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw makeError('The generated speaking test snapshot is missing.', 'TEST_SNAPSHOT_MISSING', 400);
  }

  let serialized = '';
  try {
    serialized = JSON.stringify(raw);
  } catch {
    throw makeError('The generated speaking test snapshot is invalid.', 'TEST_SNAPSHOT_INVALID', 400);
  }

  if (serialized.length > 120_000) {
    throw makeError('The generated speaking test snapshot is unexpectedly large.', 'TEST_SNAPSHOT_TOO_LARGE', 413);
  }

  if (raw.mode !== mode || typeof raw.seed !== 'string' || !raw.seed.trim()) {
    throw makeError('The generated speaking test snapshot does not match the requested test mode.', 'TEST_SNAPSHOT_MODE_MISMATCH', 400);
  }

  const hasPart1 = Boolean(raw.part1Topic || (Array.isArray(raw.part1Topics) && raw.part1Topics.length));
  const hasPart2 = Boolean(raw.part2CueCard);
  const hasPart3 = Array.isArray(raw.part3Questions) && raw.part3Questions.length > 0;
  const expected = mode === 'full'
    ? (hasPart1 && hasPart2 && hasPart3)
    : mode === 'part1'
      ? hasPart1
      : mode === 'part2'
        ? hasPart2
        : hasPart3;

  if (!expected) {
    throw makeError('The generated speaking test snapshot is incomplete.', 'TEST_SNAPSHOT_INCOMPLETE', 400);
  }

  return JSON.parse(serialized);
}

function firebaseWebApiKey(): string {
  return String(process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
}

async function verifyFirebaseUser(req: any) {
  const authorization = String(req.headers?.authorization || '');
  if (!authorization.startsWith('Bearer ')) {
    throw makeError('Authentication is required.', 'AUTH_REQUIRED', 401);
  }

  const idToken = authorization.slice('Bearer '.length).trim();
  if (!idToken) throw makeError('Authentication token is empty.', 'AUTH_TOKEN_EMPTY', 401);

  const apiKey = firebaseWebApiKey();
  if (!apiKey) {
    throw makeError(
      'Firebase Web API key is missing on the server. Set FIREBASE_WEB_API_KEY or VITE_FIREBASE_API_KEY in Vercel.',
      'FIREBASE_WEB_API_KEY_MISSING',
      503,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: any;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      },
    );
  } catch (cause: any) {
    if (cause?.name === 'AbortError') {
      throw makeError('Firebase authentication verification timed out.', 'FIREBASE_AUTH_TIMEOUT', 502);
    }
    throw makeError('Could not reach Firebase Authentication to verify the user.', 'FIREBASE_AUTH_NETWORK_ERROR', 502, cause?.code);
  } finally {
    clearTimeout(timeout);
  }

  let payload: any = {};
  try { payload = await response.json(); } catch { /* handled below */ }
  const user = Array.isArray(payload?.users) ? payload.users[0] : null;
  if (!response.ok || !user?.localId) {
    throw makeError(
      'Your sign-in session could not be verified. Sign in again and retry.',
      'AUTH_INVALID',
      401,
      payload?.error?.message || response.status,
    );
  }

  return { uid: String(user.localId), email: user.email ? String(user.email) : undefined };
}

interface ServiceAccountShape {
  projectId?: string;
  project_id?: string;
  clientEmail?: string;
  client_email?: string;
  privateKey?: string;
  private_key?: string;
}

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
  if (process.env.FIREBASE_SERVICE_ACCOUNT?.trim()) {
    account = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!account) throw makeError('FIREBASE_SERVICE_ACCOUNT is not valid JSON or base64-encoded JSON.', 'FIREBASE_SERVICE_ACCOUNT_INVALID', 503);
  } else {
    account = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
    };
  }

  const projectId = account.projectId || account.project_id;
  const clientEmail = account.clientEmail || account.client_email;
  const privateKey = (account.privateKey || account.private_key)?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw makeError(
      'Firebase Admin credentials are incomplete. Expected project_id, client_email and private_key.',
      'FIREBASE_ADMIN_CREDENTIALS_INCOMPLETE',
      503,
    );
  }
  return { projectId, clientEmail, privateKey };
}

async function ensureFirestoreAdmin(): Promise<AdminHandles> {
  if (!adminHandlesPromise) {
    adminHandlesPromise = (async () => {
      let appModule: any;
      let firestoreModule: any;
      try {
        [appModule, firestoreModule] = await Promise.all([
          import('firebase-admin/app'),
          import('firebase-admin/firestore'),
        ]);
      } catch (cause: any) {
        throw makeError(
          `Firebase Firestore Admin modules could not load: ${String(cause?.message || cause)}`,
          'FIREBASE_FIRESTORE_IMPORT_FAILED',
          500,
          cause?.code,
        );
      }

      try {
        if (appModule.getApps().length === 0) {
          const account = configuredServiceAccount();
          appModule.initializeApp({
            credential: appModule.cert({
              projectId: account.projectId,
              clientEmail: account.clientEmail,
              privateKey: account.privateKey,
            }),
            ...(process.env.FIREBASE_STORAGE_BUCKET ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET } : {}),
          });
        }
        return { db: firestoreModule.getFirestore() };
      } catch (cause: any) {
        throw makeError(
          `Firebase Firestore Admin could not initialize: ${String(cause?.message || cause)}`,
          'FIREBASE_FIRESTORE_INIT_FAILED',
          503,
          cause?.code,
        );
      }
    })().catch((error) => {
      adminHandlesPromise = null;
      throw error;
    });
  }
  return adminHandlesPromise;
}

function isUnlimitedActive(entitlement: any, now = Date.now()) {
  return Boolean(entitlement?.unlimited) && (entitlement?.unlimitedUntil == null || Number(entitlement.unlimitedUntil) > now);
}

function defaultSignupFreeTests() {
  const value = Number(process.env.DEFAULT_FREE_TESTS ?? 3);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 3;
}

const DEFAULT_CREDIT_COSTS: Record<PracticeMode, number> = { part1: 1, part2: 1, part3: 1, full: 3 };

function safeCreditCost(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function creditCostForMode(settingsData: any, mode: PracticeMode): number {
  const raw = settingsData?.creditCosts || {};
  return safeCreditCost(raw?.[mode], DEFAULT_CREDIT_COSTS[mode]);
}

async function reserveTestCredit(userId: string, sessionId: string, mode: PracticeMode) {
  const { db } = await ensureFirestoreAdmin();
  const entitlementRef = db.collection('testEntitlements').doc(userId);
  const settingsRef = db.collection('billingSettings').doc('global');
  const reservationRef = db.collection('testReservations').doc(sessionId);
  const reserveLedgerRef = db.collection('entitlementLedger').doc(`reserve-${sessionId}`);
  const signupLedgerRef = db.collection('entitlementLedger').doc(`signup-${userId}`);
  const now = Date.now();

  return db.runTransaction(async (tx: any) => {
    const [entSnap, settingsSnap, reservationSnap] = await Promise.all([
      tx.get(entitlementRef),
      tx.get(settingsRef),
      tx.get(reservationRef),
    ]);

    if (reservationSnap.exists) return reservationSnap.data();

    const creditCost = creditCostForMode(settingsSnap.exists ? settingsSnap.data() : null, mode);

    let entitlement: any;
    let newlyCreated = false;
    if (entSnap.exists) {
      entitlement = entSnap.data() || {};
    } else {
      const signupFreeTests = settingsSnap.exists
        ? Math.max(0, Number(settingsSnap.data()?.signupFreeTests ?? defaultSignupFreeTests()) || 0)
        : defaultSignupFreeTests();
      entitlement = {
        userId,
        creditBalance: signupFreeTests,
        unlimited: false,
        unlimitedUntil: null,
        totalPurchased: 0,
        totalGranted: signupFreeTests,
        totalConsumed: 0,
        createdAt: now,
        updatedAt: now,
      };
      newlyCreated = true;
    }

    if (isUnlimitedActive(entitlement, now)) {
      const reservation = {
        id: sessionId,
        sessionId,
        userId,
        mode,
        chargeType: 'unlimited',
        creditCost,
        status: 'reserved',
        reservedAt: now,
        expiresAt: now + RESERVATION_TTL_MS,
      };
      if (newlyCreated) {
        tx.set(entitlementRef, entitlement);
        if (Number(entitlement.creditBalance) > 0) {
          tx.set(signupLedgerRef, {
            id: `signup-${userId}`,
            userId,
            type: 'SIGNUP_BONUS',
            delta: Number(entitlement.creditBalance),
            balanceAfter: Number(entitlement.creditBalance),
            note: 'Automatic free-credit allowance for a new account.',
            createdAt: now,
          });
        }
      }
      tx.set(reservationRef, reservation);
      return reservation;
    }

    const balance = Math.max(0, Number(entitlement.creditBalance) || 0);
    if (balance < creditCost) {
      throw makeError(
        `This ${mode} test requires ${creditCost} credit${creditCost === 1 ? '' : 's'}, but your balance is ${balance}.`,
        'PAYMENT_REQUIRED',
        402,
      );
    }

    const nextBalance = balance - creditCost;
    if (newlyCreated) {
      tx.set(entitlementRef, { ...entitlement, creditBalance: nextBalance, updatedAt: now });
      if (balance > 0) {
        tx.set(signupLedgerRef, {
          id: `signup-${userId}`,
          userId,
          type: 'SIGNUP_BONUS',
          delta: balance,
          balanceAfter: balance,
          note: 'Automatic free-credit allowance for a new account.',
          createdAt: now,
        });
      }
    } else if (creditCost > 0) {
      tx.update(entitlementRef, { creditBalance: nextBalance, updatedAt: now });
    }

    const reservation = {
      id: sessionId,
      sessionId,
      userId,
      mode,
      chargeType: creditCost > 0 ? 'credit' : 'free',
      creditCost,
      status: 'reserved',
      reservedAt: now,
      expiresAt: now + RESERVATION_TTL_MS,
    };
    tx.set(reservationRef, reservation);
    tx.set(reserveLedgerRef, {
      id: `reserve-${sessionId}`,
      userId,
      sessionId,
      type: 'TEST_RESERVED',
      delta: -creditCost,
      balanceAfter: nextBalance,
      note: `${creditCost} credit${creditCost === 1 ? '' : 's'} reserved for ${mode} speaking test.`,
      createdAt: now,
    });
    return reservation;
  });
}

async function releaseReservation(userId: string, sessionId: string, note: string) {
  const { db } = await ensureFirestoreAdmin();
  const entitlementRef = db.collection('testEntitlements').doc(userId);
  const reservationRef = db.collection('testReservations').doc(sessionId);
  const ledgerRef = db.collection('entitlementLedger').doc(`release-${sessionId}`);
  const now = Date.now();

  return db.runTransaction(async (tx: any) => {
    const [reservationSnap, entitlementSnap] = await Promise.all([
      tx.get(reservationRef),
      tx.get(entitlementRef),
    ]);
    if (!reservationSnap.exists) return null;
    const reservation = reservationSnap.data() || {};
    if (reservation.status !== 'reserved') return reservation;

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
        note,
        createdAt: now,
      });
    }
    tx.update(reservationRef, { status: 'released', releasedAt: now, releaseReason: note });
    return { ...reservation, status: 'released' };
  });
}

export default async function handler(req: any, res: any) {
  setCommonHeaders(req, res);

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      stage: 'entrypoint',
      apiRevision: API_REVISION,
      node: process.version,
      runtime: 'vercel-node',
      architecture: 'self-contained',
    });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();

  const reqId = requestId(req);
  res.setHeader('X-Request-ID', reqId);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED', requestId: reqId, apiRevision: API_REVISION });
  }

  let stage = 'authentication';
  let userId = '';
  let sessionId = '';
  let reservationCreated = false;

  try {
    const verified = await verifyFirebaseUser(req);
    userId = verified.uid;

    stage = 'request_validation';
    const body = requestBody(req);
    const mode: PracticeMode = body.mode ?? 'full';
    if (!['full', 'part1', 'part2', 'part3'].includes(mode)) {
      throw makeError('Invalid mode. Expected full, part1, part2, or part3.', 'INVALID_SESSION_MODE', 400);
    }

    stage = 'snapshot_validation';
    const snapshot = validateSnapshot(body.selectedTestSnapshot, mode);
    sessionId = `session-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
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
          followUpQuestions: snapshot.part3Questions?.map((q: any) => q.text) || [],
        },
      } : {}),
      transcript: [],
      selectedTestSnapshot: snapshot,
      billingReservationId: sessionId,
    });

    stage = 'firestore_persistence';
    try {
      const { db } = await ensureFirestoreAdmin();
      const sessionRef = db.collection('speakingSessions').doc(sessionId);
      await sessionRef.set(session);
      const batch = db.batch();
      [1, 2, 3].forEach((partIndex) => {
        const partRef = sessionRef.collection('parts').doc(`part-${partIndex}`);
        batch.set(partRef, { id: `part-${partIndex}`, sessionId, partIndex, status: 'idle', startedAt: now });
      });
      await batch.commit();
    } catch (cause: any) {
      if (reservationCreated) {
        await releaseReservation(userId, sessionId, 'Authoritative session persistence failed before test launch.').catch(() => undefined);
        reservationCreated = false;
      }
      throw makeError(
        'The test could not be stored securely, so no credit was charged. Please retry.',
        'SESSION_PERSISTENCE_FAILED',
        503,
        cause?.publicCode || cause?.code,
      );
    }

    return res.status(201).json({
      ...session,
      serverPersistence: 'firestore',
      billingReservation,
      requestId: reqId,
      apiRevision: API_REVISION,
    });
  } catch (error: any) {
    if (reservationCreated && userId && sessionId) {
      await releaseReservation(userId, sessionId, `Session creation failed during ${stage}.`).catch(() => undefined);
    }

    const status = Number(error?.httpStatus) || 500;
    const publicCode = String(error?.publicCode || 'SESSION_CREATE_FAILED');
    const message = String(error?.message || 'Unknown server error');
    console.error('[HEXA session-create self-contained] failed', {
      requestId: reqId,
      stage,
      publicCode,
      causeCode: error?.causeCode,
      message,
    });

    return res.status(status).json({
      error: status >= 500 ? `Session creation failed during ${stage}.` : message,
      code: publicCode,
      stage,
      requestId: reqId,
      apiRevision: API_REVISION,
      ...(error?.causeCode ? { runtimeErrorCode: String(error.causeCode) } : {}),
      ...(status >= 500 ? {
        detail: {
          name: String(error?.name || 'Error'),
          message: message.slice(0, 1200),
        },
      } : {}),
    });
  }
}
