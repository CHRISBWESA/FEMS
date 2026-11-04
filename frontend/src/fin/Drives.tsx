import { useState } from 'react';
import axios from 'axios';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, BanknotesIcon, ClipboardDocumentListIcon, HandRaisedIcon, PlusIcon, ReceiptPercentIcon, ScaleIcon, FlagIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Card, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Radio, Select, StatCard, StatGrid, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import {
  errMsg, fmtDate, fmtMoney, FormModal, label, MemberPicker, MethodSelect, openPdf, Row, scopeQuery,
  Status, today, useFin, useLoad,
} from './common';

/**
 * Contribution Drives: first create the thing people contribute to (an event, project, activity, outreach or
 * membership drive), then record inside it who pledged or gave cash, its target and its own expenses.
 */
export const DRIVE_KINDS = [
  { value: 'event', label: 'Event' },
  { value: 'project', label: 'Project' },
  { value: 'activity', label: 'Activity' },
  { value: 'outreach', label: 'Outreach' },
  { value: 'membership', label: 'Membership' },
  { value: 'other', label: 'Other' },
];
const kindLabel = (k?: string) => DRIVE_KINDS.find((x) => x.value === k)?.label ?? label(k);

function useCanManage() {
  const s = useFin();
  return s.departmentId ? !!s.leaderRole : s.roles.includes('treasurer');
}

/** The Contributions section: the list of drives, and one drive. */
export default function Drives() {
  return (
    <Routes>
      <Route index element={<DrivesList />} />
      <Route path=":id" element={<DriveDetail />} />
    </Routes>
  );
}

// ------------------------------------------------------------------ list

