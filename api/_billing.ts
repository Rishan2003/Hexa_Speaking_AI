import { randomUUID } from 'node:crypto';
import { ensureSessionFirebaseAdmin } from './_firebaseSessionAdminLazy.js';

export type AccessType = 'credits' | 'unlimited';
export type PaymentProvider = 'development' | 'sslcommerz';
export type PracticeMode = 'full' | 'part1' | 'part2' | 'part3';

export interface TestCreditCostsRecord {
  part1: number;
  part2: number;
  part3: number;
  full: number;
}

export interface BillingSettingsRecord {
  signupFreeTests: number;
  creditCosts: TestCreditCostsRecord;
  currency: 'BDT';
  developmentPaymentsEnabled: boolean;
  activeProvider: PaymentProvider;
  updatedAt: number;
}

export interface TestEntitlementRecord {
  userId: string;
  creditBalance: number;
  unlimited: boolean;
  unlimitedUntil: number | null;
  totalPurchased: number;
  totalGranted: number;
  totalConsumed: number;
  createdAt: number;
  updatedAt: number;
}

export interface TestPackageRecord {
  id: string;
  name: string;
  description: string;
  accessType: AccessType;
  tests: number;
  unlimitedDays: number | null;
  priceBdt: number;
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_FREE_TESTS = Math.max(0, Number(process.env.DEFAULT_FREE_TESTS || 3) || 3);
const DEFAULT_CREDIT_COSTS: TestCreditCostsRecord = { part1: 1, part2: 1, part3: 1, full: 3 };
const RESERVATION_TTL_MS = 20 * 60 * 1000;

function safeCreditCost(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export function normalizeCreditCosts(raw: any): TestCreditCostsRecord {
  return {
    part1: safeCreditCost(raw?.part1, DEFAULT_CREDIT_COSTS.part1),
    part2: safeCreditCost(raw?.part2, DEFAULT_CREDIT_COSTS.part2),
    part3: safeCreditCost(raw?.part3, DEFAULT_CREDIT_COSTS.part3),
    full: safeCreditCost(raw?.full, DEFAULT_CREDIT_COSTS.full),
  };
}

export function creditCostForMode(settings: Pick<BillingSettingsRecord, 'creditCosts'>, mode: string): number {
  const costs = normalizeCreditCosts(settings?.creditCosts);
  if (mode === 'part1' || mode === 'part2' || mode === 'part3' || mode === 'full') return costs[mode];
  return costs.full;
}

export function defaultBillingSettings(): BillingSettingsRecord {
  const developmentPaymentsEnabled = process.env.ALLOW_DEVELOPMENT_PAYMENTS === 'true';
  const sslConfigured = Boolean(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASSWORD);
  return {
    signupFreeTests: DEFAULT_FREE_TESTS,
    creditCosts: { ...DEFAULT_CREDIT_COSTS },
    currency: 'BDT',
    developmentPaymentsEnabled,
    activeProvider: sslConfigured ? 'sslcommerz' : 'development',
    updatedAt: Date.now(),
  };
}

export function isUnlimitedActive(entitlement: Partial<TestEntitlementRecord> | null | undefined, now = Date.now()): boolean {
  if (!entitlement?.unlimited) return false;
  return entitlement.unlimitedUntil == null || entitlement.unlimitedUntil > now;
}

export async function getBillingSettings(): Promise<BillingSettingsRecord> {
  const { db } = await ensureSessionFirebaseAdmin();
  const ref = db.collection('billingSettings').doc('global');
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() || {};
    const defaults = defaultBillingSettings();
    return {
      signupFreeTests: Math.max(0, Number(data.signupFreeTests ?? defaults.signupFreeTests) || 0),
      creditCosts: normalizeCreditCosts(data.creditCosts ?? defaults.creditCosts),
      currency: 'BDT',
      developmentPaymentsEnabled: Boolean(data.developmentPaymentsEnabled ?? defaults.developmentPaymentsEnabled),
      activeProvider: data.activeProvider === 'sslcommerz' ? 'sslcommerz' : 'development',
      updatedAt: Number(data.updatedAt) || Date.now(),
    };
  }

  const defaults = defaultBillingSettings();
  await ref.set(defaults, { merge: true });
  return defaults;
}

export async function ensureDefaultPackages(): Promise<void> {
  const { db } = await ensureSessionFirebaseAdmin();
  const snapshot = await db.collection('testPackages').limit(1).get();
  if (!snapshot.empty) return;

  const now = Date.now();
  const packages: TestPackageRecord[] = [
    {
      id: 'single-test',
      name: 'Single Test',
      description: 'One HEXA speaking credit for flexible practice use.',
      accessType: 'credits',
      tests: 1,
      unlimitedDays: null,
      priceBdt: 100,
      active: true,
      sortOrder: 10,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'starter-5',
      name: 'Starter 5',
      description: 'Five speaking credits at a lower per-credit price.',
      accessType: 'credits',
      tests: 5,
      unlimitedDays: null,
      priceBdt: 450,
      active: true,
      sortOrder: 20,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'standard-10',
      name: 'Standard 10',
      description: 'Ten speaking credits for regular practice.',
      accessType: 'credits',
      tests: 10,
      unlimitedDays: null,
      priceBdt: 800,
      active: true,
      sortOrder: 30,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'unlimited-30',
      name: 'Unlimited 30 Days',
      description: 'Unlimited speaking tests for 30 days.',
      accessType: 'unlimited',
      tests: 0,
      unlimitedDays: 30,
      priceBdt: 1500,
      active: false,
      sortOrder: 40,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const batch = db.batch();
  for (const item of packages) {
    batch.set(db.collection('testPackages').doc(item.id), item);
  }
  await batch.commit();
}

export async function listActivePackages(): Promise<TestPackageRecord[]> {
  await ensureDefaultPackages();
  const { db } = await ensureSessionFirebaseAdmin();
  const snapshot = await db.collection('testPackages').get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) } as TestPackageRecord))
    .filter((item) => item.active)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export async function listAllPackages(): Promise<TestPackageRecord[]> {
  await ensureDefaultPackages();
  const { db } = await ensureSessionFirebaseAdmin();
  const snapshot = await db.collection('testPackages').get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) } as TestPackageRecord))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export async function ensureEntitlement(userId: string): Promise<TestEntitlementRecord> {
  const { db } = await ensureSessionFirebaseAdmin();
  const entitlementRef = db.collection('testEntitlements').doc(userId);
  const settingsRef = db.collection('billingSettings').doc('global');

  return db.runTransaction(async (tx) => {
    const entitlementSnap = await tx.get(entitlementRef);
    if (entitlementSnap.exists) {
      return entitlementSnap.data() as TestEntitlementRecord;
    }

    const settingsSnap = await tx.get(settingsRef);
    const defaults = defaultBillingSettings();
    const signupFreeTests = settingsSnap.exists
      ? Math.max(0, Number(settingsSnap.data()?.signupFreeTests ?? defaults.signupFreeTests) || 0)
      : defaults.signupFreeTests;
    const now = Date.now();
    const entitlement: TestEntitlementRecord = {
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

    tx.set(entitlementRef, entitlement);
    if (!settingsSnap.exists) tx.set(settingsRef, defaults, { merge: true });
    if (signupFreeTests > 0) {
      tx.set(db.collection('entitlementLedger').doc(`signup-${userId}`), {
        id: `signup-${userId}`,
        userId,
        type: 'SIGNUP_BONUS',
        delta: signupFreeTests,
        balanceAfter: signupFreeTests,
        note: 'Automatic free-credit allowance for a new account.',
        createdAt: now,
      });
    }
    return entitlement;
  });
}

export async function releaseExpiredReservationsForUser(userId: string): Promise<void> {
  const { db } = await ensureSessionFirebaseAdmin();
  const snapshot = await db.collection('testReservations').where('userId', '==', userId).get();
  const now = Date.now();
  const expired = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((item: any) => item.status === 'reserved' && Number(item.expiresAt) <= now);

  for (const item of expired) {
    await releaseReservation(userId, item.id, 'Reservation expired before the test connected.');
  }
}

export async function getEntitlement(userId: string): Promise<TestEntitlementRecord> {
  await releaseExpiredReservationsForUser(userId).catch(() => undefined);
  const entitlement = await ensureEntitlement(userId);
  if (entitlement.unlimited && entitlement.unlimitedUntil != null && entitlement.unlimitedUntil <= Date.now()) {
    const { db } = await ensureSessionFirebaseAdmin();
    await db.collection('testEntitlements').doc(userId).set({ unlimited: false, unlimitedUntil: null, updatedAt: Date.now() }, { merge: true });
    return { ...entitlement, unlimited: false, unlimitedUntil: null, updatedAt: Date.now() };
  }
  return entitlement;
}

function paymentRequiredError(requiredCredits: number, availableCredits: number) {
  const error: any = new Error(`This test requires ${requiredCredits} credit${requiredCredits === 1 ? '' : 's'}, but your balance is ${availableCredits}.`);
  error.httpStatus = 402;
  error.publicCode = 'PAYMENT_REQUIRED';
  error.requiredCredits = requiredCredits;
  error.availableCredits = availableCredits;
  return error;
}

export async function reserveTestCredit(userId: string, sessionId: string, mode: string) {
  await releaseExpiredReservationsForUser(userId).catch(() => undefined);
  await ensureEntitlement(userId);
  const settings = await getBillingSettings();
  const creditCost = creditCostForMode(settings, mode);
  const { db } = await ensureSessionFirebaseAdmin();
  const entitlementRef = db.collection('testEntitlements').doc(userId);
  const reservationRef = db.collection('testReservations').doc(sessionId);
  const ledgerRef = db.collection('entitlementLedger').doc(`reserve-${sessionId}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const [entSnap, reservationSnap] = await Promise.all([tx.get(entitlementRef), tx.get(reservationRef)]);
    if (reservationSnap.exists) return reservationSnap.data();
    const entitlement = entSnap.data() as TestEntitlementRecord;

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
      tx.set(reservationRef, reservation);
      return reservation;
    }

    const balance = Math.max(0, Number(entitlement.creditBalance) || 0);
    if (balance < creditCost) throw paymentRequiredError(creditCost, balance);

    const nextBalance = balance - creditCost;
    if (creditCost > 0) tx.update(entitlementRef, { creditBalance: nextBalance, updatedAt: now });
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
    tx.set(ledgerRef, {
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

export async function consumeReservation(userId: string, sessionId: string) {
  const { db } = await ensureSessionFirebaseAdmin();
  const entitlementRef = db.collection('testEntitlements').doc(userId);
  const reservationRef = db.collection('testReservations').doc(sessionId);
  const ledgerRef = db.collection('entitlementLedger').doc(`consume-${sessionId}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const [entSnap, reservationSnap] = await Promise.all([tx.get(entitlementRef), tx.get(reservationRef)]);
    if (!reservationSnap.exists) {
      const error: any = new Error('No billing reservation exists for this session.');
      error.httpStatus = 409;
      error.publicCode = 'RESERVATION_NOT_FOUND';
      throw error;
    }
    const reservation = reservationSnap.data() as any;
    if (reservation.userId !== userId) {
      const error: any = new Error('This reservation belongs to another user.');
      error.httpStatus = 403;
      error.publicCode = 'RESERVATION_FORBIDDEN';
      throw error;
    }
    if (reservation.status === 'consumed') return reservation;
    if (reservation.status !== 'reserved') {
      const error: any = new Error(`Reservation cannot be consumed from state ${reservation.status}.`);
      error.httpStatus = 409;
      error.publicCode = 'RESERVATION_NOT_ACTIVE';
      throw error;
    }

    const entitlement = entSnap.data() as TestEntitlementRecord;
    const creditCost = reservation.chargeType === 'credit' ? Math.max(0, Number(reservation.creditCost ?? 1) || 0) : 0;
    const totalConsumed = (Number(entitlement.totalConsumed) || 0) + creditCost;
    tx.update(entitlementRef, { totalConsumed, updatedAt: now });
    tx.update(reservationRef, { status: 'consumed', consumedAt: now });
    tx.set(ledgerRef, {
      id: `consume-${sessionId}`,
      userId,
      sessionId,
      type: 'TEST_CONSUMED',
      delta: 0,
      balanceAfter: Number(entitlement.creditBalance) || 0,
      note: creditCost > 0
        ? `${creditCost} reserved credit${creditCost === 1 ? '' : 's'} consumed after live examiner connection.`
        : 'No credits consumed for this test.',
      createdAt: now,
    });
    return { ...reservation, status: 'consumed', consumedAt: now };
  });
}

