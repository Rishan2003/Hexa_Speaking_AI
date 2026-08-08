import React, { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, Infinity, Loader2, PackagePlus, RefreshCw, Save, Search, ShieldCheck, Users } from 'lucide-react';
import { BillingService } from '../services/billingService';
import { useBilling } from '../services/billingContext';
import { BillingSettings, TestPackage } from '../types';

const taka = (amount: number) => `৳${Number(amount || 0).toLocaleString('en-BD')}`;

export const AdminBillingView: React.FC = () => {
  const { isAdmin } = useBilling();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<Partial<BillingSettings>>({});
  const [newPackage, setNewPackage] = useState<Partial<TestPackage>>({ name: '', accessType: 'credits', tests: 1, priceBdt: 100, active: true, sortOrder: 100 });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await BillingService.getAdminOverview();
      setData(result);
      setSettings(result.settings || {});
    } catch (err: any) {
      setError(err.message || 'Could not load billing administration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin]);

  const users = useMemo(() => {
    const all = data?.users || [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item: any) => `${item.email} ${item.displayName} ${item.uid}`.toLowerCase().includes(q));
  }, [data, query]);

  const action = async (key: string, task: () => Promise<any>, success: string) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await task();
      setMessage(success);
      await load();
    } catch (err: any) {
      setError(err.message || 'Billing admin action failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) {
    return <div className="max-w-2xl mx-auto my-12 rounded-3xl border border-red-200 bg-red-50 p-8 text-center"><ShieldCheck className="mx-auto text-red-500" /><h1 className="mt-3 text-xl font-black">Administrator access required</h1><p className="mt-2 text-sm text-red-700">Billing controls are restricted to verified administrators.</p></div>;
  }

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--hexa-red)]">Administration</p><h1 className="mt-1 text-3xl font-black text-slate-950">Paid test controls</h1><p className="mt-1 text-sm text-slate-500">Manage signup freebies, packages, user credits, unlimited access and payment history.</p></div>
        <button onClick={() => void load()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black flex items-center gap-2"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/>Refresh</button>
      </div>

      {(error || message) && <div className={`rounded-2xl border px-5 py-4 text-sm ${error ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{error || message}</div>}

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2"><BadgeDollarSign size={19} className="text-[var(--hexa-navy)]"/><h2 className="font-black">Global access settings</h2></div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-bold text-slate-600">Free tests on signup<input type="number" min="0" value={settings.signupFreeTests ?? 0} onChange={(e)=>setSettings({...settings, signupFreeTests:Number(e.target.value)})} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5"/></label>
            <label className="text-xs font-bold text-slate-600">Default payment provider<select value={settings.activeProvider || 'development'} onChange={(e)=>setSettings({...settings, activeProvider:e.target.value as any})} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="development">Development</option><option value="sslcommerz">SSLCOMMERZ</option></select></label>
            <label className="text-xs font-bold text-slate-600">Development simulator<select value={settings.developmentPaymentsEnabled ? 'on':'off'} onChange={(e)=>setSettings({...settings, developmentPaymentsEnabled:e.target.value==='on'})} className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="on">Enabled</option><option value="off">Disabled</option></select></label>
          </div>
          <button onClick={()=>void action('settings',()=>BillingService.updateAdminSettings(settings),'Billing settings saved.')} disabled={busy==='settings'} className="mt-4 hexa-primary-btn rounded-xl px-4 py-2.5 text-xs font-black flex items-center gap-2">{busy==='settings'?<Loader2 size={14} className="animate-spin"/>:<Save size={14}/>}Save settings</button>
        </div>
        <div className="rounded-3xl border border-[rgba(47,51,127,.14)] bg-[var(--hexa-soft-blue)] p-5">
          <h2 className="text-sm font-black text-[var(--hexa-navy)]">Account creation behavior</h2><p className="mt-2 text-xs leading-relaxed text-slate-600">Changing the signup allowance affects new entitlement records. Existing balances are not rewritten. Use the user controls below when you want to gift credits to existing students.</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><PackagePlus size={19} className="text-[var(--hexa-red)]"/><h2 className="font-black">Test packages</h2></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {(data?.packages || []).map((pkg: TestPackage)=><div key={pkg.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex justify-between gap-2"><strong className="text-sm">{pkg.name}</strong><span className={`text-[9px] font-black uppercase ${pkg.active?'text-emerald-600':'text-slate-400'}`}>{pkg.active?'Active':'Hidden'}</span></div><p className="mt-2 text-xs text-slate-500">{pkg.accessType==='unlimited'?`Unlimited ${pkg.unlimitedDays} days`:`${pkg.tests} tests`}</p><strong className="mt-3 block text-lg">{taka(pkg.priceBdt)}</strong><button onClick={()=>void action(`toggle-${pkg.id}`,()=>BillingService.savePackage({...pkg,active:!pkg.active}),`${pkg.name} updated.`)} className="mt-3 text-xs font-black text-[var(--hexa-navy)]">{pkg.active?'Hide package':'Activate package'}</button></div>)}
        </div>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input placeholder="Package name" value={newPackage.name || ''} onChange={(e)=>setNewPackage({...newPackage,name:e.target.value})} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs lg:col-span-2"/>
          <select value={newPackage.accessType || 'credits'} onChange={(e)=>setNewPackage({...newPackage,accessType:e.target.value as any})} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs"><option value="credits">Credits</option><option value="unlimited">Unlimited</option></select>
          <input type="number" min="1" placeholder={newPackage.accessType==='unlimited'?'Days':'Tests'} value={newPackage.accessType==='unlimited'?(newPackage.unlimitedDays || 30):(newPackage.tests || 1)} onChange={(e)=>newPackage.accessType==='unlimited'?setNewPackage({...newPackage,unlimitedDays:Number(e.target.value)}):setNewPackage({...newPackage,tests:Number(e.target.value)})} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs"/>
          <input type="number" min="0" placeholder="Price BDT" value={newPackage.priceBdt || 0} onChange={(e)=>setNewPackage({...newPackage,priceBdt:Number(e.target.value)})} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs"/>
          <button onClick={()=>void action('new-package',()=>BillingService.savePackage(newPackage as any),'Package saved.')} className="hexa-primary-btn rounded-xl px-3 py-2.5 text-xs font-black">Save package</button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div className="flex items-center gap-2"><Users size={19} className="text-[var(--hexa-navy)]"/><h2 className="font-black">Student access</h2></div><div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search email or name" className="rounded-xl border border-slate-200 pl-9 pr-3 py-2.5 text-xs"/></div></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[780px] text-xs"><thead><tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-400"><th className="py-3">User</th><th>Balance</th><th>Access</th><th>Grant</th><th>Set balance</th><th>Unlimited</th></tr></thead><tbody>{users.map((item:any)=>{const ent=item.entitlement||{};const unlimited=ent.unlimited && (!ent.unlimitedUntil||ent.unlimitedUntil>Date.now());return <tr key={item.uid} className="border-b border-slate-50"><td className="py-3 pr-4"><strong className="block text-slate-800">{item.displayName||'Student'}</strong><span className="text-slate-400">{item.email}</span></td><td className="font-black">{ent.creditBalance ?? 0}</td><td>{unlimited?<span className="inline-flex items-center gap-1 text-[var(--hexa-navy)] font-black"><Infinity size={13}/>Unlimited</span>:<span className="text-slate-500">Credits</span>}</td><td><div className="flex gap-1"><button onClick={()=>void action(`g1-${item.uid}`,()=>BillingService.grantCredits(item.uid,1),'1 free test granted.')} className="rounded-lg bg-slate-100 px-2 py-1.5 font-black">+1</button><button onClick={()=>void action(`g5-${item.uid}`,()=>BillingService.grantCredits(item.uid,5),'5 free tests granted.')} className="rounded-lg bg-slate-100 px-2 py-1.5 font-black">+5</button></div></td><td><form onSubmit={(e)=>{e.preventDefault();const input=(e.currentTarget.elements.namedItem('balance') as HTMLInputElement);void action(`set-${item.uid}`,()=>BillingService.setBalance(item.uid,Number(input.value)),'Balance updated.')}} className="flex gap-1"><input name="balance" type="number" min="0" defaultValue={ent.creditBalance||0} className="w-16 rounded-lg border border-slate-200 px-2 py-1.5"/><button className="rounded-lg bg-slate-900 text-white px-2 py-1.5 font-black">Set</button></form></td><td><button onClick={()=>void action(`unlimited-${item.uid}`,()=>BillingService.setUnlimited(item.uid,!unlimited,null),unlimited?'Unlimited disabled.':'Unlimited enabled.')} className={`rounded-lg px-2.5 py-1.5 font-black ${unlimited?'bg-red-50 text-red-700':'bg-[var(--hexa-soft-blue)] text-[var(--hexa-navy)]'}`}>{unlimited?'Disable':'Enable'}</button></td></tr>})}</tbody></table></div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">Recent payment orders</h2><div className="mt-3 divide-y divide-slate-100">{(data?.orders||[]).slice(0,20).map((order:any)=><div key={order.id} className="py-3 flex justify-between gap-4 text-xs"><div><strong>{order.packageSnapshot?.name||order.packageId}</strong><p className="mt-1 font-mono text-slate-400">{order.id}</p></div><div className="text-right"><strong>{taka(order.amountBdt)}</strong><p className="mt-1 capitalize text-slate-500">{order.provider} · {order.status}</p></div></div>)}</div></section>
    </div>
  );
};