function DriveForm({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const s = useFin();
  return (
    <>
      <Field label="Name" required><Input value={value.name ?? ''} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="e.g. Youth camp 2026, Outreach to Arusha, Membership 2026" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" required><Select value={value.kind ?? 'event'} onChange={(e) => onChange({ ...value, kind: e.target.value })} options={DRIVE_KINDS} /></Field>
        <Field label={`Budgeted / estimated amount (${s.currency})`} hint="What you hope to collect. Leave empty if there is no target."><Input type="number" min="0" step="0.01" value={value.target ?? ''} onChange={(e) => onChange({ ...value, target: e.target.value })} /></Field>
        <Field label="Starts"><Input type="date" value={value.startDate ?? ''} onChange={(e) => onChange({ ...value, startDate: e.target.value })} /></Field>
        <Field label="Ends"><Input type="date" value={value.endDate ?? ''} min={value.startDate || undefined} onChange={(e) => onChange({ ...value, endDate: e.target.value })} /></Field>
      </div>
      <Field label="Description"><Textarea rows={3} value={value.description ?? ''} onChange={(e) => onChange({ ...value, description: e.target.value })} /></Field>
    </>
  );
}

const driveBody = (f: any) => ({
  name: f.name, kind: f.kind || 'event', description: f.description || undefined,
  target: f.target === '' || f.target === undefined ? null : Number(f.target), startDate: f.startDate || undefined, endDate: f.endDate || null,
});

function DrivesList() {
  const s = useFin();
  const toast = useToast();
  const navigate = useNavigate();
  const canManage = useCanManage();
  const [status, setStatus] = useState('active');
  const list = useLoad<any[]>(`/finance/drives?${scopeQuery(s)}${status ? `&status=${status}` : ''}`, [s.departmentId, status]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const rows = list.data ?? [];
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r.totals?.[k] ?? 0), 0);
  const owed = rows.reduce((a, r) => a + Math.max(0, Number(r.totals?.pledged ?? 0) - Number(r.totals?.collected ?? 0)), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Contribution Drives"
        actions={canManage ? <Button variant="primary" onClick={() => { setF({ kind: 'event', startDate: today() }); setOpen(true); }}><PlusIcon className="h-4 w-4" /> New drive</Button> : undefined} />
      <StatGrid>
        <StatCard label="Drives" value={list.data ? rows.length : '—'} icon={<FlagIcon className="h-5 w-5" />} tone="primary" />
        <StatCard label="Cash collected" value={fmtMoney(sum('collected'), s.currency)} icon={<BanknotesIcon className="h-5 w-5" />} tone="success" />
        <StatCard label="Pledged" value={fmtMoney(sum('pledged'), s.currency)} hint={`${fmtMoney(owed, s.currency)} still owed`} icon={<HandRaisedIcon className="h-5 w-5" />} />
        <StatCard label="Expenses paid" value={fmtMoney(sum('expensesPaid'), s.currency)} icon={<ReceiptPercentIcon className="h-5 w-5" />} tone="danger" />
      </StatGrid>
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        onRowClick={(r: any) => navigate(r.id)} rowClickLabel={(r: any) => `Open ${r.name}`}
        toolbar={<Select className="sm:w-56" aria-label="Show drives" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Open drives' }, { value: 'closed', label: 'Closed drives' }, { value: '', label: 'All drives' }]} />}
        empty={{ title: 'No contribution drives yet', description: canManage ? 'Create the first one with "New drive".' : undefined }}
        columns={[
          { key: 'n', header: 'Drive', render: (r: any) => <span className="font-medium text-ink">{r.name}</span>, priority: 'primary' },
          { key: 'k', header: 'Type', render: (r: any) => kindLabel(r.kind) },
          { key: 't', header: 'Target', align: 'right', tabular: true, render: (r: any) => (r.target ? fmtMoney(r.target, s.currency) : '—') },
          { key: 'c', header: 'Collected', align: 'right', tabular: true, render: (r: any) => <>{fmtMoney(r.totals.collected, s.currency)}{r.totals.progressPercent !== null && <span className="ml-1 text-xs text-ink-subtle">({r.totals.progressPercent}%)</span>}</> },
          { key: 'p', header: 'Pledged', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.totals.pledged, s.currency), priority: 'meta' },
          { key: 'e', header: 'Expenses', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.totals.expensesPaid, s.currency), priority: 'meta' },
          { key: 'b', header: 'Balance', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.totals.balance, s.currency) },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]} />

      <FormModal open={open} onClose={() => setOpen(false)} title="New contribution drive" width="lg" submitLabel="Create drive"
        onSubmit={async () => {
          const d = (await axios.post('/finance/drives', { ...driveBody(f), departmentId: s.departmentId ?? undefined }, { withCredentials: true })).data;
          toast.push('success', 'Drive created');
          navigate(d.id);
        }}>
        <DriveForm value={f} onChange={setF} />
      </FormModal>
    </div>
  );
}

// ------------------------------------------------------------------ one drive

