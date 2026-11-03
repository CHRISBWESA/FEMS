import { useState } from 'react';
import axios from 'axios';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Checkbox, Field, Input, Modal, PageHeader, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import {
  APPROVAL_TYPES, Attachment, AttachmentPicker, Attachments, CategorySelect, errMsg, fmtDate, fmtMoney, FormModal, label, MethodSelect,
  PendingApprovals, ProjectSelect, Row, scopeQuery, Status, today, Trail, useFin, useLoad,
} from './common';

/** Plain-language state of an expense (matches the server's). */
export function expenseState(e: any): string {
  if (e.payment_status === 'reversed') return 'reversed';
  if (e.payment_status === 'paid') return 'paid';
  if (e.approval_status === 'REJECTED') return 'rejected';
  if (e.approval_status === 'CANCELLED') return 'cancelled';
  if (e.approval_status === 'RETURNED') return 'returned';
  if (e.already_incurred && !e.verified_at) return 'awaiting_verification';
  if (e.approval_status === 'FINAL_APPROVED') return 'approved';
  return 'requested';
}

export function Expenses() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const list = useLoad<any[]>(`/finance/expenses?${scopeQuery(s)}&limit=300`, [s.departmentId]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const [files, setFiles] = useState<Attachment[]>([]);
  const [view, setView] = useState<string | null>(null);
  const detail = useLoad<any>(view ? `/finance/expenses/${view}` : null, [view]);
  const [pay, setPay] = useState<any>(null);
  const isTreasurer = s.roles.includes('treasurer');
  const canRecord = s.departmentId ? !!s.leaderRole : s.roles.some((r) => ['treasurer', 'secretary'].includes(r));
  const canPay = (e: any) => (s.departmentId ? !!s.leaderRole && e.fund === 'department' : isTreasurer && e.fund === 'central');

  const act = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); toast.push('success', ok); detail.reload(); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not complete that.')); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.expenses')} description={s.departmentId
        ? 'Spending from the department\'s own money. It is approved by the Treasurer, Secretary and Chairperson.'
        : 'Central spending: the Treasurer records, the Secretary reviews, the Chairperson approves, and the Treasurer pays. Approved is not paid.'}
        actions={canRecord ? <Button variant="primary" onClick={() => { setF({ title: '', amount: '', date: today(), purpose: '', payee: '', categoryId: '', projectId: '', paymentMethod: 'cash', alreadyIncurred: false, description: '' }); setFiles([]); setOpen(true); }}><PlusIcon className="h-4 w-4" /> New expense</Button> : undefined} />
      <PendingApprovals types={APPROVAL_TYPES.expenses} departmentId={s.departmentId} onDone={list.reload} />
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id} clientPaging pageSize={25}
        empty={{ title: 'No expenses' }}
        columns={[
          { key: 'n', header: 'Number', render: (r: any) => <button className="font-medium text-primary hover:underline" onClick={() => setView(r.id)}>{r.expense_number ?? r.title}</button>, priority: 'primary' },
          { key: 'd', header: 'Date', render: (r: any) => fmtDate(r.date) },
          { key: 't', header: 'Title', render: (r: any) => r.title },
          { key: 'c', header: 'Category', render: (r: any) => r.category?.name ?? '—', priority: 'meta' },
          { key: 'a', header: 'Amount', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount, s.currency) },
          { key: 'p', header: 'Paid', align: 'right', tabular: true, render: (r: any) => (r.amount_paid ? fmtMoney(r.amount_paid, s.currency) : '—') },
          { key: 's', header: 'Status', render: (r: any) => <Status value={expenseState(r)} /> },
        ]} />

      <FormModal open={open} onClose={() => setOpen(false)} title="New expense" width="lg"
        onSubmit={async () => {
          await axios.post('/finance/expenses', {
            scope: s.departmentId ? 'department' : undefined, departmentId: s.departmentId ?? undefined, title: f.title, amount: Number(f.amount), date: f.date,
            purpose: f.purpose || undefined, payee: f.payee || undefined, description: f.description || undefined, categoryId: f.categoryId || undefined,
            projectId: f.projectId || undefined, paymentMethod: f.paymentMethod,
            alreadyIncurred: f.alreadyIncurred, attachments: files,
          }, { withCredentials: true });
          toast.push('success', 'Sent for approval'); list.reload();
        }}>
        <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${s.currency})`} required><Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Payee / vendor"><Input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></Field>
          <Field label="Purpose"><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
          {!s.departmentId && <Field label="Category"><CategorySelect kind="expense" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} /></Field>}
          <Field label="Project"><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
          <Field label="Payment method"><MethodSelect value={f.paymentMethod} onChange={(v) => setF({ ...f, paymentMethod: v })} /></Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Checkbox label="This money has already been spent (reimbursement) - it must be verified before it is paid" checked={f.alreadyIncurred} onChange={(e) => setF({ ...f, alreadyIncurred: e.target.checked })} />
        <AttachmentPicker value={files} onChange={setFiles} label={f.alreadyIncurred ? 'Evidence (required): receipt or invoice' : 'Quotes, invoices or receipts'} />
      </FormModal>

      <Modal open={!!view} onClose={() => setView(null)} title={detail.data ? `${detail.data.expense_number ?? ''} ${detail.data.title}` : 'Expense'} width="lg"
        footer={detail.data ? (
          <span className="flex flex-wrap gap-2">
            {detail.data.displayStatus === 'awaiting_verification' && <Button onClick={() => act(() => axios.post(`/finance/expenses/${view}/verify`, {}, { withCredentials: true }), 'Verified')}>Verify evidence</Button>}
            {detail.data.displayStatus === 'approved' && canPay(detail.data) && !detail.data.money_request_id && <Button variant="primary" onClick={() => setPay({ accountId: detail.data.account_id ?? '', amount: detail.data.amount_approved ?? detail.data.amount, paymentMethod: detail.data.payment_method ?? 'cash', paymentReference: '', paidAt: today() })}>Record payment</Button>}
            {['requested', 'returned', 'approved', 'awaiting_verification'].includes(detail.data.displayStatus) && <Button variant="danger-quiet" onClick={() => { const reason = window.prompt('Why is this expense being cancelled?'); if (reason) act(() => axios.post(`/finance/expenses/${view}/cancel`, { reason }, { withCredentials: true }), 'Cancelled'); }}>Cancel</Button>}
          </span>
        ) : undefined}>
        {detail.error && <Alert tone="danger">{detail.error}</Alert>}
        {detail.data && (
          <div className="space-y-4">
            <div>
              <Row k="Status" v={<Status value={detail.data.displayStatus} />} />
              <Row k="Paid from" v={detail.data.fund === 'department' ? 'Department funds' : 'Central funds'} />
              <Row k="Amount requested" v={fmtMoney(detail.data.amount, s.currency)} />
              <Row k="Amount approved" v={detail.data.amount_approved ? fmtMoney(detail.data.amount_approved, s.currency) : null} />
              <Row k="Amount paid" v={detail.data.amount_paid ? fmtMoney(detail.data.amount_paid, s.currency) : null} />
              <Row k="Paid on" v={detail.data.paid_at ? fmtDate(detail.data.paid_at) : null} />
              <Row k="Account" v={detail.data.account?.name} />
              <Row k="Payee" v={detail.data.payee} />
              <Row k="Category" v={detail.data.category?.name} />
              <Row k="Project" v={detail.data.project?.name} />
              <Row k="Approval route" v={detail.data.workflow ? label(detail.data.workflow.type) : null} />
              <Row k="Why central approval" v={detail.data.workflow?.reason} />
            </div>
            <Attachments items={detail.data.attachments} />
            <div><h3 className="mb-2 text-sm font-semibold">Approval history</h3><Trail approvalId={detail.data.workflow?.id} /></div>
          </div>
        )}
      </Modal>

      <FormModal open={!!pay} onClose={() => setPay(null)} title="Record payment" description="Money leaves the fund's account now. It cannot be overdrawn."
        onSubmit={async () => { await axios.post(`/finance/expenses/${view}/pay`, { amount: Number(pay.amount), paymentMethod: pay.paymentMethod, paymentReference: pay.paymentReference || undefined, paidAt: pay.paidAt }, { withCredentials: true }); toast.push('success', 'Paid'); detail.reload(); list.reload(); }}>
        {pay && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Amount (${s.currency})`} required><Input type="number" min="0" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="Payment method"><MethodSelect value={pay.paymentMethod} onChange={(v) => setPay({ ...pay, paymentMethod: v })} /></Field>
            <Field label="Reference"><Input value={pay.paymentReference} onChange={(e) => setPay({ ...pay, paymentReference: e.target.value })} /></Field>
            <Field label="Date paid"><Input type="date" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} /></Field>
          </div>
        )}
      </FormModal>
    </div>
  );
}
