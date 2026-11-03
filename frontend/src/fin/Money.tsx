import { useState } from 'react';
import axios from 'axios';
import { PlusIcon, DocumentTextIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button, Field, Input, PageHeader, Radio, Select, Textarea, useToast, Modal } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import {
  APPROVAL_TYPES, Attachment, AttachmentPicker, CategorySelect, errMsg, fmtDate, fmtMoney, FormModal, MemberPicker,
  MethodSelect, openPdf, PendingApprovals, ProjectSelect, scopeQuery, Status, today, useFin, useLoad,
} from './common';

const isChair = (s: ReturnType<typeof useFin>) => s.leaderRole === 'department_chairperson';
const canRecordCentral = (s: ReturnType<typeof useFin>) => s.roles.some((r) => ['treasurer', 'secretary'].includes(r));

function Allocations({ value, onChange }: { value: { projectId: string; amount: string }[]; onChange: (v: { projectId: string; amount: string }[]) => void }) {
  return (
    <div className="space-y-2">
      <p className="label">Project allocations <span className="font-normal text-ink-subtle">(optional; the rest stays general)</span></p>
      {value.map((a, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex-1"><ProjectSelect value={a.projectId} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, projectId: v } : x)))} placeholder="Choose a project" /></div>
          <Input className="w-32" type="number" min="0" step="0.01" placeholder="Amount" value={a.amount} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="sm" aria-label="Remove allocation" onClick={() => onChange(value.filter((_, j) => j !== i))}><TrashIcon className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button type="button" size="sm" onClick={() => onChange([...value, { projectId: '', amount: '' }])}><PlusIcon className="h-4 w-4" /> Add project</Button>
    </div>
  );
}

const cleanAlloc = (list: { projectId: string; amount: string }[]) => list.filter((a) => a.projectId && a.amount).map((a) => ({ projectId: a.projectId, amount: Number(a.amount) }));

// ------------------------------------------------------------------ contributions

export function Contributions() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const list = useLoad<any[]>(`/finance/contributions?${scopeQuery(s)}&limit=200${search ? `&search=${encodeURIComponent(search)}` : ''}${status ? `&status=${status}` : ''}`, [s.departmentId, search, status]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'member' | 'external' | 'anonymous'>('member');
  const [member, setMember] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState<any>({});
  const [alloc, setAlloc] = useState<{ projectId: string; amount: string }[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [allocFor, setAllocFor] = useState<any>(null);
  const [reverseFor, setReverseFor] = useState<any>(null);
  const [reason, setReason] = useState('');
  const canRecord = s.departmentId ? !!s.leaderRole : canRecordCentral(s);

  const start = () => { setType('member'); setMember(null); setF({ amount: '', date: today(), paymentMethod: 'cash', accountId: '', categoryId: '', paymentReference: '', notes: '' }); setAlloc([]); setFiles([]); setOpen(true); };
  const save = async () => {
    const r = await axios.post('/finance/contributions', {
      departmentId: s.departmentId ?? undefined, contributorType: type, memberId: type === 'member' ? member?.id : undefined,
      contributorName: type === 'external' ? f.contributorName : undefined, contributorPhone: type === 'external' ? f.contributorPhone : undefined,
      amount: Number(f.amount), date: f.date, paymentMethod: f.paymentMethod, paymentReference: f.paymentReference || undefined,
      accountId: f.accountId || undefined, categoryId: f.categoryId || undefined, notes: f.notes || undefined,
      allocations: cleanAlloc(alloc), attachments: files,
    }, { withCredentials: true });
    toast.push('success', `Recorded. Receipt ${r.data.receipt_number}`);
    list.reload();
    openPdf(`/finance/contributions/${r.data.id}/receipt?format=pdf`).catch(() => {});
  };

  const reverse = async () => {
    try {
      if (s.departmentId) await axios.post(`/finance/contributions/${reverseFor.id}/reverse`, { reason }, { withCredentials: true });
      else await axios.post(`/finance/contributions/${reverseFor.id}/delete-request`, { reason }, { withCredentials: true });
      toast.push('success', s.departmentId ? 'Reversed' : 'Reversal request sent for approval');
      setReverseFor(null); setReason(''); list.reload();
    } catch (e) { toast.push('error', errMsg(e, 'Could not reverse.')); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.contributions')} description="Money received. Each payment has one receipt and is counted once, even when it is split between projects."
        actions={canRecord ? <Button variant="primary" onClick={start}><PlusIcon className="h-4 w-4" /> {t('fin.record')}</Button> : undefined} />
      <PendingApprovals types={APPROVAL_TYPES.contributions} departmentId={s.departmentId} onDone={list.reload} />
      <DataTable
        rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id} clientPaging pageSize={25}
        search={{ value: search, onChange: setSearch, placeholder: 'Receipt number or contributor' }}
        toolbar={<Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Active' }, { value: 'reversed', label: 'Reversed' }]} />}
        empty={{ title: 'No contributions yet', description: canRecord ? 'Record the first payment received.' : undefined }}
        columns={[
          { key: 'receipt', header: 'Receipt', render: (r: any) => <span className="font-medium">{r.receipt_number}</span>, priority: 'primary' },
          { key: 'date', header: 'Date', render: (r: any) => fmtDate(r.date) },
          { key: 'from', header: 'From', render: (r: any) => (r.contributor_type === 'anonymous' ? <em>Anonymous</em> : r.member?.full_name ?? r.contributor_name) },
          { key: 'purpose', header: 'For', render: (r: any) => r.category?.name ?? r.contribution_type },
          { key: 'alloc', header: 'Projects', render: (r: any) => (r.allocations?.length ? r.allocations.map((a: any) => a.project.name).join(', ') : <span className="text-ink-subtle">General</span>), priority: 'meta' },
          { key: 'account', header: 'Account', render: (r: any) => r.account?.name ?? '—', priority: 'meta' },
          { key: 'amount', header: 'Amount', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount, s.currency) },
          { key: 'status', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]}
        rowActions={(r: any) => (
          <span className="inline-flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => openPdf(`/finance/contributions/${r.id}/receipt?format=pdf`).catch((e) => toast.push('error', errMsg(e, 'Could not open the receipt.')))}><DocumentTextIcon className="h-4 w-4" /> Receipt</Button>
            {r.status === 'active' && canRecord && <Button size="sm" variant="ghost" onClick={() => { setAllocFor(r); setAlloc((r.allocations ?? []).map((a: any) => ({ projectId: a.project.id, amount: String(a.amount) }))); }}>Allocate</Button>}
            {r.status === 'active' && (s.departmentId ? isChair(s) : canRecordCentral(s)) && <Button size="sm" variant="ghost" onClick={() => setReverseFor(r)}>Reverse</Button>}
          </span>
        )}
      />

      <FormModal open={open} onClose={() => setOpen(false)} title="Record a contribution" onSubmit={save} submitLabel="Record and print receipt" width="lg">
        <fieldset className="space-y-2">
          <legend className="label">Who gave</legend>
          <div className="flex flex-wrap gap-4">
            <Radio name="ctype" label="Registered member" checked={type === 'member'} onChange={() => setType('member')} />
            <Radio name="ctype" label="Someone else" checked={type === 'external'} onChange={() => setType('external')} />
            <Radio name="ctype" label="Anonymous" checked={type === 'anonymous'} onChange={() => setType('anonymous')} />
          </div>
        </fieldset>
        {type === 'member' && <Field label="Member" required><MemberPicker value={member} onChange={setMember} /></Field>}
        {type === 'external' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required><Input value={f.contributorName ?? ''} onChange={(e) => setF({ ...f, contributorName: e.target.value })} /></Field>
            <Field label="Phone"><Input value={f.contributorPhone ?? ''} onChange={(e) => setF({ ...f, contributorPhone: e.target.value })} /></Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${s.currency})`} required><Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date received" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Payment method"><MethodSelect value={f.paymentMethod} onChange={(v) => setF({ ...f, paymentMethod: v })} /></Field>
          <Field label="Payment reference" hint="Mobile money or bank reference. The same reference cannot be recorded twice."><Input value={f.paymentReference} onChange={(e) => setF({ ...f, paymentReference: e.target.value })} /></Field>
          {!s.departmentId && <Field label="Category"><CategorySelect kind="contribution" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} /></Field>}
        </div>
        <Allocations value={alloc} onChange={setAlloc} />
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <AttachmentPicker value={files} onChange={setFiles} label="Supporting documents" />
      </FormModal>

      <FormModal open={!!allocFor} onClose={() => setAllocFor(null)} title={`Allocate ${allocFor?.receipt_number ?? ''}`} description={`Contribution of ${fmtMoney(allocFor?.amount, s.currency)}. The allocations may not exceed it; previous allocations are kept in the history.`}
        onSubmit={async () => { await axios.put(`/finance/contributions/${allocFor.id}/allocations`, { allocations: cleanAlloc(alloc), reason: 'Allocation updated' }, { withCredentials: true }); toast.push('success', 'Allocations saved'); list.reload(); }}>
        <Allocations value={alloc} onChange={setAlloc} />
      </FormModal>

      <Modal open={!!reverseFor} onClose={() => setReverseFor(null)} title={s.departmentId ? 'Reverse contribution' : 'Request a reversal'}
        description={s.departmentId ? 'The money is taken back out of the account with a reversal entry. Nothing is deleted.' : 'The Secretary and the Chairperson must approve the reversal. Nothing is deleted.'}
        footer={<><Button onClick={() => setReverseFor(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} onClick={reverse}>{s.departmentId ? 'Reverse' : 'Send request'}</Button></>}>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
