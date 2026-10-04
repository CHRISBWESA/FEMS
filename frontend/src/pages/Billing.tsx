import { useEffect, useState } from 'react';
import axios from 'axios';
import { Bar, Empty, Spinner, errMsg } from '../components/finance/common';

const LIMIT_LABELS: Record<string, string> = { max_users: 'User accounts', max_members: 'Members', max_storage_mb: 'Document storage (MB)' };
const MODULE_LABELS: Record<string, string> = { finance: 'Finance & contributions', youth: 'Youth & children', resources: 'Resources & assets', volunteers: 'Volunteers & service', analytics: 'Analytics', member_engagement: 'Member engagement' };
const badge = (s: string) => (s === 'active' || s === 'paid' ? 'status-active' : s === 'trialing' || s === 'open' ? 'status-submitted' : s === 'past_due' ? 'status-draft' : 'status-rejected');

// The fellowship's own view of its FEMS subscription (plan, status, usage, invoices and receipts).
// This is what the fellowship pays FEMS - unrelated to the fellowship's own Finance screens - and it is read-only:
// plan changes are made by the platform administrator.
export default function Billing() {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/billing/subscription', { withCredentials: true }).then((r) => setD(r.data)).catch((e) => setError(errMsg(e, 'Could not load billing information'))); }, []);
  if (error) return <div className="mx-auto max-w-4xl"><Empty text={error} /></div>;
  if (!d) return <Spinner />;
  const s = d.subscription;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="page-header">
        <div><h1 className="page-title">Billing &amp; plan</h1><p className="page-desc">Your fellowship's FEMS subscription. This is separate from the fellowship's own Finance records.</p></div>
      </div>
      {!s ? <Empty text="Your fellowship is not on a paid plan. Nothing is limited." /> : (
        <>
          <div className="card mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xl font-semibold text-ink">{s.plan.name}</p><p className="text-sm text-ink-muted">{s.plan.price} {s.plan.currency} / {s.plan.billingInterval}</p></div>
              <span className={`status-badge ${badge(s.status)} capitalize`}>{s.status.replace('_', ' ')}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {s.trialEndsAt && <div><dt className="text-xs uppercase text-ink-subtle">Trial ends</dt><dd>{new Date(s.trialEndsAt).toLocaleDateString()}</dd></div>}
              {s.currentPeriodEnd && <div><dt className="text-xs uppercase text-ink-subtle">Paid until</dt><dd>{new Date(s.currentPeriodEnd).toLocaleDateString()}</dd></div>}
              {s.cancelAtPeriodEnd && <div><dt className="text-xs uppercase text-ink-subtle">Cancels</dt><dd className="text-amber-700">At the end of the paid period</dd></div>}
            </dl>
            {['cancelled', 'expired'].includes(s.status) && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">This subscription is {s.status}. You can still sign in and use core features, but optional modules are switched off and nothing new can be added until it is reactivated. Please contact your platform administrator.</p>}
            {s.status === 'past_due' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">A payment is overdue. Please settle the open invoice below to avoid interruption.</p>}
          </div>

          <div className="card mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Included modules</h2>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">{Object.keys(MODULE_LABELS).map((k) => <li key={k} className={s.plan.modules.includes(k) ? 'text-ink' : 'text-ink-subtle line-through'}>{MODULE_LABELS[k]}</li>)}</ul>
          </div>

          <div className="card mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Usage</h2>
            <div className="space-y-2">{Object.entries(d.usage).map(([k, v]: [string, any]) => (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="w-44 text-ink">{LIMIT_LABELS[k] || k}</span>
                {v.limit ? <Bar value={v.used} max={v.limit} className={v.used >= v.limit ? 'bg-rose-500' : 'bg-primary'} /> : <span className="flex-1 text-xs text-ink-subtle">no limit</span>}
                <span className="w-20 text-right font-medium">{v.used}{v.limit ? ` / ${v.limit}` : ''}</span>
              </div>
            ))}</div>
          </div>
        </>
      )}
      {d.invoices.length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Invoices &amp; receipts</h2>
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Invoice</th><th>Period</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{d.invoices.map((i: any) => (
              <tr key={i.id}><td className="font-mono text-xs">{i.number}</td><td>{new Date(i.periodStart).toLocaleDateString()} – {new Date(i.periodEnd).toLocaleDateString()}</td><td>{i.amount} {i.currency}</td><td>{new Date(i.dueAt).toLocaleDateString()}</td>
                <td><span className={`status-badge ${badge(i.status)} capitalize`}>{i.status}</span>{i.receipt && <span className="ml-2 text-xs text-ink-muted">Receipt {i.receipt.number} · {new Date(i.receipt.paidAt).toLocaleDateString()}</span>}</td></tr>
            ))}</tbody></table></div>
        </div>
      )}
    </div>
  );
}