function DriveDetail() {
  const { id } = useParams();
  const s = useFin();
  const toast = useToast();
  const canManage = useCanManage();
  const d = useLoad<any>(`/finance/drives/${id}`, [id]);
  const [tab, setTab] = useState<'contributors' | 'expenses'>('contributors');
  const [adding, setAdding] = useState<null | { kind: 'pledge' | 'cash'; who?: any }>(null);
  const [who, setWho] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [expense, setExpense] = useState<any>(null);

  if (d.error) return <ErrorState message={d.error} onRetry={d.reload} />;
  if (!d.data) return <PageLoader rows={3} />;
  const drive = d.data;
  const t = drive.totals;
  const owed = drive.contributors.reduce((a: number, c: any) => a + Number(c.owed), 0);
  const open = drive.status === 'active';
  const setStatus = async (status: string) => {
    try { await axios.put(`/finance/drives/${id}`, { status }, { withCredentials: true }); toast.push('success', status === 'active' ? 'Drive reopened' : 'Drive closed'); d.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not update the drive.')); }
  };

  return (
    <div className="space-y-4">
      <Link to=".." relative="path" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeftIcon className="h-4 w-4" /> All drives</Link>
      <PageHeader eyebrow={`${kindLabel(drive.kind)}${drive.department ? ` · ${drive.department.name}` : ''}`} title={drive.name}
        description={drive.description || `${fmtDate(drive.startDate)}${drive.endDate ? ` – ${fmtDate(drive.endDate)}` : ''}`}
        actions={canManage ? (
          <span className="flex flex-wrap gap-2">
            {open && <Button variant="primary" onClick={() => setAdding({ kind: 'cash' })}><BanknotesIcon className="h-4 w-4" /> Record cash</Button>}
            {open && <Button onClick={() => setAdding({ kind: 'pledge' })}><HandRaisedIcon className="h-4 w-4" /> Record pledge</Button>}
            <Button onClick={() => setEditing({ name: drive.name, kind: drive.kind, target: drive.target ?? '', startDate: drive.startDate?.slice(0, 10), endDate: drive.endDate?.slice(0, 10) ?? '', description: drive.description ?? '' })}>Edit</Button>
            <Button variant="ghost" onClick={() => setStatus(open ? 'closed' : 'active')}>{open ? 'Close drive' : 'Reopen'}</Button>
          </span>
        ) : undefined} />
      {!open && <Alert tone="info">This drive is closed: it accepts no new pledges or cash.</Alert>}

      <StatGrid>
        <StatCard label="Target" value={drive.target ? fmtMoney(drive.target, s.currency) : '—'} hint={t.remaining !== null ? `${fmtMoney(t.remaining, s.currency)} still to collect` : 'No target set'} icon={<FlagIcon className="h-5 w-5" />} tone="primary" />
        <StatCard label="Cash collected" value={fmtMoney(t.collected, s.currency)} hint={t.progressPercent !== null ? `${t.progressPercent}% of target · ${t.payments} payments` : `${t.payments} payments`} icon={<BanknotesIcon className="h-5 w-5" />} tone="success" />
        <StatCard label="Pledged" value={fmtMoney(t.pledged, s.currency)} hint={`${fmtMoney(owed, s.currency)} still owed`} icon={<HandRaisedIcon className="h-5 w-5" />} tone={owed > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Expenses paid" value={fmtMoney(t.expensesPaid, s.currency)} hint={Number(t.expensesPending) ? `${fmtMoney(t.expensesPending, s.currency)} waiting` : undefined} icon={<ReceiptPercentIcon className="h-5 w-5" />} tone="danger" />
        <StatCard label="Balance" value={fmtMoney(t.balance, s.currency)} hint="Cash collected minus expenses paid" icon={<ScaleIcon className="h-5 w-5" />} />
      </StatGrid>
      {t.progressPercent !== null && (
        <div className="h-3 overflow-hidden rounded bg-surface-sunken" aria-label={`Collected ${t.progressPercent}% of the target`}>
          <div className="h-full bg-success" style={{ width: `${Math.min(100, t.progressPercent)}%` }} />
        </div>
      )}

      <Tabs tabs={[{ key: 'contributors', label: `Contributors (${drive.contributors.length})` }, { key: 'expenses', label: `Expenses (${drive.expenses.length})` }]} active={tab} onChange={setTab} />

      {tab === 'contributors' ? (
        <>
        <DataTable rows={drive.contributors} rowKey={(r: any) => r.key} clientPaging pageSize={50}
          onRowClick={(r: any) => setWho(r.key)} rowClickLabel={(r: any) => `Details for ${r.name}`}
          empty={{ title: 'No pledges or cash yet', description: canManage && open ? 'Use "Record pledge" or "Record cash".' : undefined }}
          columns={[
            { key: 'n', header: 'Contributor', render: (r: any) => <span><span className="font-medium text-ink">{r.name}</span>{r.memberCode ? <span className="ml-2 text-xs text-ink-subtle">{r.memberCode}</span> : !r.memberId && <span className="ml-2 text-xs text-ink-subtle">not a member</span>}</span>, priority: 'primary' },
            { key: 'p', header: 'Pledged', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.pledged, s.currency) },
            { key: 'c', header: 'Paid', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.paid, s.currency) },
            { key: 'o', header: 'Still owed', align: 'right', tabular: true, render: (r: any) => (Number(r.owed) > 0 ? <span className="text-warning">{fmtMoney(r.owed, s.currency)}</span> : '—') },
          ]} />
        </>
      ) : (
        <div className="space-y-4">
          {canManage && <Button onClick={() => setExpense({ title: '', amount: '', date: today(), purpose: '', payee: '', paymentMethod: 'cash' })}><PlusIcon className="h-4 w-4" /> Add expense</Button>}
          <DataTable rows={drive.expenses} rowKey={(r: any) => r.id}
            empty={{ title: 'No expenses for this drive' }}
            columns={[
              { key: 'n', header: 'Expense', render: (r: any) => <span>{r.expense_number ? <span className="text-ink-subtle">{r.expense_number} · </span> : null}{r.title}</span>, priority: 'primary' },
              { key: 'd', header: 'Date', render: (r: any) => fmtDate(r.date) },
              { key: 'a', header: 'Amount', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount, s.currency) },
              { key: 's', header: 'Status', render: (r: any) => <Status value={r.reversed_at ? 'reversed' : r.payment_status === 'paid' ? 'paid' : r.approval_status} /> },
            ]} />
          <p className="text-xs text-ink-subtle">Expenses go through the Treasurer, Secretary and Chairperson, and are paid from the Expenses page.</p>
        </div>
      )}

      {adding && <AddContribution drive={drive} kind={adding.kind} who={adding.who} onClose={() => setAdding(null)} onDone={(key) => { d.reload(); if (key) setWho(key); }} />}
      {who && <ContributorPanel driveId={drive.id} contributorKey={who} canRecord={canManage && open} onClose={() => setWho(null)}
        onPay={(c) => setAdding({ kind: 'cash', who: c })} onChanged={d.reload} />}

      <FormModal open={!!editing} onClose={() => setEditing(null)} title="Edit drive" width="lg"
        onSubmit={async () => { await axios.put(`/finance/drives/${id}`, driveBody(editing), { withCredentials: true }); toast.push('success', 'Drive saved'); d.reload(); }}>
        {editing && <DriveForm value={editing} onChange={setEditing} />}
      </FormModal>

      <FormModal open={!!expense} onClose={() => setExpense(null)} title={`Expense for ${drive.name}`} width="lg" submitLabel="Save expense"
        onSubmit={async () => {
          await axios.post('/finance/expenses', {
            scope: drive.departmentId ? 'department' : undefined, departmentId: drive.departmentId ?? undefined, campaignId: drive.id,
            title: expense.title, amount: Number(expense.amount), date: expense.date, purpose: expense.purpose || undefined, payee: expense.payee || undefined, paymentMethod: expense.paymentMethod,
          }, { withCredentials: true });
          toast.push('success', 'Expense saved'); setTab('expenses'); d.reload();
        }}>
        {expense && (
          <>
            <Field label="What was it for" required><Input value={expense.title} onChange={(e) => setExpense({ ...expense, title: e.target.value })} placeholder="e.g. Transport, food, hall hire" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Amount (${s.currency})`} required><Input type="number" min="0" step="0.01" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} /></Field>
              <Field label="Date" required><Input type="date" value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.target.value })} /></Field>
              <Field label="Paid to"><Input value={expense.payee} onChange={(e) => setExpense({ ...expense, payee: e.target.value })} /></Field>
              <Field label="Payment method"><MethodSelect value={expense.paymentMethod} onChange={(v) => setExpense({ ...expense, paymentMethod: v })} /></Field>
            </div>
            <Field label="Details"><Textarea rows={2} value={expense.purpose} onChange={(e) => setExpense({ ...expense, purpose: e.target.value })} /></Field>
          </>
        )}
      </FormModal>
    </div>
  );
}

// ------------------------------------------------------------------ recording a pledge or cash

function AddContribution({ drive, kind: initialKind, who, onClose, onDone }: { drive: any; kind: 'pledge' | 'cash'; who?: any; onClose: () => void; onDone: (key?: string) => void }) {
  const s = useFin();
  const toast = useToast();
  const [kind, setKind] = useState<'pledge' | 'cash'>(initialKind);
  const [isMember, setIsMember] = useState(who ? !!who.memberId : true);
  const [member, setMember] = useState<{ id: string; name: string } | null>(who?.memberId ? { id: who.memberId, name: who.name } : null);
  const [f, setF] = useState<any>({ contributorName: who && !who.memberId ? who.name : '', contributorPhone: '', amount: who && Number(who.owed) > 0 ? who.owed : '', date: today(), paymentMethod: 'cash', paymentReference: '', dueDate: '', notes: '' });
  const fixedWho = !!who;

  const save = async () => {
    const giver = isMember ? { memberId: member?.id } : { contributorName: f.contributorName, contributorPhone: f.contributorPhone || undefined };
    if (kind === 'pledge') {
      const r = (await axios.post(`/finance/drives/${drive.id}/pledges`, { ...giver, amount: Number(f.amount), dueDate: f.dueDate || undefined, notes: f.notes || undefined }, { withCredentials: true })).data;
      toast.push('success', `Pledge ${r.pledge_number ?? ''} recorded`);
      onDone(r.key);
    } else {
      const r = (await axios.post(`/finance/drives/${drive.id}/payments`, { ...giver, amount: Number(f.amount), date: f.date, paymentMethod: f.paymentMethod, paymentReference: f.paymentReference || undefined, notes: f.notes || undefined }, { withCredentials: true })).data;
      toast.push('success', `Recorded. Receipt ${r.receipt_number}`);
      openPdf(`/finance/contributions/${r.id}/receipt?format=pdf`).catch(() => {});
      onDone(r.key);
    }
  };

  return (
    <FormModal open onClose={onClose} title={fixedWho ? `Payment from ${who.name}` : `Record for ${drive.name}`} width="lg"
      submitLabel={kind === 'pledge' ? 'Record pledge' : 'Record and print receipt'} onSubmit={save}>
      {!fixedWho && (
        <fieldset className="space-y-2">
          <legend className="label">What is it</legend>
          <div className="flex flex-wrap gap-4">
            <Radio name="dk" label="Cash received" description="Money in hand now; a receipt is printed." checked={kind === 'cash'} onChange={() => setKind('cash')} />
            <Radio name="dk" label="Pledge" description="A promise to give; it is not money yet." checked={kind === 'pledge'} onChange={() => setKind('pledge')} />
          </div>
        </fieldset>
      )}
      {!fixedWho && (
        <fieldset className="space-y-2">
          <legend className="label">Contributor</legend>
          <div className="flex flex-wrap gap-4">
            <Radio name="dw" label="A registered member" checked={isMember} onChange={() => setIsMember(true)} />
            <Radio name="dw" label="Not in the members list" checked={!isMember} onChange={() => setIsMember(false)} />
          </div>
        </fieldset>
      )}
      {!fixedWho && isMember && <Field label="Member" required><MemberPicker value={member} onChange={setMember} /></Field>}
      {!fixedWho && !isMember && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required><Input value={f.contributorName} onChange={(e) => setF({ ...f, contributorName: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.contributorPhone} onChange={(e) => setF({ ...f, contributorPhone: e.target.value })} /></Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Amount (${s.currency})`} required hint={fixedWho && Number(who.owed) > 0 ? `Still owed: ${fmtMoney(who.owed, s.currency)}` : undefined}>
          <Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        {kind === 'cash' ? (
          <>
            <Field label="Date received" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Payment method"><MethodSelect value={f.paymentMethod} onChange={(v) => setF({ ...f, paymentMethod: v })} /></Field>
            <Field label="Payment reference" hint="Mobile money or bank reference; it cannot be recorded twice."><Input value={f.paymentReference} onChange={(e) => setF({ ...f, paymentReference: e.target.value })} /></Field>
          </>
        ) : (
          <Field label="Expected by"><Input type="date" value={f.dueDate} min={today()} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        )}
      </div>
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </FormModal>
  );
}