export async function releaseReservation(userId: string, sessionId: string, note = 'Test startup failed before connection.') {
  const { db } = await ensureSessionFirebaseAdmin();
  const entitlementRef = db.collection('testEntitlements').doc(userId);
  const reservationRef = db.collection('testReservations').doc(sessionId);
  const ledgerRef = db.collection('entitlementLedger').doc(`release-${sessionId}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const [entSnap, reservationSnap] = await Promise.all([tx.get(entitlementRef), tx.get(reservationRef)]);
    if (!reservationSnap.exists) return null;
    const reservation = reservationSnap.data() as any;
    if (reservation.userId !== userId) return null;
    if (reservation.status !== 'reserved') return reservation;

    if (reservation.chargeType === 'credit') {
      const entitlement = entSnap.data() as TestEntitlementRecord;
      const refundCredits = Math.max(0, Number(reservation.creditCost ?? 1) || 0);
      const nextBalance = Math.max(0, Number(entitlement.creditBalance) || 0) + refundCredits;
      tx.update(entitlementRef, { creditBalance: nextBalance, updatedAt: now });
      tx.set(ledgerRef, {
        id: `release-${sessionId}`,
        userId,
        sessionId,
        type: 'TEST_RELEASED',
        delta: refundCredits,
        balanceAfter: nextBalance,
        note,
        createdAt: now,
      });
    }
    tx.update(reservationRef, { status: 'released', releasedAt: now, releaseReason: note });
    return { ...reservation, status: 'released', releasedAt: now };
  });
}

export async function recentOrdersForUser(userId: string, limit = 10) {
  const { db } = await ensureSessionFirebaseAdmin();
  const snapshot = await db.collection('paymentOrders').where('userId', '==', userId).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .sort((a: any, b: any) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, limit);
}

export async function createPaymentOrder(userId: string, packageRecord: TestPackageRecord, provider: PaymentProvider) {
  const { db } = await ensureSessionFirebaseAdmin();
  const now = Date.now();
  const orderId = `HEXA-${new Date(now).toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const order = {
    id: orderId,
    userId,
    packageId: packageRecord.id,
    packageSnapshot: {
      name: packageRecord.name,
      accessType: packageRecord.accessType,
      tests: packageRecord.tests,
      unlimitedDays: packageRecord.unlimitedDays,
      priceBdt: packageRecord.priceBdt,
    },
    amountBdt: packageRecord.priceBdt,
    currency: 'BDT',
    provider,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await db.collection('paymentOrders').doc(orderId).set(order);
  return order;
}

export async function markOrderStatus(orderId: string, status: string, metadata: Record<string, unknown> = {}) {
  const { db } = await ensureSessionFirebaseAdmin();
  await db.collection('paymentOrders').doc(orderId).set({ status, updatedAt: Date.now(), ...metadata }, { merge: true });
}

export async function applyPaidOrder(orderId: string, providerMetadata: Record<string, unknown> = {}) {
  const { db } = await ensureSessionFirebaseAdmin();
  const orderRef = db.collection('paymentOrders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    const error: any = new Error('Payment order was not found.');
    error.httpStatus = 404;
    error.publicCode = 'ORDER_NOT_FOUND';
    throw error;
  }
  const initialOrder = orderSnap.data() as any;
  await ensureEntitlement(initialOrder.userId);

  return db.runTransaction(async (tx) => {
    const freshOrderSnap = await tx.get(orderRef);
    const order = freshOrderSnap.data() as any;
    if (order.status === 'paid') return order;
    if (!order.userId || !order.packageSnapshot) throw new Error('Payment order is incomplete.');

    const entitlementRef = db.collection('testEntitlements').doc(order.userId);
    const entitlementSnap = await tx.get(entitlementRef);
    const entitlement = entitlementSnap.data() as TestEntitlementRecord;
    const pkg = order.packageSnapshot;
    const now = Date.now();
    const ledgerId = `payment-${orderId}`;
    let nextBalance = Number(entitlement.creditBalance) || 0;
    const entitlementPatch: Record<string, unknown> = { updatedAt: now };

    if (pkg.accessType === 'unlimited') {
      const days = Math.max(1, Number(pkg.unlimitedDays) || 30);
      const currentUntil = isUnlimitedActive(entitlement, now) && entitlement.unlimitedUntil
        ? entitlement.unlimitedUntil
        : now;
      entitlementPatch.unlimited = true;
      entitlementPatch.unlimitedUntil = currentUntil + days * 24 * 60 * 60 * 1000;
      entitlementPatch.totalPurchased = (Number(entitlement.totalPurchased) || 0) + 1;
    } else {
      const tests = Math.max(1, Number(pkg.tests) || 1);
      nextBalance += tests;
      entitlementPatch.creditBalance = nextBalance;
      entitlementPatch.totalPurchased = (Number(entitlement.totalPurchased) || 0) + tests;
    }

    tx.update(entitlementRef, entitlementPatch);
    tx.update(orderRef, {
      status: 'paid',
      paidAt: now,
      updatedAt: now,
      providerMetadata,
    });
    tx.set(db.collection('entitlementLedger').doc(ledgerId), {
      id: ledgerId,
      userId: order.userId,
      orderId,
      type: pkg.accessType === 'unlimited' ? 'UNLIMITED_PURCHASE' : 'PAYMENT_CREDIT',
      delta: pkg.accessType === 'unlimited' ? 0 : Math.max(1, Number(pkg.tests) || 1),
      balanceAfter: nextBalance,
      note: `Payment confirmed for ${pkg.name}.`,
      createdAt: now,
    });
    return { ...order, status: 'paid', paidAt: now };
  });
}

export async function adminGrantCredits(adminUid: string, userId: string, amount: number, note?: string) {
  const safeAmount = Math.max(1, Math.floor(Number(amount) || 0));
  await ensureEntitlement(userId);
  const { db } = await ensureSessionFirebaseAdmin();
  const ref = db.collection('testEntitlements').doc(userId);
  const now = Date.now();
  const ledgerId = `admin-grant-${randomUUID()}`;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const entitlement = snap.data() as TestEntitlementRecord;
    const nextBalance = (Number(entitlement.creditBalance) || 0) + safeAmount;
    tx.update(ref, {
      creditBalance: nextBalance,
      totalGranted: (Number(entitlement.totalGranted) || 0) + safeAmount,
      updatedAt: now,
    });
    tx.set(db.collection('entitlementLedger').doc(ledgerId), {
      id: ledgerId,
      userId,
      adminUid,
      type: 'ADMIN_GRANT',
      delta: safeAmount,
      balanceAfter: nextBalance,
      note: note || 'Free credit granted by administrator.',
      createdAt: now,
    });
    return { ...entitlement, creditBalance: nextBalance, updatedAt: now };
  });
}

export async function adminSetBalance(adminUid: string, userId: string, targetBalance: number, note?: string) {
  const safeBalance = Math.max(0, Math.floor(Number(targetBalance) || 0));
  await ensureEntitlement(userId);
  const { db } = await ensureSessionFirebaseAdmin();
  const ref = db.collection('testEntitlements').doc(userId);
  const now = Date.now();
  const ledgerId = `admin-set-${randomUUID()}`;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const entitlement = snap.data() as TestEntitlementRecord;
    const previous = Number(entitlement.creditBalance) || 0;
    const delta = safeBalance - previous;
    tx.update(ref, { creditBalance: safeBalance, updatedAt: now });
    tx.set(db.collection('entitlementLedger').doc(ledgerId), {
      id: ledgerId,
      userId,
      adminUid,
      type: 'ADMIN_SET_BALANCE',
      delta,
      balanceAfter: safeBalance,
      note: note || 'Test-credit balance set by administrator.',
      createdAt: now,
    });
    return { ...entitlement, creditBalance: safeBalance, updatedAt: now };
  });
}

export async function adminSetUnlimited(adminUid: string, userId: string, enabled: boolean, until: number | null, note?: string) {
  await ensureEntitlement(userId);
  const { db } = await ensureSessionFirebaseAdmin();
  const ref = db.collection('testEntitlements').doc(userId);
  const now = Date.now();
  const unlimitedUntil = enabled ? (until && until > now ? until : null) : null;
  await ref.set({ unlimited: enabled, unlimitedUntil, updatedAt: now }, { merge: true });
  await db.collection('entitlementLedger').doc(`admin-unlimited-${randomUUID()}`).set({
    userId,
    adminUid,
    type: enabled ? 'ADMIN_UNLIMITED_ENABLED' : 'ADMIN_UNLIMITED_DISABLED',
    delta: 0,
    note: note || (enabled ? 'Unlimited access enabled by administrator.' : 'Unlimited access disabled by administrator.'),
    unlimitedUntil,
    createdAt: now,
  });
  return getEntitlement(userId);
}
