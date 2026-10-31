import { useState } from 'react';
import axios from 'axios';
import { PlusIcon, DocumentTextIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button, Field, Input, PageHeader, Radio, Select, Textarea, useToast, Modal } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import {
  AccountSelect, Attachment, AttachmentPicker, CategorySelect, errMsg, fmtDate, fmtMoney, FormModal, label, MemberPicker,
  MethodSelect, openPdf, ProjectSelect, Row, scopeQuery, Status, today, useFin, useLoad,
} from './common';

const isChair = (s: ReturnType<typeof useFin>) => s.leaderRole === 'department_chairperson';
const canRecordCentral = (s: ReturnType<typeof useFin>) => s.roles.some((r) => ['treasurer', 'secretary'].includes(r));

function useCampaigns() {
  const s = useFin();
  return useLoad<any[]>(`/finance/campaigns?status=active&${scopeQuery(s)}`, [s.departmentId]);
}

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
  const campaigns = useCampaigns();
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

  const start = () => { setType('member'); setMember(null); setF({ amount: '', date: today(), paymentMethod: 'cash', accountId: '', categoryId: '', campaignId: '', paymentReference: '', notes: '' }); setAlloc([]); setFiles([]); setOpen(true); };
  const save = async () => {
    const r = await axios.post('/finance/contributions', {
      departmentId: s.departmentId ?? undefined, contributorType: type, memberId: type === 'member' ? member?.id : undefined,
      contributorName: type === 'external' ? f.contributorName : undefined, contributorPhone: type === 'external' ? f.contributorPhone : undefined,
      amount: Number(f.amount), date: f.date, paymentMethod: f.paymentMethod, paymentReference: f.paymentReference || undefined,
      accountId: f.accountId || undefined, categoryId: f.categoryId || undefined, campaignId: f.campaignId || undefined, notes: f.notes || undefined,
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
            {r.status === 'active' && canRecord && !r.pledge_id && <Button size="sm" variant="ghost" onClick={() => { setAllocFor(r); setAlloc((r.allocations ?? []).map((a: any) => ({ projectId: a.project.id, amount: String(a.amount) }))); }}>Allocate</Button>}
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
          <Field label="Received into"><AccountSelect value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} /></Field>
          {!s.departmentId && <Field label="Category"><CategorySelect kind="contribution" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} /></Field>}
          <Field label="Campaign"><Select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })} placeholder="No campaign" options={(campaigns.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
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

// ------------------------------------------------------------------ income

export function Income() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const list = useLoad<any[]>(`/finance/income?${scopeQuery(s)}&limit=200`, [s.departmentId]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({});
  const canRecord = s.departmentId ? !!s.leaderRole : s.roles.some((r) => ['treasurer', 'secretary'].includes(r));
  const [reverseFor, setReverseFor] = useState<any>(null);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.income')} description="Grants, sponsorships and organisational donations. A payment is either a contribution or income, never both. Transfers are not income."
        actions={canRecord ? <Button variant="primary" onClick={() => { setF({ title: '', amount: '', date: today(), source: '', fundingSource: 'grant', projectId: '', accountId: '', categoryId: '', paymentMethod: 'bank_transfer', paymentReference: '' }); setOpen(true); }}><PlusIcon className="h-4 w-4" /> {t('fin.record')}</Button> : undefined} />
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id} clientPaging pageSize={25}
        empty={{ title: 'No other income recorded' }}
        columns={[
          { key: 'n', header: 'Receipt', render: (r: any) => r.receipt_number ?? '—', priority: 'primary' },
          { key: 'd', header: 'Date', render: (r: any) => fmtDate(r.date) },
          { key: 't', header: 'Title', render: (r: any) => r.title },
          { key: 's', header: 'Source', render: (r: any) => [label(r.funding_source), r.source].filter((x) => x && x !== '—').join(' · ') || '—' },
          { key: 'a', header: 'Account', render: (r: any) => r.account?.name ?? '—', priority: 'meta' },
          { key: 'amt', header: 'Amount', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount, s.currency) },
          { key: 'st', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]}
        rowActions={(r: any) => (!s.departmentId && r.status === 'active' && canRecord ? <Button size="sm" variant="ghost" onClick={() => setReverseFor(r)}>Request reversal</Button> : null)}
      />
      <FormModal open={open} onClose={() => setOpen(false)} title="Record income" width="lg"
        onSubmit={async () => {
          await axios.post('/finance/income', { scope: s.departmentId ? 'department' : undefined, departmentId: s.departmentId ?? undefined, title: f.title, amount: Number(f.amount), date: f.date, source: f.source || undefined, fundingSource: f.fundingSource || undefined, projectId: f.projectId || undefined, accountId: f.accountId || undefined, categoryId: f.categoryId || undefined, paymentMethod: f.paymentMethod, paymentReference: f.paymentReference || undefined }, { withCredentials: true });
          toast.push('success', 'Income recorded'); list.reload();
        }}>
        <Field label="Title" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${s.currency})`} required><Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Kind of income"><Select value={f.fundingSource} onChange={(e) => setF({ ...f, fundingSource: e.target.value })} options={['grant', 'sponsorship', 'organisational_donation', 'fundraising', 'other'].map((v) => ({ value: v, label: label(v) }))} /></Field>
          <Field label="From (organisation)"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
          <Field label="Project"><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
          <Field label="Received into"><AccountSelect value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} /></Field>
          <Field label="Payment method"><MethodSelect value={f.paymentMethod} onChange={(v) => setF({ ...f, paymentMethod: v })} /></Field>
          <Field label="Payment reference"><Input value={f.paymentReference} onChange={(e) => setF({ ...f, paymentReference: e.target.value })} /></Field>
          {!s.departmentId && <Field label="Category"><CategorySelect kind="income" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} /></Field>}
        </div>
      </FormModal>
      <Modal open={!!reverseFor} onClose={() => setReverseFor(null)} title="Request a reversal" description="The Secretary and the Chairperson must approve it. Nothing is deleted."
        footer={<><Button onClick={() => setReverseFor(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} onClick={async () => { try { await axios.post(`/finance/income/${reverseFor.id}/delete-request`, { reason }, { withCredentials: true }); toast.push('success', 'Reversal request sent'); setReverseFor(null); setReason(''); } catch (e) { toast.push('error', errMsg(e, 'Could not send.')); } }}>Send request</Button></>}>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ pledges

export function Pledges() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const list = useLoad<any[]>(`/finance/pledges?${scopeQuery(s)}&limit=200${status ? `&status=${status}` : ''}`, [s.departmentId, status]);
  const campaigns = useCampaigns();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'member' | 'external' | 'anonymous'>('member');
  const [member, setMember] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState<any>({});
  const [pay, setPay] = useState<any>(null);
  const [pf, setPf] = useState<any>({});
  const [view, setView] = useState<string | null>(null);
  const detail = useLoad<any>(view ? `/finance/pledges/${view}` : null, [view]);
  const canManage = s.departmentId ? !!s.leaderRole : s.roles.some((r) => ['treasurer', 'secretary'].includes(r));

  return (
    <div className="space-y-4">
      <PageHeader title={t('fin.nav.pledges')} description="Promises to give. A pledge is not money: each payment towards it is recorded as a contribution with its own receipt."
        actions={canManage ? <Button variant="primary" onClick={() => { setType('member'); setMember(null); setF({ amount: '', dueDate: '', projectId: '', campaignId: '', notes: '' }); setOpen(true); }}><PlusIcon className="h-4 w-4" /> New pledge</Button> : undefined} />
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id} clientPaging pageSize={25}
        toolbar={<Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'partially_fulfilled', label: 'Partly paid' }, { value: 'overdue', label: 'Overdue' }, { value: 'fulfilled', label: 'Fulfilled' }]} />}
        empty={{ title: 'No pledges' }}
        columns={[
          { key: 'n', header: 'Pledge', render: (r: any) => <button className="font-medium text-primary hover:underline" onClick={() => setView(r.id)}>{r.pledge_number ?? '(recurring)'}</button>, priority: 'primary' },
          { key: 'w', header: 'Pledged by', render: (r: any) => r.contributor ?? '—' },
          { key: 'c', header: 'For', render: (r: any) => r.campaign?.name ?? (r.project_id ? 'Project' : 'General'), priority: 'meta' },
          { key: 'd', header: 'Due', render: (r: any) => fmtDate(r.due_date) },
          { key: 'a', header: 'Pledged', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount, s.currency) },
          { key: 'p', header: 'Paid', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.amount_fulfilled, s.currency) },
          { key: 'o', header: 'Outstanding', align: 'right', tabular: true, render: (r: any) => fmtMoney(r.outstanding, s.currency) },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.displayStatus ?? r.status} /> },
        ]}
        rowActions={(r: any) => (canManage && r.pledge_number && ['pending', 'partially_fulfilled'].includes(r.status) ? <Button size="sm" variant="ghost" onClick={() => { setPay(r); setPf({ amount: r.outstanding, date: today(), paymentMethod: 'cash', accountId: '', paymentReference: '' }); }}>Record payment</Button> : null)}
      />

      <FormModal open={open} onClose={() => setOpen(false)} title="New pledge" width="lg"
        onSubmit={async () => {
          await axios.post('/finance/pledges', { departmentId: s.departmentId ?? undefined, contributorType: type, memberId: type === 'member' ? member?.id : undefined, contributorName: type === 'external' ? f.contributorName : undefined, contributorPhone: type === 'external' ? f.contributorPhone : undefined, amount: Number(f.amount), dueDate: f.dueDate || undefined, projectId: f.projectId || undefined, campaignId: f.campaignId || undefined, notes: f.notes || undefined }, { withCredentials: true });
          toast.push('success', 'Pledge recorded'); list.reload();
        }}>
        <div className="flex flex-wrap gap-4">
          <Radio name="ptype" label="Registered member" checked={type === 'member'} onChange={() => setType('member')} />
          <Radio name="ptype" label="Someone else" checked={type === 'external'} onChange={() => setType('external')} />
          <Radio name="ptype" label="Anonymous" checked={type === 'anonymous'} onChange={() => setType('anonymous')} />
        </div>
        {type === 'member' && <Field label="Member" required><MemberPicker value={member} onChange={setMember} /></Field>}
        {type === 'external' && <div className="grid gap-4 sm:grid-cols-2"><Field label="Name" required><Input value={f.contributorName ?? ''} onChange={(e) => setF({ ...f, contributorName: e.target.value })} /></Field><Field label="Phone"><Input value={f.contributorPhone ?? ''} onChange={(e) => setF({ ...f, contributorPhone: e.target.value })} /></Field></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Total pledged (${s.currency})`} required><Input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Expected by"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Project"><ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v })} /></Field>
          <Field label="Campaign"><Select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })} placeholder="No campaign" options={(campaigns.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </FormModal>

      <FormModal open={!!pay} onClose={() => setPay(null)} title={`Payment towards ${pay?.pledge_number ?? ''}`} description={`Outstanding: ${fmtMoney(pay?.outstanding, s.currency)}. Anything above that is recorded as an additional contribution on the same receipt.`}
        submitLabel="Record and print receipt"
        onSubmit={async () => {
          const r = await axios.post(`/finance/pledges/${pay.id}/payments`, { amount: Number(pf.amount), date: pf.date, paymentMethod: pf.paymentMethod, accountId: pf.accountId || undefined, paymentReference: pf.paymentReference || undefined }, { withCredentials: true });
          toast.push('success', `Payment recorded. Receipt ${r.data.receipt_number}`); list.reload();
          openPdf(`/finance/contributions/${r.data.id}/receipt?format=pdf`).catch(() => {});
        }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount (${s.currency})`} required><Input type="number" min="0" step="0.01" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} /></Field>
          <Field label="Date" required><Input type="date" value={pf.date} onChange={(e) => setPf({ ...pf, date: e.target.value })} /></Field>
          <Field label="Payment method"><MethodSelect value={pf.paymentMethod} onChange={(v) => setPf({ ...pf, paymentMethod: v })} /></Field>
          <Field label="Received into"><AccountSelect value={pf.accountId} onChange={(v) => setPf({ ...pf, accountId: v })} /></Field>
          <Field label="Payment reference"><Input value={pf.paymentReference} onChange={(e) => setPf({ ...pf, paymentReference: e.target.value })} /></Field>
        </div>
      </FormModal>

      <Modal open={!!view} onClose={() => setView(null)} title={detail.data?.pledge_number ?? 'Pledge'} width="lg"
        footer={detail.data && canManage && ['pending', 'partially_fulfilled'].includes(detail.data.status) ? <Button variant="danger-quiet" onClick={async () => { const reason = window.prompt('Why is this pledge being cancelled?'); if (!reason) return; try { await axios.post(`/finance/pledges/${view}/cancel`, { reason }, { withCredentials: true }); detail.reload(); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not cancel.')); } }}>Cancel pledge</Button> : undefined}>
        {detail.data && (
          <div className="space-y-4">
            <div>
              <Row k="Pledged by" v={detail.data.contributor} />
              <Row k="Project" v={detail.data.project?.name} />
              <Row k="Campaign" v={detail.data.campaign?.name} />
              <Row k="Pledged" v={fmtMoney(detail.data.amount, s.currency)} />
              <Row k="Paid" v={fmtMoney(detail.data.amount_fulfilled, s.currency)} />
              <Row k="Outstanding" v={fmtMoney(detail.data.outstanding, s.currency)} />
              <Row k="Due" v={fmtDate(detail.data.due_date)} />
              <Row k="Status" v={<Status value={detail.data.displayStatus} />} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Payments</h3>
              {detail.data.payments.length === 0 ? <p className="text-sm text-ink-muted">No payments yet.</p> : (
                <ul className="divide-y divide-hairline text-sm">
                  {detail.data.payments.map((p: any) => (
                    <li key={p.id} className="flex justify-between py-1.5"><span>{p.receipt_number} · {fmtDate(p.date)} <Status value={p.status} /></span><span>{fmtMoney(p.pledge_applied, s.currency)}{Number(p.additional) > 0 ? ` + ${fmtMoney(p.additional)} extra` : ''}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
