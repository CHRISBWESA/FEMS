import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { PlusIcon, TrashIcon, PaperAirplaneIcon, CheckIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Field, IconButton, Input, Modal, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { AttachmentList, AttachmentsField, Attachment, Detail, ExportButton, HistoryTimeline, StatusBadge, errMsg, fmtDate, fmtDateTime, fmtMoney, useWorkspace } from './shared';

type Line = { item: string; quantity: number | string; unitCost: string };
type Request = {
  id: string; title: string; description: string | null; justification: string | null; activityId: string | null; amount: string;
  expenseBreakdown: { item: string; quantity: number; unitCost: string; amount: string }[]; attachments: Attachment[];
  status: string; statusLabel: string; currentStage: string | null; stages: { role: string; status: string; comment: string | null; actedAt: string | null }[];
  submittedAt: string; released: { amount: string; releasedAt: string; method: string } | null; history?: any[];
};

const FILTERS = [
  { key: 'all', label: 'All', statuses: '' },
  { key: 'review', label: 'In review', statuses: 'SUBMITTED,RESUBMITTED,UNDER_REVIEW,APPROVED' },
  { key: 'returned', label: 'Returned', statuses: 'RETURNED' },
  { key: 'approved', label: 'Fully approved', statuses: 'FINAL_APPROVED' },
  { key: 'rejected', label: 'Rejected', statuses: 'REJECTED' },
];
const STAGE_NAME: Record<string, string> = { treasurer: 'Treasurer', secretary: 'Fellowship Secretary', chairperson: 'Fellowship Chairperson' };

export default function WsFinance() {
  const { base, department } = useWorkspace();
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Request[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Request | 'new' | null>(params.get('new') === '1' ? 'new' : null);
  const [viewing, setViewing] = useState<Request | null>(null);
  const statuses = FILTERS.find((f) => f.key === filter)!.statuses;

  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(page), limit: '20' });
    if (statuses) q.set('status', statuses);
    axios.get(`${base}/financial-requests?${q}`, { withCredentials: true })
      .then((r) => { setRows(r.data.data); setTotal(r.data.total); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load requests.')));
  }, [base, page, statuses]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [filter]);
  const open = async (id: string) => {
    try { setViewing((await axios.get(`${base}/financial-requests/${id}`, { withCredentials: true })).data); } catch (e) { toast.push('error', errMsg(e, 'Could not open the request.')); }
  };
  const closeEditor = useCallback(() => { setEditing(null); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } }, [params, setParams]);

  const columns: Column<Request>[] = [
    { key: 'title', header: 'Request', priority: 'primary', render: (r) => <button className="text-left font-medium text-ink hover:text-primary" onClick={() => open(r.id)}>{r.title}</button> },
    { key: 'amount', header: 'Amount', tabular: true, align: 'right', render: (r) => fmtMoney(r.amount) },
    { key: 'submitted', header: 'Submitted', priority: 'secondary', render: (r) => fmtDate(r.submittedAt) },
    { key: 'status', header: 'Status', priority: 'meta', render: (r) => <StatusBadge status={r.status} label={r.statusLabel} /> },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('ws.finance')}</h1>
          <p className="page-desc">Requests for money for {department.name}'s activities. Each is approved by the Treasurer, then the Fellowship Secretary, then the Fellowship Chairperson.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton url={`${base}/financial-requests/export${statuses ? `?status=${statuses}` : ''}`} filename={`${department.name}-financial-requests.csv`} />
          <Button variant="primary" onClick={() => setEditing('new')}><PlusIcon className="h-4 w-4" /> {t('ws.newRequest')}</Button>
        </div>
      </div>
      <Tabs tabs={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={setFilter} />
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={rows === null && !error} error={error || null} onRetry={load} caption="Financial requests"
        total={total} page={page} pageSize={20} onPageChange={setPage}
        empty={{ title: 'No requests here', description: 'Request money for an activity, with a breakdown of the costs.', action: <Button variant="primary" onClick={() => setEditing('new')}>{t('ws.newRequest')}</Button> }} />
      {editing && <RequestForm request={editing === 'new' ? null : editing} onClose={closeEditor} onSaved={(r) => { closeEditor(); toast.push('success', 'Request submitted to the Treasurer'); load(); setViewing(r); }} />}
      {viewing && <RequestDetail request={viewing} onClose={() => setViewing(null)} onRevise={() => { setEditing(viewing); setViewing(null); }} />}
    </div>
  );
}

