import { randomUUID } from 'node:crypto';
import { ensureSessionFirebaseAdmin } from './_firebaseSessionAdminLazy.js';
import {
  adminGrantCredits,
  adminSetBalance,
  adminSetUnlimited,
  applyPaidOrder,
  createPaymentOrder,
  ensureDefaultPackages,
  getBillingSettings,
  getEntitlement,
  listActivePackages,
  listAllPackages,
  markOrderStatus,
  recentOrdersForUser,
  releaseReservation,
  consumeReservation,
  type PaymentProvider,
  type TestPackageRecord,
} from './_billing.js';

const API_REVISION = '1.2.3-paid-access-esm-import-fix';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
}

function parseBody(req: any): any {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  const raw = String(req.body);
  try { return JSON.parse(raw); } catch {}
  try { return Object.fromEntries(new URLSearchParams(raw).entries()); } catch {}
  return {};
}

function cleanPath(req: any): string {
  const queryPath = typeof req.query?.path === 'string' ? req.query.path : '';
  return queryPath.replace(/^\/+|\/+$/g, '');
}

function publicError(error: any) {
  return {
    status: Number(error?.httpStatus) || 500,
    code: error?.publicCode || 'BILLING_ERROR',
    message: String(error?.message || 'Billing request failed.').slice(0, 500),
  };
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
  let auth: any;
  try {
    ({ auth } = await ensureSessionFirebaseAdmin());
  } catch (cause: any) {
    const error: any = new Error(`Firebase Admin could not initialize: ${String(cause?.message || cause)}`);
    error.httpStatus = 500;
    error.publicCode = 'FIREBASE_ADMIN_INIT_FAILED';
    error.cause = cause;
    throw error;
  }
  try {
    return await auth.verifyIdToken(token);
  } catch (cause: any) {
    const error: any = new Error('Your sign-in session could not be verified.');
    error.httpStatus = 401;
    error.publicCode = 'AUTH_INVALID';
    error.cause = cause;
    throw error;
  }
}

async function userIsAdmin(decoded: any): Promise<boolean> {
  if (decoded?.admin === true || decoded?.role === 'admin') return true;
  const { db } = await ensureSessionFirebaseAdmin();
  const profile = await db.collection('users').doc(decoded.uid).get();
  return profile.exists && (profile.data()?.role === 'admin' || profile.data()?.admin === true);
}

async function requireAdmin(req: any) {
  const decoded = await verifyUser(req);
  if (!(await userIsAdmin(decoded))) {
    const error: any = new Error('Administrator access is required.');
    error.httpStatus = 403;
    error.publicCode = 'ADMIN_REQUIRED';
    throw error;
  }
  return decoded;
}

