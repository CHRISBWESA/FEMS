import { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../App';
import FormModal from '../resources/FormModal';
import { Bar, Empty, Spinner, errMsg } from '../finance/common';

const LIMIT_LABELS: Record<string, string> = { max_users: 'User accounts', max_members: 'Members', max_storage_mb: 'Document storage (MB)' };
const badge = (s: string) => (s === 'active' || s === 'paid' ? 'status-active' : s === 'trialing' || s === 'open' ? 'status-submitted' : s === 'past_due' ? 'status-draft' : 'status-rejected');
type Dialog = null | 'assign' | 'change' | 'cancel' | 'reactivate' | 'invoice' | { pay: any } | { void: any };

// SaaS subscription of one fellowship (platform billing - not the fellowship's own Finance).
export default function SubscriptionCard({ fellowshipId }: { fellowshipId: string }) {
  const { hasPermission } = useAuth();
  const manage = hasPermission('platform.billing_manage');
  const [d, setD] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const load = () => axios.get(`/platform/billing/subscriptions/${fellowshipId}`, { withCredentials: true }).then((r) => { setD(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load the subscription')));
  useEffect(() => { load(); axios.get('/platform/billing/plans', { withCredentials: true }).then((r) => setPlans(r.data)).catch(() => {}); }, [fellowshipId]);
  if (error) return <Empty text={error} />;
  if (!d) return <Spinner />;
  const s = d.subscription;
  const base = `/platform/billing/subscriptions/${fellowshipId}`;
  const planOpts = (excludeId?: string) => plans.filter((p) => p.isActive && p.id !== excludeId).map((p) => ({ value: p.id, label: `${p.name} – ${p.price} ${p.currency}/${p.billingInterval}` }));

  return (
    <div className="card mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Subscription</h2>
          {s ? <p className="mt-1 text-lg font-semibold text-ink">{s.plan.name} <span className="text-sm font-normal text-ink-muted">{s.plan.price} {s.plan.currency} / {s.plan.billingInterval}</span></p>
            : <p className="mt-1 text-sm text-ink-muted">No subscription. This fellowship is not under plan limits.</p>}
        </div>
        {s && <span className={`status-badge ${badge(s.status)} capitalize`}>{s.status.replace('_', ' ')}</span>}
      </div>

      {s && (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {s.trialEndsAt && <div><dt className="text-xs uppercase text-ink-subtle">Trial ends</dt><dd>{new Date(s.trialEndsAt).toLocaleDateString()}</dd></div>}
          {s.currentPeriodEnd && <div><dt className="text-xs uppercase text-ink-subtle">Paid until</dt><dd>{new Date(s.currentPeriodEnd).toLocaleDateString()}</dd></div>}
          {s.cancelAtPeriodEnd && <div><dt className="text-xs uppercase text-ink-subtle">Cancels</dt><dd className="text-amber-700">At period end</dd></div>}
          {s.pastDueSince && <div><dt className="text-xs uppercase text-ink-subtle">Overdue since</dt><dd className="text-rose-700">{new Date(s.pastDueSince).toLocaleDateString()}</dd></div>}
        </dl>
      )}

      <div className="mt-4 space-y-2">
        {Object.entries(d.usage).map(([k, v]: [string, any]) => {
          const used = typeof v === 'number' ? v : v.used;
          const limit = typeof v === 'number' ? null : v.limit;
          return (
            <div key={k} className="flex items-center gap-3 text-sm">
              <span className="w-44 text-ink">{LIMIT_LABELS[k] || k}</span>
              {limit ? <Bar value={used} max={limit} className={used >= limit ? 'bg-rose-500' : 'bg-primary'} /> : <span className="flex-1 text-xs text-ink-subtle">no limit</span>}
              <span className="w-20 text-right font-medium">{used}{limit ? ` / ${limit}` : ''}</span>
            </div>
          );
        })}
      </div>

      {manage && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
          {!s && <button className="btn btn-primary btn-sm" onClick={() => setDialog('assign')}>Assign plan</button>}
          {s && ['trialing', 'active', 'past_due'].includes(s.status) && <button className="btn btn-secondary btn-sm" onClick={() => setDialog('change')}>Change plan</button>}
          {s && ['trialing', 'active', 'past_due', 'expired'].includes(s.status) && <button className="btn btn-secondary btn-sm" onClick={() => setDialog('invoice')}>Issue invoice</button>}
          {s && ['trialing', 'active', 'past_due'].includes(s.status) && <button className="btn btn-danger btn-sm" onClick={() => setDialog('cancel')}>Cancel</button>}
          {s && ['cancelled', 'expired'].includes(s.status) && <button className="btn btn-primary btn-sm" onClick={() => setDialog('reactivate')}>Reactivate</button>}
        </div>
      )}

      {d.invoices.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Invoices</h3>
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Number</th><th>Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>{d.invoices.map((i: any) => (
              <tr key={i.id}><td className="font-mono text-xs">{i.number}</td><td>{i.amount} {i.currency}</td><td>{new Date(i.dueAt).toLocaleDateString()}</td>
                <td><span className={`status-badge ${badge(i.status)} capitalize`}>{i.status}</span>{i.receipt && <span className="ml-2 text-xs text-ink-subtle">{i.receipt.number}</span>}</td>
                <td className="space-x-2 text-right">{manage && i.status === 'open' && <><button className="btn btn-primary btn-sm" onClick={() => setDialog({ pay: i })}>Record payment</button><button className="btn btn-secondary btn-sm" onClick={() => setDialog({ void: i })}>Void</button></>}</td></tr>
            ))}</tbody></table></div>
        </div>
      )}

      {d.history.length > 0 && (
        <details className="mt-4 border-t border-hairline pt-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-subtle">History</summary>
          <ul className="mt-2 space-y-1 text-sm">{d.history.map((h: any) => <li key={h.id} className="flex justify-between gap-3"><span className="capitalize text-ink">{h.type.replace(/_/g, ' ')}{h.note && <span className="ml-2 text-xs text-ink-subtle">{h.note}</span>}</span><span className="text-xs text-ink-subtle">{new Date(h.at).toLocaleString()}</span></li>)}</ul>
        </details>
      )}

      {dialog === 'assign' && <FormModal title="Assign a plan" submitLabel="Assign" initial={{ startTrial: false }} fields={[{ name: 'planId', label: 'Plan', type: 'select', required: true, options: [{ value: '', label: 'Select…' }, ...planOpts()] }, { name: 'startTrial', label: 'Start with the plan\'s free trial', type: 'checkbox' }]} onSubmit={async (v) => { await axios.post(`${base}/assign`, { planId: v.planId, startTrial: !!v.startTrial }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog === 'change' && <FormModal title="Change plan" description="Takes effect immediately. It is refused if the fellowship's current usage exceeds the new plan's limits." submitLabel="Change" fields={[{ name: 'planId', label: 'New plan', type: 'select', required: true, options: [{ value: '', label: 'Select…' }, ...planOpts(s?.plan.id)] }]} onSubmit={async (v) => { await axios.post(`${base}/change-plan`, { planId: v.planId }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <FormModal title="Cancel subscription" submitLabel="Cancel subscription" description="Optional modules switch off once the subscription ends; the fellowship can still sign in and keeps its data." fields={[{ name: 'reason', label: 'Reason (recorded)', type: 'textarea', required: true }, { name: 'immediately', label: 'End it now instead of at the end of the paid period', type: 'checkbox' }]} onSubmit={async (v) => { await axios.post(`${base}/cancel`, { reason: v.reason, immediately: !!v.immediately }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog === 'reactivate' && <FormModal title="Reactivate subscription" submitLabel="Reactivate" description="Use after payment has been arranged. Starts a new paid period." fields={[{ name: 'reason', label: 'Reason (recorded)', type: 'textarea', required: true }, { name: 'planId', label: 'Plan', type: 'select', options: [{ value: '', label: 'Keep current plan' }, ...planOpts(s?.plan.id)] }]} onSubmit={async (v) => { await axios.post(`${base}/reactivate`, { reason: v.reason, planId: v.planId || undefined }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog === 'invoice' && <FormModal title="Issue invoice" submitLabel="Issue" description="Bills the next period at the plan's current price. Payment is recorded manually (no payment provider is connected)." initial={{ dueInDays: 14 }} fields={[{ name: 'dueInDays', label: 'Due in (days)', type: 'number', min: 0 }]} onSubmit={async (v) => { await axios.post(`${base}/invoices`, { dueInDays: Number(v.dueInDays) }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'pay' in dialog && <FormModal title={`Record payment – ${dialog.pay.number}`} submitLabel="Record payment" description={`Confirms that ${dialog.pay.amount} ${dialog.pay.currency} was received outside FEMS.`} fields={[{ name: 'reference', label: 'Payment reference', required: true }, { name: 'method', label: 'Method (e.g. bank transfer)' }]} onSubmit={async (v) => { await axios.post(`/platform/billing/invoices/${dialog.pay.id}/mark-paid`, { reference: v.reference, method: v.method || undefined }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'void' in dialog && <FormModal title={`Void ${dialog.void.number}`} submitLabel="Void invoice" fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true }]} onSubmit={async (v) => { await axios.post(`/platform/billing/invoices/${dialog.void.id}/void`, { reason: v.reason }, { withCredentials: true }); load(); }} onClose={() => setDialog(null)} />}
    </div>
  );
}
