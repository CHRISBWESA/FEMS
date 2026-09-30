import { useEffect, useState } from 'react';
import axios from 'axios';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../App';
import { ErrorBox, Empty, Modal, Spinner, errMsg, isoDay, money } from './common';

const FREQ = ['one_time', 'weekly', 'monthly', 'quarterly', 'yearly'];

// Pledges are commitments. They never record money by themselves; fulfilment compares the commitment
// with the contributions that have actually been recorded.
export default function FinancePledgesTab() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('finance.pledge_manage');
  const [rows, setRows] = useState<any[] | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [fulfil, setFulfil] = useState<Record<string, any>>({});
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ memberId: '', amount: '', frequency: 'monthly', startDate: isoDay(), campaignId: '' });
  const [error, setError] = useState('');

  const load = () => axios.get('/finance/pledges', { withCredentials: true }).then((r) => setRows(r.data)).catch((e) => { setError(errMsg(e, 'Could not load pledges')); setRows([]); });
  useEffect(() => {
    load();
    if (canManage) {
      axios.get('/members?limit=100&status=active', { withCredentials: true }).then((r) => setMembers(r.data.data || [])).catch(() => {});
      axios.get('/finance/campaigns?status=active', { withCredentials: true }).then((r) => setCampaigns(r.data)).catch(() => {});
    }
  }, []);

  const showFulfilment = async (id: string) => {
    try { const r = await axios.get(`/finance/pledges/${id}/fulfillment`, { withCredentials: true }); setFulfil((f) => ({ ...f, [id]: r.data })); }
    catch (e: any) { alert(errMsg(e, 'Failed')); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await axios.post('/finance/pledges', { ...form, amount: Number(form.amount), campaignId: form.campaignId || undefined }, { withCredentials: true });
      setShow(false);
      load();
    } catch (err: any) { setError(errMsg(err, 'Failed to save pledge')); }
  };

  if (!rows) return <Spinner />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">Recurring commitments. Recording a contribution is always a separate, deliberate action.</p>
        {canManage && <button onClick={() => { setError(''); setShow(true); }} className="btn btn-primary"><PlusIcon className="h-4 w-4" /> New Pledge</button>}
      </div>
      <ErrorBox text={show ? '' : error} />
      {rows.length === 0 ? <Empty text="No pledges yet" /> : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Member</th><th>Commitment</th><th>Campaign</th><th>Status</th><th>Fulfilment</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const f = fulfil[p.id];
                return (
                  <tr key={p.id}>
                    <td className="font-medium text-slate-900">{p.member?.full_name}</td>
                    <td>{money(p.amount)} <span className="text-slate-500">{p.frequency.replace('_', ' ')}</span></td>
                    <td>{p.campaign?.name || '—'}</td>
                    <td><span className={`status-badge ${p.is_active ? 'status-active' : 'status-inactive'}`}>{p.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      {f ? (
                        <span className="text-sm">{money(f.receivedAmount)} of {money(f.expectedAmount)} <span className={Number(f.balance) > 0 ? 'text-amber-700' : 'text-emerald-700'}>({Number(f.balance) > 0 ? `${money(f.balance)} behind` : 'up to date'})</span></span>
                      ) : (
                        <button onClick={() => showFulfilment(p.id)} className="btn btn-secondary btn-sm">Check</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {show && (
        <Modal title="New pledge" onClose={() => setShow(false)}>
          <form onSubmit={create} className="space-y-4">
            <ErrorBox text={error} />
            <div><label className="label">Member *</label>
              <select required className="select" value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
                <option value="">Select member…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Amount *</label><input type="number" min="0" step="0.01" required className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div><label className="label">Frequency *</label>
                <select className="select" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>{FREQ.map((f) => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Starts *</label><input type="date" required className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><label className="label">Campaign</label>
                <select className="select" value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>
                  <option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            </div>
            <div className="flex gap-2"><button className="btn btn-primary flex-1" type="submit">Save</button><button type="button" onClick={() => setShow(false)} className="btn btn-secondary flex-1">Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
