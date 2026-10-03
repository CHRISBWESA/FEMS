import { useEffect, useState } from 'react';
import axios from 'axios';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../App';
import { Bar, ErrorBox, Empty, Modal, Spinner, errMsg, isoDay, money } from './common';

const KINDS = ['contribution', 'income', 'expense'];

// Campaigns (with live progress) and the shared category list used to classify records.
export default function FinanceCampaignsTab() {
  const { hasPermission } = useAuth();
  const canCampaign = hasPermission('finance.campaign_manage');
  const canCategory = hasPermission('finance.category_manage');
  const [campaigns, setCampaigns] = useState<any[] | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const [cForm, setCForm] = useState<any>({ name: '', description: '', targetAmount: '', startDate: isoDay(), endDate: '' });
  const [catForm, setCatForm] = useState<any>({ kind: 'contribution', name: '' });
  const [error, setError] = useState('');

  const load = () => {
    axios.get('/finance/campaigns', { withCredentials: true }).then((r) => setCampaigns(r.data)).catch((e) => { setError(errMsg(e, 'Could not load campaigns')); setCampaigns([]); });
    axios.get('/finance/categories', { withCredentials: true }).then((r) => setCategories(r.data)).catch(() => {});
  };
  useEffect(load, []);

  const submit = async (fn: () => Promise<any>, close: () => void) => {
    setError('');
    try { await fn(); close(); load(); } catch (e: any) { setError(errMsg(e, 'Save failed')); }
  };

  const toggleCampaign = (c: any) =>
    axios.put(`/finance/campaigns/${c.id}`, { status: c.status === 'active' ? 'closed' : 'active' }, { withCredentials: true })
      .then(load).catch((e) => alert(errMsg(e, 'Failed')));

  const toggleCategory = (c: any) =>
    axios.put(`/finance/categories/${c.id}`, { isActive: !c.is_active }, { withCredentials: true })
      .then(load).catch((e) => alert(errMsg(e, 'Failed')));

  if (!campaigns) return <Spinner />;
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Contribution campaigns</h2>
          {canCampaign && <button onClick={() => { setError(''); setShowCampaign(true); }} className="btn btn-primary"><PlusIcon className="h-4 w-4" /> New Campaign</button>}
        </div>
        <ErrorBox text={showCampaign || showCategory ? '' : error} />
        {campaigns.length === 0 ? <Empty text="No campaigns yet" /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {campaigns.map((c) => (
              <div key={c.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-ink">{c.name}</h3>
                    <p className="text-xs text-ink-muted">{new Date(c.start_date).toLocaleDateString()}{c.end_date ? ` – ${new Date(c.end_date).toLocaleDateString()}` : ''}</p>
                  </div>
                  <span className={`status-badge ${c.status === 'active' ? 'status-active' : 'status-inactive'}`}>{c.status}</span>
                </div>
                <p className="mt-3 text-2xl font-semibold text-ink">{money(c.progress.raised)}
                  {c.target_amount && <span className="ml-2 text-sm font-normal text-ink-muted">of {money(c.target_amount)}</span>}</p>
                {c.progress.percentOfTarget !== null && (
                  <div className="mt-2 flex items-center gap-2"><Bar value={c.progress.percentOfTarget} max={100} className="bg-emerald-500" /><span className="text-xs text-ink-muted">{c.progress.percentOfTarget}%</span></div>
                )}
                <p className="mt-2 text-xs text-ink-muted">{c.progress.contributorCount} contributor(s) · {c.progress.contributionCount} contribution(s)</p>
                {canCampaign && (
                  <button onClick={() => toggleCampaign(c)} className="btn btn-secondary btn-sm mt-3">{c.status === 'active' ? 'Close campaign' : 'Reopen campaign'}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Categories</h2>
          {canCategory && <button onClick={() => { setError(''); setShowCategory(true); }} className="btn btn-secondary"><PlusIcon className="h-4 w-4" /> New Category</button>}
        </div>
        {categories.length === 0 ? <Empty text="No categories yet" /> : (
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead><tr><th>Name</th><th>Kind</th><th>Status</th>{canCategory && <th />}</tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-ink">{c.name}</td>
                    <td className="capitalize">{c.kind}</td>
                    <td><span className={`status-badge ${c.is_active ? 'status-active' : 'status-inactive'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                    {canCategory && <td><button onClick={() => toggleCategory(c)} className="btn btn-secondary btn-sm">{c.is_active ? 'Deactivate' : 'Activate'}</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCampaign && (
        <Modal title="New campaign" onClose={() => setShowCampaign(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => axios.post('/finance/campaigns', {
            name: cForm.name, description: cForm.description || undefined,
            targetAmount: cForm.targetAmount ? Number(cForm.targetAmount) : undefined,
            startDate: cForm.startDate, endDate: cForm.endDate || undefined,
          }, { withCredentials: true }), () => setShowCampaign(false)); }}>
            <ErrorBox text={error} />
            <div><label className="label">Name *</label><input required className="input" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} /></div>
            <div><label className="label">Description</label><textarea rows={2} className="input" value={cForm.description} onChange={(e) => setCForm({ ...cForm, description: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Target</label><input type="number" min="0" step="0.01" className="input" value={cForm.targetAmount} onChange={(e) => setCForm({ ...cForm, targetAmount: e.target.value })} /></div>
              <div><label className="label">Start *</label><input type="date" required className="input" value={cForm.startDate} onChange={(e) => setCForm({ ...cForm, startDate: e.target.value })} /></div>
              <div><label className="label">End</label><input type="date" className="input" value={cForm.endDate} onChange={(e) => setCForm({ ...cForm, endDate: e.target.value })} /></div>
            </div>
            <div className="flex gap-2"><button className="btn btn-primary flex-1" type="submit">Create</button><button type="button" onClick={() => setShowCampaign(false)} className="btn btn-secondary flex-1">Cancel</button></div>
          </form>
        </Modal>
      )}
      {showCategory && (
        <Modal title="New category" onClose={() => setShowCategory(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => axios.post('/finance/categories', catForm, { withCredentials: true }), () => setShowCategory(false)); }}>
            <ErrorBox text={error} />
            <div><label className="label">Kind</label>
              <select className="select" value={catForm.kind} onChange={(e) => setCatForm({ ...catForm, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
            <div><label className="label">Name *</label><input required maxLength={80} className="input" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></div>
            <div className="flex gap-2"><button className="btn btn-primary flex-1" type="submit">Create</button><button type="button" onClick={() => setShowCategory(false)} className="btn btn-secondary flex-1">Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
