import { useEffect, useState } from 'react';
import axios from 'axios';
import { LockClosedIcon, LockOpenIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../App';
import { ErrorBox, Empty, Modal, Spinner, errMsg } from './common';

// A closed period rejects new, edited or deleted records dated inside it.
export default function FinancePeriodsTab() {
  const { hasPermission, hasRole } = useAuth();
  const canManage = hasPermission('finance.period_manage');
  const canReopen = hasRole('secretary') || hasRole('chairperson') || hasRole('assistant_chairperson');
  const [rows, setRows] = useState<any[] | null>(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [error, setError] = useState('');

  const load = () => axios.get('/finance/periods', { withCredentials: true }).then((r) => setRows(r.data)).catch((e) => { setError(errMsg(e, 'Could not load periods')); setRows([]); });
  useEffect(() => { load(); }, []);

  const close = async (p: any) => {
    if (!window.confirm(`Close "${p.name}"? Records dated inside it can no longer be added, edited or deleted.`)) return;
    try { await axios.post(`/finance/periods/${p.id}/close`, {}, { withCredentials: true }); load(); } catch (e: any) { alert(errMsg(e, 'Failed')); }
  };
  const reopen = async (p: any) => {
    const reason = window.prompt(`Reason for re-opening "${p.name}" (recorded in the audit trail):`);
    if (!reason) return;
    try { await axios.post(`/finance/periods/${p.id}/reopen`, { reason }, { withCredentials: true }); load(); } catch (e: any) { alert(errMsg(e, 'Failed')); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try { await axios.post('/finance/periods', form, { withCredentials: true }); setShow(false); load(); } catch (err: any) { setError(errMsg(err, 'Failed to create period')); }
  };

  if (!rows) return <Spinner />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-muted">Close a period once its books are reconciled.</p>
        {canManage && <button onClick={() => { setError(''); setShow(true); }} className="btn btn-primary"><PlusIcon className="h-4 w-4" /> New Period</button>}
      </div>
      <ErrorBox text={show ? '' : error} />
      {rows.length === 0 ? <Empty text="No financial periods defined" /> : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>From</th><th>To</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium text-ink">{p.name}</td>
                  <td>{new Date(p.start_date).toLocaleDateString()}</td>
                  <td>{new Date(p.end_date).toLocaleDateString()}</td>
                  <td><span className={`status-badge ${p.is_closed ? 'status-inactive' : 'status-active'}`}>{p.is_closed ? 'Closed' : 'Open'}</span></td>
                  <td>
                    {!p.is_closed && canManage && <button onClick={() => close(p)} className="btn btn-secondary btn-sm"><LockClosedIcon className="h-3.5 w-3.5" /> Close</button>}
                    {p.is_closed && canReopen && <button onClick={() => reopen(p)} className="btn btn-secondary btn-sm"><LockOpenIcon className="h-3.5 w-3.5" /> Re-open</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {show && (
        <Modal title="New financial period" onClose={() => setShow(false)}>
          <form onSubmit={create} className="space-y-4">
            <ErrorBox text={error} />
            <div><label className="label">Name *</label><input required className="input" placeholder="e.g. FY2026 Q1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">From *</label><input type="date" required className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><label className="label">To *</label><input type="date" required className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
            </div>
            <div className="flex gap-2"><button className="btn btn-primary flex-1" type="submit">Create</button><button type="button" onClick={() => setShow(false)} className="btn btn-secondary flex-1">Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