function appBaseUrl(req: any): string {
  const configured = String(process.env.APP_URL || process.env.VITE_APP_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function sslConfig() {
  const storeId = String(process.env.SSLCOMMERZ_STORE_ID || '').trim();
  const storePassword = String(process.env.SSLCOMMERZ_STORE_PASSWORD || '').trim();
  const live = process.env.SSLCOMMERZ_IS_LIVE === 'true';
  if (!storeId || !storePassword) {
    const error: any = new Error('SSLCOMMERZ credentials are not configured yet. Add them in Vercel Environment Variables when you are ready.');
    error.httpStatus = 503;
    error.publicCode = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  return {
    storeId,
    storePassword,
    live,
    base: live ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com',
  };
}

async function startSslcommerzCheckout(req: any, order: any, decoded: any, body: any) {
  const config = sslConfig();
  const baseUrl = appBaseUrl(req);
  const params = new URLSearchParams({
    store_id: config.storeId,
    store_passwd: config.storePassword,
    total_amount: Number(order.amountBdt).toFixed(2),
    currency: 'BDT',
    tran_id: order.id,
    success_url: `${baseUrl}/api/billing/sslcommerz/success`,
    fail_url: `${baseUrl}/api/billing/sslcommerz/fail`,
    cancel_url: `${baseUrl}/api/billing/sslcommerz/cancel`,
    ipn_url: `${baseUrl}/api/billing/sslcommerz/ipn`,
    cus_name: String(body.customerName || decoded.name || decoded.email || 'HEXA Student').slice(0, 50),
    cus_email: String(decoded.email || body.customerEmail || 'student@example.com').slice(0, 50),
    cus_add1: 'N/A',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: String(body.customerPhone || '').replace(/\s+/g, '').slice(0, 20),
    shipping_method: 'NO',
    product_name: String(order.packageSnapshot?.name || 'HEXA Speaking Test Package').slice(0, 100),
    product_category: 'Education',
    product_profile: 'non-physical-goods',
    value_a: order.userId,
    value_b: order.packageId,
    value_c: order.id,
  });

  if (!params.get('cus_phone')) {
    const error: any = new Error('A phone number is required for payment checkout.');
    error.httpStatus = 400;
    error.publicCode = 'PHONE_REQUIRED';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.base}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
    if (!response.ok || !payload?.GatewayPageURL) {
      throw new Error(payload?.failedreason || payload?.status || 'SSLCOMMERZ did not return a checkout URL.');
    }
    await markOrderStatus(order.id, 'pending', {
      providerSessionKey: payload.sessionkey || null,
      providerGatewayUrl: payload.GatewayPageURL,
    });
    return { checkoutUrl: payload.GatewayPageURL, provider: 'sslcommerz', orderId: order.id };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateSslcommerzPayment(orderId: string, valId: string) {
  const config = sslConfig();
  if (!valId) throw new Error('SSLCOMMERZ validation ID is missing.');
  const query = new URLSearchParams({
    val_id: valId,
    store_id: config.storeId,
    store_passwd: config.storePassword,
    format: 'json',
  });
  const response = await fetch(`${config.base}/validator/api/validationserverAPI.php?${query.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !['VALID', 'VALIDATED'].includes(String(payload?.status || '').toUpperCase())) {
    throw new Error('SSLCOMMERZ transaction validation failed.');
  }
  if (String(payload?.tran_id || '') !== orderId) throw new Error('Payment transaction ID does not match the order.');

  const { db } = await ensureSessionFirebaseAdmin();
  const orderSnap = await db.collection('paymentOrders').doc(orderId).get();
  if (!orderSnap.exists) throw new Error('Payment order was not found.');
  const order = orderSnap.data() as any;
  const validatedCurrency = String(payload.currency_type || payload.currency || '').toUpperCase();
  if (Math.abs(Number(payload.amount) - Number(order.amountBdt)) > 0.001 || validatedCurrency !== 'BDT') {
    throw new Error('Validated payment amount or currency does not match the order.');
  }
  if (Number(payload.risk_level || 0) === 1) {
    await markOrderStatus(orderId, 'review', { providerMetadata: payload, reviewReason: 'SSLCOMMERZ marked the transaction as risky.' });
    const error: any = new Error('Payment is awaiting manual risk review.');
    error.httpStatus = 202;
    error.publicCode = 'PAYMENT_REVIEW';
    throw error;
  }
  return payload;
}

async function handleSslCallback(req: any, res: any, kind: 'success' | 'fail' | 'cancel' | 'ipn') {
  const body = parseBody(req);
  const orderId = String(body.tran_id || body.value_c || '');
  const baseUrl = appBaseUrl(req);
  if (!orderId) return res.status(400).json({ error: 'Missing transaction ID.' });

  if (kind === 'fail' || kind === 'cancel') {
    await markOrderStatus(orderId, kind === 'fail' ? 'failed' : 'cancelled', { providerCallback: body });
    if (kind === 'ipn') return res.status(200).json({ ok: true });
    return res.redirect(303, `${baseUrl}/billing?payment=${kind}&orderId=${encodeURIComponent(orderId)}`);
  }

  try {
    const validation = await validateSslcommerzPayment(orderId, String(body.val_id || ''));
    await applyPaidOrder(orderId, {
      provider: 'sslcommerz',
      valId: validation.val_id,
      bankTransactionId: validation.bank_tran_id,
      cardType: validation.card_type,
      validatedStatus: validation.status,
    });
    if (kind === 'ipn') return res.status(200).json({ ok: true });
    return res.redirect(303, `${baseUrl}/billing?payment=success&orderId=${encodeURIComponent(orderId)}`);
  } catch (error: any) {
    if (kind === 'ipn') return res.status(Number(error?.httpStatus) === 202 ? 202 : 400).json({ ok: false, error: error.message });
    return res.redirect(303, `${baseUrl}/billing?payment=verification_failed&orderId=${encodeURIComponent(orderId)}`);
  }
}

export default async function handler(req: any, res: any) {
  setCommonHeaders(req, res);
  res.setHeader('X-HEXA-Billing-Revision', API_REVISION);
  const requestId = String(req.headers?.['x-request-id'] || `billing-${randomUUID()}`);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const path = cleanPath(req);
  try {
    if (path === 'sslcommerz/success') return handleSslCallback(req, res, 'success');
    if (path === 'sslcommerz/fail') return handleSslCallback(req, res, 'fail');
    if (path === 'sslcommerz/cancel') return handleSslCallback(req, res, 'cancel');
    if (path === 'sslcommerz/ipn') return handleSslCallback(req, res, 'ipn');

    if (path === 'me' && req.method === 'GET') {
      const decoded = await verifyUser(req);
      const [entitlement, packages, settings, orders, isAdmin] = await Promise.all([
        getEntitlement(decoded.uid),
        listActivePackages(),
        getBillingSettings(),
        recentOrdersForUser(decoded.uid),
        userIsAdmin(decoded),
      ]);
      return res.status(200).json({ entitlement, packages, settings, orders, isAdmin, requestId });
    }

    if (path === 'checkout' && req.method === 'POST') {
      const decoded = await verifyUser(req);
      const body = parseBody(req);
      const packages = await listActivePackages();
      const pkg = packages.find((item) => item.id === body.packageId);
      if (!pkg) return res.status(404).json({ error: 'Selected package is not available.', code: 'PACKAGE_NOT_FOUND' });
      const settings = await getBillingSettings();
      const provider: PaymentProvider = body.provider === 'sslcommerz' ? 'sslcommerz' : body.provider === 'development' ? 'development' : settings.activeProvider;
      if (provider === 'development' && !settings.developmentPaymentsEnabled) {
        return res.status(403).json({ error: 'Development payments are disabled.', code: 'DEV_PAYMENTS_DISABLED' });
      }
      const order = await createPaymentOrder(decoded.uid, pkg, provider);
      if (provider === 'development') {
        return res.status(201).json({ orderId: order.id, provider, development: true });
      }
      const checkout = await startSslcommerzCheckout(req, order, decoded, body);
      return res.status(201).json(checkout);
    }

    if (path === 'development/complete' && req.method === 'POST') {
      const decoded = await verifyUser(req);
      const settings = await getBillingSettings();
      if (!settings.developmentPaymentsEnabled) return res.status(403).json({ error: 'Development payments are disabled.', code: 'DEV_PAYMENTS_DISABLED' });
      const body = parseBody(req);
      const orderId = String(body.orderId || '');
      const { db } = await ensureSessionFirebaseAdmin();
      const snap = await db.collection('paymentOrders').doc(orderId).get();
      if (!snap.exists || snap.data()?.userId !== decoded.uid || snap.data()?.provider !== 'development') {
        return res.status(404).json({ error: 'Development order was not found.', code: 'ORDER_NOT_FOUND' });
      }
      await applyPaidOrder(orderId, { provider: 'development', simulated: true });
      return res.status(200).json({ ok: true, orderId });
    }

    if ((path === 'reservation/consume' || path === 'reservation/release') && req.method === 'POST') {
      const decoded = await verifyUser(req);
      const body = parseBody(req);
      const sessionId = String(body.sessionId || '');
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required.' });
      const result = path.endsWith('consume')
        ? await consumeReservation(decoded.uid, sessionId)
        : await releaseReservation(decoded.uid, sessionId, String(body.reason || 'Test startup failed before connection.'));
      return res.status(200).json({ ok: true, reservation: result });
    }

    // The Gemini mint function intentionally avoids importing firebase-admin
    // because that dependency previously crashed the Vercel function during
    // bootstrap. It calls this authenticated endpoint before minting a token,
    // so a valid paid/server-created session is still required.
    if (path === 'reservation/authorize-mint' && req.method === 'POST') {
      const decoded = await verifyUser(req);
      const body = parseBody(req);
      const sessionId = String(body.sessionId || '');
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required.', code: 'SESSION_ID_REQUIRED' });

      const { db } = await ensureSessionFirebaseAdmin();
      const [reservationSnap, sessionSnap] = await Promise.all([
        db.collection('testReservations').doc(sessionId).get(),
        db.collection('speakingSessions').doc(sessionId).get(),
      ]);

      if (!reservationSnap.exists || !sessionSnap.exists) {
        return res.status(403).json({ error: 'This live session is not authorized for paid access.', code: 'PAID_SESSION_NOT_AUTHORIZED' });
      }

      const reservation = reservationSnap.data() as any;
      const session = sessionSnap.data() as any;
      const owned = reservation.userId === decoded.uid && session.userId === decoded.uid;
      const linked = session.billingReservationId === sessionId && reservation.sessionId === sessionId;
      const activeReservation = reservation.status === 'reserved' || reservation.status === 'consumed';
      const activeSession = session.status === 'active';

      if (!owned || !linked || !activeReservation || !activeSession) {
        return res.status(403).json({ error: 'This live session is not authorized for paid access.', code: 'PAID_SESSION_NOT_AUTHORIZED' });
      }

      if (reservation.status === 'reserved' && Number(reservation.expiresAt || 0) <= Date.now()) {
        await releaseReservation(decoded.uid, sessionId, 'Reservation expired before Gemini token authorization.').catch(() => undefined);
        return res.status(409).json({ error: 'This test reservation expired. Start a new test; the reserved credit has been returned.', code: 'RESERVATION_EXPIRED' });
      }

      return res.status(200).json({ ok: true, sessionId, reservationStatus: reservation.status });
    }

    if (path === 'admin/overview' && req.method === 'GET') {
      await requireAdmin(req);
      const { db } = await ensureSessionFirebaseAdmin();
      const [settings, packages, usersSnap, ordersSnap] = await Promise.all([
        getBillingSettings(),
        listAllPackages(),
        db.collection('users').limit(100).get(),
        db.collection('paymentOrders').limit(200).get(),
      ]);
      const users = await Promise.all(usersSnap.docs.map(async (profileDoc) => ({
        uid: profileDoc.id,
        email: profileDoc.data()?.email || '',
        displayName: profileDoc.data()?.displayName || '',
        role: profileDoc.data()?.role || 'student',
        entitlement: await getEntitlement(profileDoc.id),
      })));
      const orders = ordersSnap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
        .sort((a: any, b: any) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .slice(0, 100);
      return res.status(200).json({ settings, packages, users, orders });
    }

    if (path === 'admin/settings' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      const body = parseBody(req);
      const current = await getBillingSettings();
      const next = {
        ...current,
        signupFreeTests: Math.max(0, Math.floor(Number(body.signupFreeTests ?? current.signupFreeTests) || 0)),
        developmentPaymentsEnabled: body.developmentPaymentsEnabled == null ? current.developmentPaymentsEnabled : Boolean(body.developmentPaymentsEnabled),
        activeProvider: body.activeProvider === 'sslcommerz' ? 'sslcommerz' : 'development',
        updatedAt: Date.now(),
        updatedBy: admin.uid,
      };
      const { db } = await ensureSessionFirebaseAdmin();
      await db.collection('billingSettings').doc('global').set(next, { merge: true });
      return res.status(200).json({ settings: next });
    }

    if (path === 'admin/package' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      const body = parseBody(req);
      await ensureDefaultPackages();
      const id = String(body.id || body.name || `package-${randomUUID().slice(0, 8)}`)
        .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      if (!id) return res.status(400).json({ error: 'Package ID/name is required.' });
      const now = Date.now();
      const pkg: TestPackageRecord = {
        id,
        name: String(body.name || 'Test Package').slice(0, 80),
        description: String(body.description || '').slice(0, 240),
        accessType: body.accessType === 'unlimited' ? 'unlimited' : 'credits',
        tests: body.accessType === 'unlimited' ? 0 : Math.max(1, Math.floor(Number(body.tests) || 1)),
        unlimitedDays: body.accessType === 'unlimited' ? Math.max(1, Math.floor(Number(body.unlimitedDays) || 30)) : null,
        priceBdt: Math.max(0, Math.round(Number(body.priceBdt) || 0)),
        active: body.active !== false,
        sortOrder: Math.floor(Number(body.sortOrder) || 100),
        createdAt: Number(body.createdAt) || now,
        updatedAt: now,
      };
      const { db } = await ensureSessionFirebaseAdmin();
      await db.collection('testPackages').doc(id).set({ ...pkg, updatedBy: admin.uid }, { merge: true });
      return res.status(200).json({ package: pkg });
    }

    if (path === 'admin/grant' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      const body = parseBody(req);
      const entitlement = await adminGrantCredits(admin.uid, String(body.userId || ''), Number(body.amount), String(body.note || ''));
      return res.status(200).json({ entitlement });
    }

    if (path === 'admin/set-balance' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      const body = parseBody(req);
      const entitlement = await adminSetBalance(admin.uid, String(body.userId || ''), Number(body.balance), String(body.note || ''));
      return res.status(200).json({ entitlement });
    }

    if (path === 'admin/unlimited' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      const body = parseBody(req);
      const until = body.until ? Number(body.until) : null;
      const entitlement = await adminSetUnlimited(admin.uid, String(body.userId || ''), Boolean(body.enabled), until, String(body.note || ''));
      return res.status(200).json({ entitlement });
    }

    return res.status(404).json({ error: 'Billing route not found.', code: 'BILLING_ROUTE_NOT_FOUND', path });
  } catch (error: any) {
    const safe = publicError(error);
    console.error('[HEXA billing]', requestId, path, safe.code, safe.message);
    return res.status(safe.status).json({ error: safe.message, code: safe.code, requestId, apiRevision: API_REVISION });
  }
}
