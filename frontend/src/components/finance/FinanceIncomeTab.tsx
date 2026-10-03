import { useEffect, useState } from 'react';
import axios from 'axios';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../App';
import { ErrorBox, Empty, Modal, Spinner, errMsg, isoDay, money } from './common';

// Income that is not a member contribution (grants, fundraising proceeds, outside donations).
export default function FinanceIncomeTab() {
  const { hasPermission } = useAuth();
  const canRecord = hasPermission('finance.income_record');
  const [rows, setRows] = useState<any[] | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ title: '', amount: '', date: isoDay(), source: '', categoryId: '', campaignId: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => axios.get('/finance/income', { withCredentials: true }).then((r) => setRows(r.data)).catch((e) => { setError(errMsg(e, 'Could not load income')); setRows([]); });
  useEffect(() => {
    load();
    axios.get('/finance/categories?kind=income', { withCredentials: true }).then((r) => setCategories(r.data.filter((c: any) => c.is_active))).catch(() => {});
    axios.get('/finance/campaigns?status=active', { withCredentials: true }).then((r) => setCampaigns(r.data)).catch(() => {});
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.post('/finance/income', {
        title: form.title, amount: Number(form.amount), date: form.date, source: form.source || undefined,
        categoryId: form.categoryId || undefined, campaignId: form.campaignId || undefined,
      }, { withCredentials: true });
      setShow(false);
      load();
    } catch (err: any) {
      setError(errMsg(err, 'Failed to record income'));
    } finally {
      setSaving(false);
    }
  };

  if (!rows) return <Spinner />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-muted">Money received that is not a member contribution.</p>
        {canRecord && <button onClick={() => { setError(''); setShow(true); }} className="btn btn-primary"><PlusIcon className="h-4 w-4" /> New Income</button>}
      </div>
      <ErrorBox text={show ? '' : error} />
      {rows.length === 0 ? <Empty text="No income recorded yet" /> : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Title</th><th>Amount</th><th>Date</th><th>Category</th><th>Campaign</th><th>Source</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-ink">{r.title}</td>
                  <td>{money(r.amount)}</td>
                  <td>{new Date(r.date).toLocaleDateString()}</td>
                  <td>{r.category?.name || '—'}</td>
                  <td>{r.campaign?.name || '—'}</td>
                  <td>{r.source || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {show && (
        <Modal title="New income" onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-4">
            <ErrorBox text={error} />
            <div><label className="label">Title *</label><input required className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Amount *</label><input type="number" min="0" step="0.01" required className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div><label className="label">Date *</label><input type="date" required max={isoDay()} className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            </div>
            <div><label className="label">Source</label><input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Category</label>
                <select className="select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="label">Campaign</label>
                <select className="select" value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>
                  <option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">{saving ? <span className="spinner border-white" /> : 'Save'}</button>
              <button type="button" onClick={() => setShow(false)} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