// ------------------------------------------------------------------ one contributor

function ContributorPanel({ driveId, contributorKey, canRecord, onClose, onPay, onChanged }: {
  driveId: string; contributorKey: string; canRecord: boolean; onClose: () => void; onPay: (c: any) => void; onChanged: () => void;
}) {
  const s = useFin();
  const toast = useToast();
  const d = useLoad<any>(`/finance/drives/${driveId}/contributors/${encodeURIComponent(contributorKey)}`, [driveId, contributorKey]);
  const [reverseFor, setReverseFor] = useState<any>(null);
  const [reason, setReason] = useState('');
  const c = d.data?.contributor;
  const canReverse = s.departmentId ? s.leaderRole === 'department_chairperson' : s.roles.includes('treasurer');
  const reverse = async () => {
    try {
      if (s.departmentId) await axios.post(`/finance/contributions/${reverseFor.id}/reverse`, { reason }, { withCredentials: true });
      else await axios.post(`/finance/contributions/${reverseFor.id}/delete-request`, { reason }, { withCredentials: true });
      toast.push('success', 'Payment reversed');
      setReverseFor(null); setReason(''); d.reload(); onChanged();
    } catch (e) { toast.push('error', errMsg(e, 'Could not reverse the payment.')); }
  };

  return (
    <Modal open onClose={onClose} width="lg" title={c?.name ?? 'Contributor'}
      description={c ? (c.memberCode ? `Member ${c.memberCode}` : c.memberId ? 'Member' : 'Not in the members list') : undefined}
      footer={<><Button onClick={onClose}>Close</Button>{canRecord && c && <Button variant="primary" onClick={() => { onClose(); onPay(c); }}><BanknotesIcon className="h-4 w-4" /> Record payment</Button>}</>}>
      {d.error && <Alert tone="danger">{d.error}</Alert>}
      {!d.data && !d.error && <PageLoader rows={2} />}
      {d.data && (
        <div className="space-y-5">
          {c && (
            <Card className="card-pad">
              <Row k="Pledged" v={fmtMoney(c.pledged, s.currency)} />
              <Row k="Paid" v={fmtMoney(c.paid, s.currency)} />
              <Row k="Still owed" v={<span className={Number(c.owed) > 0 ? 'text-warning font-semibold' : ''}>{fmtMoney(c.owed, s.currency)}</span>} />
            </Card>
          )}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><HandRaisedIcon className="h-4 w-4" /> Pledges</h3>
            {d.data.pledges.length === 0 ? <p className="text-sm text-ink-muted">No pledges.</p> : (
              <ul className="divide-y divide-hairline text-sm">
                {d.data.pledges.map((p: any) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{p.pledge_number ?? 'Pledge'} · {fmtDate(p.created_at)}{p.due_date ? ` · expected by ${fmtDate(p.due_date)}` : ''}{p.notes ? <span className="block text-xs text-ink-subtle">{p.notes}</span> : null}</span>
                    <span className="font-medium tabular-nums">{fmtMoney(p.amount, s.currency)} {p.status === 'cancelled' && <Status value="cancelled" />}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><ClipboardDocumentListIcon className="h-4 w-4" /> Payments</h3>
            {d.data.payments.length === 0 ? <p className="text-sm text-ink-muted">No payments yet.</p> : (
              <ul className="divide-y divide-hairline text-sm">
                {d.data.payments.map((p: any) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <button className="text-primary hover:underline" onClick={() => openPdf(`/finance/contributions/${p.id}/receipt?format=pdf`).catch(() => toast.push('error', 'Could not open the receipt.'))}>{p.receipt_number}</button>
                      {' '}· {fmtDate(p.date)} · {label(p.payment_method)}{p.payment_reference ? ` (${p.payment_reference})` : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">{fmtMoney(p.amount, s.currency)}</span>
                      {p.status !== 'active' ? <Status value={p.status} /> : canReverse && <Button size="sm" variant="ghost" onClick={() => setReverseFor(p)}>Reverse</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <Modal open={!!reverseFor} onClose={() => setReverseFor(null)} title={s.departmentId ? 'Reverse payment' : 'Request a reversal'}
        description={s.departmentId ? 'The money is taken back out with a reversal entry. Nothing is deleted.' : 'The Secretary and the Chairperson must approve the reversal. Nothing is deleted.'}
        footer={<><Button onClick={() => setReverseFor(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} onClick={reverse}>{s.departmentId ? 'Reverse' : 'Send request'}</Button></>}>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </Modal>
  );
}