function RequestForm({ request, onClose, onSaved }: { request: Request | null; onClose: () => void; onSaved: (r: Request) => void }) {
  const { base, department } = useWorkspace();
  const [activities, setActivities] = useState<any[]>([]);
  const [f, setF] = useState({ title: request?.title ?? '', description: request?.description ?? '', justification: request?.justification ?? '', activityId: request?.activityId ?? '' });
  const [lines, setLines] = useState<Line[]>(request?.expenseBreakdown?.map((l) => ({ item: l.item, quantity: l.quantity, unitCost: l.unitCost })) ?? [{ item: '', quantity: 1, unitCost: '' }]);
  const [attachments, setAttachments] = useState<Attachment[]>(request?.attachments ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get(`${base}/activities?status=DRAFT,PENDING_SECRETARY,PENDING_CHAIRPERSON,RETURNED,APPROVED,COMPLETED&limit=100`, { withCredentials: true }).then((r) => setActivities(r.data.data)).catch(() => {});
  }, [base]);
  const total = useMemo(() => lines.reduce((s, l) => s + Math.round((Number(l.unitCost) || 0) * 100) * (Number(l.quantity) || 0), 0) / 100, [lines]);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!f.title.trim() || !f.justification.trim()) { setError('Enter a title and the justification.'); return; }
    const clean = lines.filter((l) => l.item.trim() || l.unitCost);
    if (!clean.length || clean.some((l) => !l.item.trim() || !(Number(l.unitCost) > 0) || !(Number(l.quantity) >= 1))) {
      setError('Every line of the breakdown needs an item, a quantity of at least 1 and a cost.');
      return;
    }
    setSaving(true);
    setError('');
    const body = { ...f, activityId: f.activityId || null, description: f.description || null, expenseBreakdown: clean.map((l) => ({ item: l.item.trim(), quantity: Number(l.quantity), unitCost: l.unitCost })), attachments };
    try {
      const saved = request
        ? (await axios.post(`${base}/financial-requests/${request.id}/resubmit`, body, { withCredentials: true })).data
        : (await axios.post(`${base}/financial-requests`, body, { withCredentials: true })).data;
      onSaved(saved);
    } catch (e) { setError(errMsg(e, 'Could not submit the request.')); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} width="lg" title={request ? 'Revise and resubmit' : 'New financial request'} description={`Department: ${department.name}`}
      footer={<>
        <span className="mr-auto self-center text-sm font-medium text-ink">Total: {fmtMoney(total)}</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={save}><PaperAirplaneIcon className="h-4 w-4" /> {request ? 'Resubmit' : 'Submit'}</Button>
      </>}
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Request title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <Field label="Related activity">
          <select className="select w-full" value={f.activityId} onChange={(e) => setF({ ...f, activityId: e.target.value })}>
            <option value="">None</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.title} · {fmtDate(a.date)}</option>)}
          </select>
        </Field>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={3000} /></Field>
        <Field label="Justification" required hint="Why the money is needed."><Textarea rows={3} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} maxLength={3000} /></Field>

        <div>
          <p className="label">Expense breakdown</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_6rem_8rem_7rem_auto] sm:items-center">
                <Input aria-label={`Item ${i + 1}`} placeholder="Item" value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} className="col-span-2 sm:col-span-1" />
                <Input aria-label={`Quantity ${i + 1}`} type="number" min={1} step={1} placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                <Input aria-label={`Unit cost ${i + 1}`} type="number" min={0} step="0.01" placeholder="Unit cost" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                <span className="text-right text-sm tabular-nums text-ink-muted">{fmtMoney(Math.round((Number(l.unitCost) || 0) * 100) * (Number(l.quantity) || 0) / 100)}</span>
                <IconButton label={`Remove line ${i + 1}`} icon={<TrashIcon className="h-4 w-4" />} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" onClick={() => setLines([...lines, { item: '', quantity: 1, unitCost: '' }])} disabled={lines.length >= 50}><PlusIcon className="h-4 w-4" /> Add line</Button>
        </div>
        <AttachmentsField label="Supporting documents" value={attachments} onChange={setAttachments} />
      </div>
    </Modal>
  );
}

function RequestDetail({ request: r, onClose, onRevise }: { request: Request; onClose: () => void; onRevise: () => void }) {
  const lastReturn = [...(r.history ?? [])].reverse().find((h: any) => h.action === 'returned' || h.action === 'rejected');
  return (
    <Modal open onClose={onClose} width="lg" title={r.title} description={<StatusBadge status={r.status} label={r.statusLabel} />}
      footer={r.status === 'RETURNED' ? <Button variant="primary" onClick={onRevise}>Revise and resubmit</Button> : undefined}>
      <div className="space-y-5">
        {(r.status === 'RETURNED' || r.status === 'REJECTED') && lastReturn?.comment && (
          <Alert tone={r.status === 'REJECTED' ? 'danger' : 'warning'} title={r.status === 'REJECTED' ? 'Rejected' : 'Returned for revision'}>{lastReturn.comment}</Alert>
        )}
        <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Approval stages">
          {r.stages.map((s, i) => (
            <li key={s.role} className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${s.status === 'approved' ? 'bg-success-light text-success' : s.role === r.currentStage ? 'bg-info-light text-info' : s.status === 'rejected' ? 'bg-danger-light text-danger' : s.status === 'returned' ? 'bg-warning-light text-warning' : 'bg-surface-sunken text-ink-muted'}`}>
                {s.status === 'approved' && <CheckIcon className="h-3.5 w-3.5" />} {STAGE_NAME[s.role] ?? s.role}
              </span>
              {i < r.stages.length - 1 && <span className="text-ink-subtle">→</span>}
            </li>
          ))}
        </ol>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Amount">{fmtMoney(r.amount)}</Detail>
          <Detail label="Submitted">{fmtDateTime(r.submittedAt)}</Detail>
          <Detail label="Released">{r.released ? `${fmtMoney(r.released.amount)} on ${fmtDate(r.released.releasedAt)}` : null}</Detail>
        </dl>
        <dl className="space-y-4">
          <Detail label="Description">{r.description}</Detail>
          <Detail label="Justification">{r.justification}</Detail>
        </dl>
        <table className="table w-full text-sm">
          <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {r.expenseBreakdown.map((l, i) => <tr key={i}><td>{l.item}</td><td className="text-right tabular-nums">{l.quantity}</td><td className="text-right tabular-nums">{fmtMoney(l.unitCost)}</td><td className="text-right tabular-nums">{fmtMoney(l.amount)}</td></tr>)}
            <tr><td colSpan={3} className="text-right font-medium">Total</td><td className="text-right font-semibold tabular-nums">{fmtMoney(r.amount)}</td></tr>
          </tbody>
        </table>
        <AttachmentList items={r.attachments} title="Supporting documents" />
        <HistoryTimeline events={r.history} />
      </div>
    </Modal>
  );
}
