import { useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Button, Checkbox, Field, Input, PageHeader, Select, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { errMsg, fmtDate, fmtMoney, FormModal, label, Status, useLoad } from '../fin/common';
import { canManageScope, invQuery, useInv } from './InventoryArea';
import { conditionOptions, RegisterModal } from './Register';

export function Maintenance() {
  const s = useInv();
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const list = useLoad<any[]>(`/inventory/maintenance?${invQuery(s)}${status ? `&status=${status}` : ''}`, [s.departmentId, status]);
  const [review, setReview] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const manage = canManageScope(s);
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.push('success', ok); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not complete that.')); } };
  return (
    <div className="space-y-4">
      <PageHeader title={t('inv.nav.maintenance')} description="Reported problems, approved repairs and their history. A repair's cost goes to Finance as one expense and follows Finance's approval rules." />
      <Select className="w-52" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, ...['reported', 'approved', 'in_progress', 'completed', 'cancelled'].map((v) => ({ value: v, label: label(v) }))]} />
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No maintenance', description: 'Report a problem from a resource\'s page.' }}
        columns={[
          { key: 'a', header: 'Resource', render: (r: any) => <Link className="text-primary hover:underline" to={`${s.base}/assets/${r.asset.id}`}>{r.asset.asset_tag} · {r.asset.name}</Link>, priority: 'primary' },
          { key: 'd', header: 'Reported', render: (r: any) => fmtDate(r.created_at) },
          { key: 'i', header: 'Issue', render: (r: any) => r.description },
          { key: 't', header: 'Technician', render: (r: any) => r.technician ?? '—', priority: 'meta' },
          { key: 'c', header: 'Cost', align: 'right', render: (r: any) => (r.cost ? fmtMoney(r.cost) : r.estimated_cost ? `~${fmtMoney(r.estimated_cost)}` : '—') },
          { key: 'e', header: 'Finance', render: (r: any) => (r.expense_id ? 'Expense linked' : '—'), priority: 'meta' },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]}
        rowActions={(r: any) => (manage ? (
          <span className="inline-flex gap-1">
            {['reported', 'pending_review'].includes(r.status) && <Button size="sm" variant="primary" onClick={() => { setReview(r); setF({ decision: 'approved', technician: '', estimatedCost: r.estimated_cost ?? '', createExpense: !!r.estimated_cost, comment: '' }); }}>Review</Button>}
            {['approved', 'scheduled'].includes(r.status) && <Button size="sm" onClick={() => act(() => axios.post(`/inventory/maintenance/${r.id}/start`, {}, { withCredentials: true }), 'Repair started')}>Start</Button>}
            {r.status === 'in_progress' && <Button size="sm" variant="primary" onClick={() => { setDone(r); setF({ actualCost: '', conditionAfter: 'good', notes: '' }); }}>Complete</Button>}
            {!['completed', 'cancelled'].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => act(() => axios.post(`/inventory/maintenance/${r.id}/cancel`, {}, { withCredentials: true }), 'Cancelled')}>Cancel</Button>}
          </span>
        ) : null)} />
      <FormModal open={!!review} onClose={() => setReview(null)} title="Review the report"
        onSubmit={async () => { await axios.post(`/inventory/maintenance/${review.id}/review`, { ...f, estimatedCost: f.estimatedCost === '' ? undefined : Number(f.estimatedCost) }, { withCredentials: true }); toast.push('success', 'Reviewed'); list.reload(); }}>
        <Field label="Decision"><Select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })} options={[{ value: 'approved', label: 'Approve the repair' }, { value: 'rejected', label: 'Close without repair' }]} /></Field>
        {f.decision === 'approved' ? <>
          <Field label="Technician / vendor"><Input value={f.technician} onChange={(e) => setF({ ...f, technician: e.target.value })} /></Field>
          <Field label="Estimated cost"><Input type="number" min="0" value={f.estimatedCost} onChange={(e) => setF({ ...f, estimatedCost: e.target.value })} /></Field>
          <Checkbox label="Send the repair cost to Finance as an expense (it then follows Finance approval and payment)" checked={f.createExpense} onChange={(e) => setF({ ...f, createExpense: e.target.checked })} />
        </> : <Field label="Reason" required><Textarea rows={2} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></Field>}
      </FormModal>
      <FormModal open={!!done} onClose={() => setDone(null)} title="Repair completed"
        onSubmit={async () => { await axios.post(`/inventory/maintenance/${done.id}/complete`, { ...f, actualCost: f.actualCost === '' ? undefined : Number(f.actualCost) }, { withCredentials: true }); toast.push('success', 'Completed'); list.reload(); }}>
        <Field label="Actual cost" hint="Recorded on the repair; payment is handled in Finance (never a second expense)."><Input type="number" min="0" value={f.actualCost} onChange={(e) => setF({ ...f, actualCost: e.target.value })} /></Field>
        <Field label="Condition after"><Select value={f.conditionAfter} onChange={(e) => setF({ ...f, conditionAfter: e.target.value })} options={conditionOptions} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </FormModal>
    </div>
  );
}

export function Consumables() {
  const s = useInv();
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [low, setLow] = useState(false);
  const list = useLoad<any>(`/inventory/assets?consumable=true&limit=200&${invQuery(s)}`, [s.departmentId]);
  const [open, setOpen] = useState(false);
  const rows = (list.data?.data ?? []).filter((r: any) => !low || (r.reorder_level !== null && r.quantity <= r.reorder_level));
  return (
    <div className="space-y-4">
      <PageHeader title={t('inv.nav.consumables')} description="Stationery, cleaning and event supplies. Stock changes only through received, issued, corrected or transferred movements; nothing can go below zero."
        actions={canManageScope(s) ? <Button variant="primary" onClick={() => setOpen(true)}><PlusIcon className="h-4 w-4" /> New stock item</Button> : undefined} />
      <Checkbox label="Only items at or below their reorder level" checked={low} onChange={(e) => setLow(e.target.checked)} />
      <DataTable rows={rows} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No stock items' }}
        columns={[
          { key: 't', header: 'Item', render: (r: any) => <Link className="font-medium text-primary hover:underline" to={`${s.base}/assets/${r.id}`}>{r.name}</Link>, priority: 'primary' },
          { key: 'o', header: 'Store', render: (r: any) => r.ownerLabel },
          { key: 'q', header: 'In stock', align: 'right', render: (r: any) => <span className={r.reorder_level !== null && r.quantity <= r.reorder_level ? 'font-semibold text-danger' : ''}>{r.quantity} {r.unit ?? ''}</span> },
          { key: 'r', header: 'Reorder at', align: 'right', render: (r: any) => r.reorder_level ?? '—' },
          { key: 'l', header: 'Stored at', render: (r: any) => r.storage_location ?? r.location?.name ?? '—', priority: 'meta' },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.reorder_level !== null && r.quantity <= r.reorder_level ? 'overdue' : 'active'} /> },
        ]} />
      <RegisterModal consumable open={open} onClose={() => setOpen(false)} onSaved={(a) => { toast.push('success', `Added ${a.asset_tag}`); navigate(`${s.base}/assets/${a.id}`); }} />
    </div>
  );
}
