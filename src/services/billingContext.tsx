import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BillingSettings, PaymentOrder, TestEntitlement, TestPackage } from '../types';
import { useAuth } from './authContext';
import { BillingService } from './billingService';
import { APP_CONFIG } from '../config';

interface BillingContextValue {
  entitlement: TestEntitlement | null;
  packages: TestPackage[];
  settings: BillingSettings | null;
  orders: PaymentOrder[];
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const BillingContext = createContext<BillingContextValue | undefined>(undefined);

function mockBilling(): Omit<BillingContextValue, 'refresh'> {
  const now = Date.now();
  return {
    entitlement: {
      userId: 'mock-user-id',
      creditBalance: 99,
      unlimited: true,
      unlimitedUntil: null,
      totalPurchased: 0,
      totalGranted: 99,
      totalConsumed: 0,
      createdAt: now,
      updatedAt: now,
    },
    packages: [],
    settings: {
      signupFreeTests: 3,
      creditCosts: { part1: 1, part2: 1, part3: 1, full: 3 },
      currency: 'BDT',
      developmentPaymentsEnabled: true,
      activeProvider: 'development',
      updatedAt: now,
    },
    orders: [],
    isAdmin: true,
    loading: false,
    error: null,
  };
}

export const BillingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [entitlement, setEntitlement] = useState<TestEntitlement | null>(null);
  const [packages, setPackages] = useState<TestPackage[]>([]);
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setEntitlement(null);
      setPackages([]);
      setSettings(null);
      setOrders([]);
      setIsAdmin(false);
      return;
    }
    if (APP_CONFIG.useMocks) {
      const mocked = mockBilling();
      setEntitlement(mocked.entitlement);
      setPackages(mocked.packages);
      setSettings(mocked.settings);
      setOrders(mocked.orders);
      setIsAdmin(mocked.isAdmin);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await BillingService.getMe();
      setEntitlement(data.entitlement);
      setPackages(data.packages || []);
      setSettings(data.settings);
      setOrders(data.orders || []);
      setIsAdmin(Boolean(data.isAdmin));
    } catch (err: any) {
      console.error('[BillingContext] Failed to load billing status:', err);
      setError(err.message || 'Could not load test access.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  return (
    <BillingContext.Provider value={{ entitlement, packages, settings, orders, isAdmin, loading, error, refresh }}>
      {children}
    </BillingContext.Provider>
  );
};

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling must be used within BillingProvider');
  return context;
}
