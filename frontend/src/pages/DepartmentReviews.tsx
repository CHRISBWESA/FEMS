import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  CheckIcon, ArrowUturnLeftIcon, XMarkIcon, ClockIcon, CalendarDaysIcon, DocumentTextIcon, BanknotesIcon,
} from '@heroicons/react/24/outline';
import { Alert, Badge, Button, ErrorState, Field, Modal, PageLoader, Tabs, Textarea, useToast, StatCard, StatGrid } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { AttachmentList, Detail, HistoryTimeline, StatusBadge, errMsg, fmtDate, fmtDateTime, fmtMoney } from '../workspace/shared';

type Kind = 'activity' | 'report' | 'financial';
const KIND_LABEL: Record<Kind, string> = { activity: 'Activities', report: 'Reports', financial: 'Financial requests' };
type Item = { kind: Kind; id: string; title: string; department: string | null; amount?: string; date?: string; submittedAt: string; status: string; waitingFor: string | null };

/**
 * The review inbox of the Fellowship Secretary, Fellowship Chairperson and Treasurer: the department items waiting
 * at their stage, and the record of everything their role reviews.
 */
export default function DepartmentReviews() {
  const toast = useToast();
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<Kind | null>(null);
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<Item[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<any>(null);

  const loadSummary = useCallback(() => {
    axios.get('/department-reviews/summary', { withCredentials: true })
      .then((r) => { setSummary(r.data); setKind((k) => k ?? r.data.kinds[0] ?? null); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load your reviews.')));
  }, []);
  useEffect(loadSummary, [loadSummary]);

  const loadRows = useCallback(() => {
    if (!kind) return;
    setRows(null);
    const req = view === 'pending'
      ? axios.get(`/department-reviews/pending?kind=${kind}`, { withCredentials: true }).then((r) => { setRows(r.data); setTotal(r.data.length); })
      : axios.get(`/department-reviews/${kind}?page=${page}&limit=20`, { withCredentials: true }).then((r) => { setRows(r.data.data); setTotal(r.data.total); });
    req.catch((e) => { setRows([]); toast.push('error', errMsg(e, 'Could not load the list.')); });
  }, [kind, view, page, toast]);
  useEffect(loadRows, [loadRows]);
  useEffect(() => setPage(1), [kind, view]);

  const openItem = async (it: Item) => {
    try { setOpen((await axios.get(`/department-reviews/${it.kind}/${it.id}`, { withCredentials: true })).data); }
    catch (e) { toast.push('error', errMsg(e, 'Could not open the item.')); }
  };

  if (error) return <div className="mx-auto max-w-5xl"><ErrorState message={error} onRetry={loadSummary} /></div>;
  if (!summary || !kind) return <PageLoader rows={2} />;

  const columns: Column<Item>[] = [
    { key: 'title', header: 'Item', priority: 'primary', render: (it) => <button className="text-left font-medium text-ink hover:text-primary" onClick={() => openItem(it)}>{it.title}</button> },
    { key: 'dept', header: 'Department', priority: 'secondary', render: (it) => it.department ?? '—' },
    ...(kind === 'financial' ? [{ key: 'amount', header: 'Amount', tabular: true, align: 'right' as const, render: (it: Item) => fmtMoney(it.amount) }] : [{ key: 'date', header: kind === 'activity' ? 'Activity date' : 'Activity date', render: (it: Item) => fmtDate(it.date) }]),
    { key: 'submitted', header: 'Submitted', priority: 'secondary', render: (it) => fmtDate(it.submittedAt) },
    { key: 'status', header: 'Status', priority: 'meta', render: (it) => it.waitingFor ? <Badge tone="info">With {it.waitingFor}</Badge> : <StatusBadge status={it.status} /> },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Department Reviews</h1>
          <p className="page-desc">Department activities, reports and financial requests waiting for your decision.</p>
        </div>
      </div>
      <StatGrid>
        <StatCard label="Waiting for me" value={summary.kinds.reduce((n: number, k: Kind) => n + (summary.pending[k] ?? 0), 0)} icon={<ClockIcon className="h-5 w-5" />} tone={summary.kinds.some((k: Kind) => summary.pending[k]) ? 'warning' : 'neutral'} />
        {summary.kinds.includes('activity') && <StatCard label="Activities" value={summary.pending.activity ?? 0} icon={<CalendarDaysIcon className="h-5 w-5" />} hint="Waiting for you" onClick={() => setKind('activity' as Kind)} />}
        {summary.kinds.includes('report') && <StatCard label="Reports" value={summary.pending.report ?? 0} icon={<DocumentTextIcon className="h-5 w-5" />} hint="Waiting for you" onClick={() => setKind('report' as Kind)} />}
        {summary.kinds.includes('financial') && <StatCard label="Financial requests" value={summary.pending.financial ?? 0} icon={<BanknotesIcon className="h-5 w-5" />} hint="Waiting for you" onClick={() => setKind('financial' as Kind)} />}
      </StatGrid>
      <Tabs tabs={summary.kinds.map((k: Kind) => ({ key: k, label: <>{KIND_LABEL[k]}{summary.pending[k] ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xxs text-white">{summary.pending[k]}</span> : null}</> }))} active={kind} onChange={setKind} />
      <Tabs tabs={[{ key: 'pending', label: 'Waiting for me' }, { key: 'all', label: 'All submitted' }]} active={view} onChange={setView} />
      <DataTable columns={columns} rows={rows} rowKey={(it) => it.id} loading={rows === null} caption={KIND_LABEL[kind]}
        total={view === 'all' ? total : null} page={page} pageSize={20} onPageChange={view === 'all' ? setPage : undefined}
        empty={view === 'pending'
          ? { title: 'Nothing is waiting for you', description: 'New submissions appear here when they reach your stage.' }
          : { title: 'Nothing submitted yet' }} />
      {open && <ReviewModal item={open} onClose={() => setOpen(null)} onDecided={() => { setOpen(null); loadSummary(); loadRows(); }} />}
    </div>
  );
}

function ReviewModal({ item: it, onClose, onDecided }: { item: any; onClose: () => void; onDecided: () => void }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const decide = async (decision: 'approved' | 'returned' | 'rejected') => {
    if (decision !== 'approved' && !comment.trim()) { setError('Add a comment explaining what needs to change or why it is rejected.'); return; }
    setBusy(decision);
    setError('');
    try {
      await axios.post(`/department-reviews/${it.kind}/${it.id}/decide`, { decision, comment: comment.trim() || undefined }, { withCredentials: true });
      toast.push('success', decision === 'approved' ? 'Approved' : decision === 'returned' ? 'Returned for revision' : 'Rejected');
      onDecided();
    } catch (e) { setError(errMsg(e, 'Could not record the decision.')); } finally { setBusy(''); }
  };

  const title = it.kind === 'report' ? it.activityTitle : it.title;
  return (
    <Modal open onClose={onClose} width="lg" title={title} description={<span className="inline-flex flex-wrap items-center gap-2">{it.department?.name}<StatusBadge status={it.status} label={it.statusLabel} />{it.waitingFor && <Badge tone="info">With {it.waitingFor}</Badge>}</span>}
      footer={it.canDecide ? <>
        <Button variant="danger-quiet" loading={busy === 'rejected'} disabled={!!busy} onClick={() => decide('rejected')}><XMarkIcon className="h-4 w-4" /> Reject</Button>
        <Button loading={busy === 'returned'} disabled={!!busy} onClick={() => decide('returned')}><ArrowUturnLeftIcon className="h-4 w-4" /> Return for revision</Button>
        <Button variant="primary" loading={busy === 'approved'} disabled={!!busy} onClick={() => decide('approved')}><CheckIcon className="h-4 w-4" /> Approve</Button>
      </> : undefined}>
      <div className="space-y-5">
        <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Approval stages">
          {it.stages.map((s: any, i: number) => (
            <li key={i} className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 ${s.status === 'approved' ? 'bg-success-light text-success' : s.status === 'rejected' ? 'bg-danger-light text-danger' : s.status === 'returned' ? 'bg-warning-light text-warning' : 'bg-surface-sunken text-ink-muted'}`}>{s.name}</span>
              {i < it.stages.length - 1 && <span className="text-ink-subtle">→</span>}
            </li>
          ))}
        </ol>

        {it.kind === 'activity' && (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Starts">{fmtDateTime(it.date)}</Detail>
              <Detail label="Ends">{it.endDate ? fmtDateTime(it.endDate) : null}</Detail>
              <Detail label="Venue">{it.venue}</Detail>
              <Detail label="Submitted">{fmtDateTime(it.submittedAt)}</Detail>
            </dl>
            <dl className="space-y-4">
              <Detail label="Description">{it.description}</Detail>
              <Detail label="Objectives">{it.objectives}</Detail>
              <Detail label="Supporting information">{it.supportingInfo}</Detail>
            </dl>
            <AttachmentList items={it.attachments} title="Supporting files" />
          </>
        )}
        {it.kind === 'report' && (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Activity date">{fmtDate(it.activityDate)}</Detail>
              <Detail label="Participants">{it.participants ?? null}</Detail>
              <Detail label="Version">{it.version}</Detail>
            </dl>
            <dl className="space-y-4">
              <Detail label="Description">{it.description}</Detail>
              <Detail label="Objectives">{it.objectives}</Detail>
              <Detail label="Achievements">{it.achievements}</Detail>
              <Detail label="Outcomes">{it.outcomes}</Detail>
              <Detail label="Challenges">{it.challenges}</Detail>
              <Detail label="Recommendations">{it.recommendations}</Detail>
            </dl>
            <AttachmentList items={it.photos} title="Photographs" />
            <AttachmentList items={it.documents} title="Supporting documents" />
          </>
        )}
        {it.kind === 'financial' && (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Amount requested">{fmtMoney(it.amount)}</Detail>
              <Detail label="Submitted">{fmtDateTime(it.submittedAt)}</Detail>
            </dl>
            <dl className="space-y-4">
              <Detail label="Description">{it.description}</Detail>
              <Detail label="Justification">{it.justification}</Detail>
            </dl>
            <table className="table w-full text-sm">
              <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {it.expenseBreakdown.map((l: any, i: number) => <tr key={i}><td>{l.item}</td><td className="text-right tabular-nums">{l.quantity}</td><td className="text-right tabular-nums">{fmtMoney(l.unitCost)}</td><td className="text-right tabular-nums">{fmtMoney(l.amount)}</td></tr>)}
                <tr><td colSpan={3} className="text-right font-medium">Total</td><td className="text-right font-semibold tabular-nums">{fmtMoney(it.amount)}</td></tr>
              </tbody>
            </table>
            <AttachmentList items={it.attachments} title="Supporting documents" />
          </>
        )}

        <HistoryTimeline events={it.history} />

        {it.canDecide && (
          <div className="space-y-3 border-t border-hairline pt-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Comment" hint="Required when returning or rejecting. The department leaders will see it."><Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
