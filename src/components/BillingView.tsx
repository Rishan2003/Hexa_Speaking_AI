import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Infinity, Loader2, RefreshCw, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { useAuth } from '../services/authContext';
import { useBilling } from '../services/billingContext';
import { BillingService } from '../services/billingService';
import { PaymentProvider, TestPackage } from '../types';

const taka = (amount: number) => `৳${Number(amount || 0).toLocaleString('en-BD')}`;

export const BillingView: React.FC = () => {
  const { user } = useAuth();
  const { entitlement, packages, settings, orders, loading, error, refresh } = useBilling();
  const [customerName, setCustomerName] = useState(user?.displayName || '');
  const [customerPhone, setCustomerPhone] = useState('');
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment')) {
      const state = params.get('payment');
      setMessage(state === 'success' ? 'Payment confirmed. Your test access has been updated.' : `Payment status: ${state?.replaceAll('_', ' ')}.`);
      void refresh();
      window.history.replaceState(null, '', '/billing');
    }
  }, []);

  const provider: PaymentProvider = settings?.activeProvider || 'development';
  const accessLabel = useMemo(() => {
    if (!entitlement) return 'Loading access…';
    if (entitlement.unlimited && (!entitlement.unlimitedUntil || entitlement.unlimitedUntil > Date.now())) {
      return entitlement.unlimitedUntil
        ? `Unlimited until ${new Date(entitlement.unlimitedUntil).toLocaleDateString()}`
        : 'Unlimited access';
    }
    return `${entitlement.creditBalance} credit${entitlement.creditBalance === 1 ? '' : 's'} available`;
  }, [entitlement]);

  const buy = async (pkg: TestPackage) => {
    setBusyPackage(pkg.id);
    setMessage(null);
    setActionError(null);
    try {
      if (provider === 'sslcommerz' && !customerPhone.trim()) {
        throw new Error('Enter a phone number before opening the payment checkout.');
      }
      const checkout = await BillingService.checkout(pkg.id, provider, customerName.trim(), customerPhone.trim());
      if (checkout.development) {
        await BillingService.completeDevelopmentPayment(checkout.orderId);
        setMessage(`Development payment completed for ${pkg.name}. No real money was charged.`);
        await refresh();
        return;
      }
      if (checkout.checkoutUrl) window.location.assign(checkout.checkoutUrl);
    } catch (err: any) {
      setActionError(err.message || 'Could not start payment.');
    } finally {
      setBusyPackage(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-6">
      <section className="rounded-[2rem] hexa-brand-panel text-white p-6 md:p-8 shadow-xl overflow-hidden relative">
        <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-[var(--hexa-red)]/20 blur-3xl" />
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Test access</p>
            <h1 className="mt-2 text-3xl font-black">Buy speaking credits</h1>
            <p className="mt-2 max-w-xl text-sm text-white/70">Credits are attached to your account. Different practice types can cost different amounts, and the server checks the required balance before launch.</p>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/10 px-5 py-4 min-w-[220px]">
            <span className="text-[10px] uppercase tracking-widest text-white/55 font-bold">Current access</span>
            <strong className="mt-1 block text-xl font-black">{accessLabel}</strong>
          </div>
        </div>
      </section>

      {(message || error || actionError) && (
        <div className={`rounded-2xl border px-5 py-4 text-sm ${actionError || error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {actionError || error || message}
        </div>
      )}

      <section className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hexa-red)]">Packages</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">Choose your access</h2>
            </div>
            <button onClick={() => void refresh()} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50" title="Refresh billing status">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {packages.map((pkg) => (
              <article key={pkg.id} className="rounded-2xl border border-slate-200 p-5 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-xl bg-[var(--hexa-soft-blue)] p-2.5 text-[var(--hexa-navy)]">
                    {pkg.accessType === 'unlimited' ? <Infinity size={20} /> : <Sparkles size={20} />}
                  </span>
                  <strong className="text-xl font-black text-slate-950">{taka(pkg.priceBdt)}</strong>
                </div>
                <h3 className="mt-4 text-base font-black text-slate-950">{pkg.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 flex-1">{pkg.description}</p>
                <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                  {pkg.accessType === 'unlimited' ? `Unlimited for ${pkg.unlimitedDays || 30} days` : `${pkg.tests} credit${pkg.tests === 1 ? '' : 's'}`}
                </div>
                <button
                  onClick={() => void buy(pkg)}
                  disabled={busyPackage != null}
                  className="mt-4 hexa-primary-btn rounded-xl py-3 px-4 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busyPackage === pkg.id ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                  {provider === 'development' ? 'Test purchase flow' : 'Pay securely'}
                </button>
              </article>
            ))}
            {!loading && packages.length === 0 && <p className="text-sm text-slate-500">No active packages are available yet.</p>}
          </div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><Smartphone size={18} className="text-[var(--hexa-red)]" /><h2 className="text-sm font-black">Checkout details</h2></div>
            <label className="mt-4 block text-[10px] font-black uppercase tracking-wider text-slate-400">Name</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--hexa-navy)]" />
            <label className="mt-3 block text-[10px] font-black uppercase tracking-wider text-slate-400">Phone</label>
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="01XXXXXXXXX" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--hexa-navy)]" />
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              {provider === 'development' ? 'Development payment mode is active. It simulates a verified payment and does not charge money.' : 'The configured hosted gateway will show the payment methods enabled for your merchant account.'}
            </p>
          </section>
          <section className="rounded-3xl border border-[rgba(47,51,127,.15)] bg-[var(--hexa-soft-blue)] p-5">
            <div className="flex items-center gap-2 text-[var(--hexa-navy)]"><ShieldCheck size={18} /><h2 className="text-sm font-black">Protected credits</h2></div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">The required credits for that practice type are reserved when a session is created and consumed only after the live examiner connects. If startup fails, the full reserved amount is returned automatically.</p>
          </section>
        </aside>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
        <h2 className="text-base font-black text-slate-950">Recent purchases</h2>
        <div className="mt-4 divide-y divide-slate-100">
          {orders.map((order) => (
            <div key={order.id} className="py-3 flex items-center justify-between gap-4 text-xs">
              <div><strong className="text-slate-800">{order.packageSnapshot?.name || order.packageId}</strong><p className="mt-1 text-slate-400 font-mono">{order.id}</p></div>
              <div className="text-right"><strong>{taka(order.amountBdt)}</strong><p className="mt-1 capitalize text-slate-500">{order.status}</p></div>
            </div>
          ))}
          {!orders.length && <div className="py-6 text-center text-xs text-slate-400">No purchases yet.</div>}
        </div>
      </section>
    </div>
  );
};
