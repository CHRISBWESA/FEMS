import { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Button, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { errMsg, fmtDate, FormModal, label, MemberPicker, Status, useLoad } from '../fin/common';
import { invQuery, useInv } from './InventoryArea';
import { conditionOptions } from './Register';

function useLeaderDepartments() {
  return useLoad<any>('/department-workspace/me', []);
}

export function Requests() {
  const s = useInv();
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const list = useLoad<any[]>(`/inventory/requests?${invQuery(s)}${status ? `&status=${status}` : ''}`, [s.departmentId, status]);
  const me = useLeaderDepartments();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const options = useLoad<any[]>(open ? `/inventory/requestable?search=${encodeURIComponent(search)}` : null, [open, search]);
  const [f, setF] = useState<any>({});
  const [borrower, setBorrower] = useState<{ id: string; name: string } | null>(null);
  const [deny, setDeny] = useState<any>(null);
  const [comment, setComment] = useState('');
  const myDepts: any[] = s.departmentId ? [{ departmentId: s.departmentId, name: s.departmentName }] : me.data?.departments ?? [];
  const decide = async (r: any, decision: string, note?: string) => {
    try { await axios.post(`/inventory/requests/${r.id}/decide`, { decision, comment: note }, { withCredentials: true }); toast.push('success', decision === 'approved' ? 'Approved' : 'Declined'); setDeny(null); setComment(''); list.reload(); }
    catch (e) { toast.push('error', errMsg(e, 'Could not decide.')); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t('inv.nav.requests')} description="Book a resource for an activity or project. The resource's manager approves; double bookings are refused automatically."
        actions={<Button variant="primary" onClick={() => { setF({ assetId: '', departmentId: myDepts[0]?.departmentId ?? '', quantity: 1, purpose: '', neededFrom: '', neededUntil: '', location: '' }); setBorrower(null); setOpen(true); }}><PlusIcon className="h-4 w-4" /> Request a resource</Button>} />
      <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'PENDING', label: 'Waiting for approval' }, { value: 'APPROVED', label: 'Approved' }, { value: '', label: 'All' }, { value: 'REJECTED', label: 'Declined' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
      <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'No requests' }}
        columns={[
          { key: 'n', header: 'Request', render: (r: any) => r.request_number, priority: 'primary' },
          { key: 'a', header: 'Resource', render: (r: any) => (r.asset ? <Link className="text-primary hover:underline" to={`${s.base}/assets/${r.asset.id}`}>{r.asset.name}</Link> : '—') },
          { key: 'd', header: 'For', render: (r: any) => r.departmentName },
          { key: 'p', header: 'Purpose', render: (r: any) => r.purpose, priority: 'meta' },
          { key: 'w', header: 'When', render: (r: any) => `${fmtDate(r.needed_from)} – ${fmtDate(r.needed_until)}` },
          { key: 'q', header: 'Qty', align: 'right', render: (r: any) => r.quantity },
          { key: 's', header: 'Status', render: (r: any) => <Status value={r.status} /> },
        ]}
        rowActions={(r: any) => (
          <span className="inline-flex gap-1">
            {r.canDecide && <><Button size="sm" variant="primary" onClick={() => decide(r, 'approved')}>Approve</Button><Button size="sm" onClick={() => setDeny(r)}>Decline</Button></>}
            {['PENDING', 'APPROVED'].includes(r.status) && <Button size="sm" variant="ghost" onClick={async () => { try { await axios.post(`/inventory/requests/${r.id}/cancel`, {}, { withCredentials: true }); list.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not cancel.')); } }}>Cancel</Button>}
          </span>
        )} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Request a resource" width="lg"
        onSubmit={async () => { await axios.post('/inventory/requests', { ...f, quantity: Number(f.quantity), departmentId: f.departmentId || undefined, borrowerMemberId: borrower?.id }, { withCredentials: true }); toast.push('success', 'Request sent'); list.reload(); }}>
        <Field label="Find the resource"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name" /></Field>
        <Field label="Resource" required><Select value={f.assetId} onChange={(e) => setF({ ...f, assetId: e.target.value })} placeholder="Choose" options={(options.data ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.asset_tag})${x.quantity > 1 ? ` · ${x.quantity} available in total` : ''}` }))} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="For"><Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} placeholder={s.roles.some((r) => ['treasurer', 'secretary', 'chairperson'].includes(r)) ? 'The fellowship' : undefined} options={myDepts.map((d: any) => ({ value: d.departmentId, label: d.name }))} /></Field>
          <Field label="Quantity"><Input type="number" min="1" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Needed from" required><Input type="datetime-local" value={f.neededFrom} onChange={(e) => setF({ ...f, neededFrom: e.target.value })} /></Field>
          <Field label="Back by" required><Input type="datetime-local" value={f.neededUntil} onChange={(e) => setF({ ...f, neededUntil: e.target.value })} /></Field>
          <Field label="Where it will be used"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Borrower (member)"><MemberPicker value={borrower} onChange={setBorrower} /></Field>
        </div>
        <Field label="Purpose" required><Textarea rows={2} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      </FormModal>
      <Modal open={!!deny} onClose={() => setDeny(null)} title="Decline request" footer={<><Button onClick={() => setDeny(null)}>Cancel</Button><Button variant="danger" disabled={!comment.trim()} onClick={() => decide(deny, 'rejected', comment)}>Decline</Button></>}>
        <Field label="Reason" required><Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

export function Borrowing() {
  const s = useInv();
  const { t } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<'out' | 'ready' | 'overdue' | 'done'>('out');
  const q = tab === 'out' ? 'status=ISSUED' : tab === 'ready' ? 'status=APPROVED' : tab === 'overdue' ? 'overdue=true' : 'status=RETURNED';
  const list = useLoad<any[]>(`/inventory/requests?${invQuery(s)}&${q}`, [s.departmentId, q]);
  const partial = useLoad<any[]>(tab === 'out' ? `/inventory/requests?${invQuery(s)}&status=PARTIALLY_RETURNED` : null, [s.departmentId, tab]);
  const rows = [...(list.data ?? []), ...(tab === 'out' ? partial.data ?? [] : [])];
  const [ret, setRet] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.push('success', ok); list.reload(); partial.reload(); } catch (e) { toast.push('error', errMsg(e, 'Could not complete that.')); } };
  return (
    <div className="space-y-4">
      <PageHeader title={t('inv.nav.borrowing')} description="Handover and return of approved requests. A resource out with someone cannot be handed to someone else; damaged returns open a damage case." />
      <Tabs tabs={[{ key: 'out', label: 'Out now' }, { key: 'ready', label: 'Ready to hand over' }, { key: 'overdue', label: 'Overdue' }, { key: 'done', label: 'Returned' }]} active={tab} onChange={setTab} />
      <DataTable rows={rows} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        empty={{ title: 'Nothing here' }}
        columns={[
          { key: 'n', header: 'Request', render: (r: any) => r.request_number, priority: 'primary' },
          { key: 'a', header: 'Resource', render: (r: any) => r.asset?.name },
          { key: 'd', header: 'With', render: (r: any) => r.departmentName },
          { key: 'u', header: 'Due back', render: (r: any) => <span className={r.overdue ? 'text-danger' : ''}>{fmtDate(r.needed_until)}</span> },
          { key: 'q', header: 'Returned', align: 'right', render: (r: any) => `${r.quantity_returned} / ${r.quantity}` },
          { key: 's', header: 'Status', render: (r: any) => <span className="inline-flex gap-1"><Status value={r.status} />{r.overdue && <Status value="overdue" />}</span> },
        ]}
        rowActions={(r: any) => (r.canHandle ? (
          <span className="inline-flex gap-1">
            {r.status === 'APPROVED' && <Button size="sm" variant="primary" onClick={() => act(() => axios.post(`/inventory/requests/${r.id}/issue`, {}, { withCredentials: true }), 'Handed over')}>Hand over</Button>}
            {['ISSUED', 'PARTIALLY_RETURNED'].includes(r.status) && <>
              <Button size="sm" variant="primary" onClick={() => { setRet(r); setF({ quantity: r.quantity - r.quantity_returned, condition: 'good', notes: '' }); }}>Record return</Button>
              <Button size="sm" variant="danger-quiet" onClick={() => { const d = window.prompt('What happened? It will open a loss case.'); if (d) act(() => axios.post(`/inventory/requests/${r.id}/lost`, { description: d }, { withCredentials: true }), 'Reported lost'); }}>Lost</Button>
            </>}
          </span>
        ) : null)} />
      <FormModal open={!!ret} onClose={() => setRet(null)} title={`Return ${ret?.asset?.name ?? ''}`} description="Part of a multi-item loan can come back now and the rest later."
        onSubmit={async () => { await axios.post(`/inventory/requests/${ret.id}/return`, { ...f, quantity: Number(f.quantity) }, { withCredentials: true }); toast.push('success', 'Return recorded'); list.reload(); partial.reload(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quantity returned"><Input type="number" min="1" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Condition"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} options={conditionOptions} /></Field>
        </div>
        <Field label="Notes" hint="Describe any damage."><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </FormModal>
    </div>
  );
}

export function Transfers() {
  const s = useInv();
  const { t } = useI18n();
  const list = useLoad<any[]>('/inventory/transfers', []);
  const assigned = useLoad<any>(`/inventory/assets?status=assigned&limit=200&${invQuery(s)}`, [s.departmentId]);
  const [tab, setTab] = useState<'assignments' | 'transfers'>('assignments');
  return (
    <div className="space-y-4">
      <PageHeader title={t('inv.nav.transfers')} description="Assignments give a department custody of a fellowship resource without changing ownership. Ownership transfers need authorization and are kept in full." />
      <Tabs tabs={[{ key: 'assignments', label: 'Current assignments' }, { key: 'transfers', label: 'Transfers' }]} active={tab} onChange={setTab} />
      {tab === 'assignments' ? (
        <DataTable rows={assigned.data?.data} loading={assigned.loading && !assigned.data} error={assigned.error || null} onRetry={assigned.reload} rowKey={(r: any) => r.id}
          empty={{ title: 'Nothing is assigned' }}
          columns={[
            { key: 't', header: 'Tag', render: (r: any) => <Link className="text-primary hover:underline" to={`${s.base}/assets/${r.id}`}>{r.asset_tag}</Link>, priority: 'primary' },
            { key: 'n', header: 'Resource', render: (r: any) => r.name },
            { key: 'd', header: 'Assigned to', render: (r: any) => r.assignedDepartment?.name },
            { key: 'c', header: 'Responsible', render: (r: any) => r.custodian?.full_name ?? '—' },
            { key: 'o', header: 'Owner', render: () => 'Fellowship' },
          ]} />
      ) : (
        <DataTable rows={list.data} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
          empty={{ title: 'No transfers' }}
          columns={[
            { key: 'n', header: 'Transfer', render: (r: any) => r.transfer_number, priority: 'primary' },
            { key: 'd', header: 'Date', render: (r: any) => fmtDate(r.transfer_date) },
            { key: 'k', header: 'Kind', render: (r: any) => label(r.kind) },
            { key: 'f', header: 'Ownership', render: (r: any) => (r.kind === 'ownership' ? `${label(r.from_ownership)} → ${label(r.to_ownership)}` : 'unchanged') },
            { key: 'r', header: 'Reason', render: (r: any) => r.reason, priority: 'meta' },
            { key: 'a', header: 'Resource', render: (r: any) => <Link className="text-primary hover:underline" to={`${s.base}/assets/${r.asset_id}`}>Open</Link> },
            { key: 's', header: 'Status', render: (r: any) => <Status value={r.status} /> },
          ]} />
      )}
      <p className="text-xs text-ink-subtle">Ownership transfers waiting for you appear in Finance → Approvals together with your other approvals.</p>
    </div>
  );
}
