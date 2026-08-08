import { getFirebaseIdToken } from './firebaseClient';
import { BillingSettings, PaymentOrder, PaymentProvider, TestEntitlement, TestPackage } from '../types';

export interface BillingMeResponse {
  entitlement: TestEntitlement;
  packages: TestPackage[];
  settings: BillingSettings;
  orders: PaymentOrder[];
  isAdmin: boolean;
}

async function billingFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const idToken = await getFirebaseIdToken();
  const response = await fetch(`/api/billing/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: any = new Error(payload?.error || `Billing request failed (${response.status}).`);
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export const BillingService = {
  getMe(): Promise<BillingMeResponse> {
    return billingFetch<BillingMeResponse>('me', { method: 'GET' });
  },

  checkout(packageId: string, provider: PaymentProvider, customerName: string, customerPhone: string) {
    return billingFetch<{ orderId: string; provider: PaymentProvider; checkoutUrl?: string; development?: boolean }>('checkout', {
      method: 'POST',
      body: JSON.stringify({ packageId, provider, customerName, customerPhone }),
    });
  },

  completeDevelopmentPayment(orderId: string) {
    return billingFetch<{ ok: boolean; orderId: string }>('development/complete', {
      method: 'POST',
      body: JSON.stringify({ orderId }),
    });
  },

  consumeReservation(sessionId: string) {
    return billingFetch<{ ok: boolean }>('reservation/consume', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  },

  releaseReservation(sessionId: string, reason?: string) {
    return billingFetch<{ ok: boolean }>('reservation/release', {
      method: 'POST',
      body: JSON.stringify({ sessionId, reason }),
    });
  },

  getAdminOverview() {
    return billingFetch<any>('admin/overview', { method: 'GET' });
  },

  updateAdminSettings(payload: Partial<BillingSettings>) {
    return billingFetch<any>('admin/settings', { method: 'POST', body: JSON.stringify(payload) });
  },

  savePackage(payload: Partial<TestPackage> & { name: string }) {
    return billingFetch<any>('admin/package', { method: 'POST', body: JSON.stringify(payload) });
  },

  grantCredits(userId: string, amount: number, note?: string) {
    return billingFetch<any>('admin/grant', { method: 'POST', body: JSON.stringify({ userId, amount, note }) });
  },

  setBalance(userId: string, balance: number, note?: string) {
    return billingFetch<any>('admin/set-balance', { method: 'POST', body: JSON.stringify({ userId, balance, note }) });
  },

  setUnlimited(userId: string, enabled: boolean, until: number | null, note?: string) {
    return billingFetch<any>('admin/unlimited', { method: 'POST', body: JSON.stringify({ userId, enabled, until, note }) });
  },
};
