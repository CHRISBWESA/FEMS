import { useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { Alert, Breadcrumb, Button, Card, ErrorState, Field, Input, PageHeader, PageLoader, Radio, Select, Tabs, Textarea, useToast } from '../components/ui';
import { Attachments, errMsg, fmtDate, fmtMoney, FormModal, label, MemberPicker, openPdf, Row, Status, today, useLoad } from '../fin/common';
import { useInv } from './InventoryArea';
import { conditionOptions, useCatalog } from './Register';

type Dialog = '' | 'assign' | 'endAssign' | 'move' | 'ownership' | 'inspect' | 'maintenance' | 'incident' | 'disposal' | 'stock' | 'return';

export function AssetPage() {
  const { id } = useParams();
  const s = useInv();
  const toast = useToast();
  const { data: a, error, reload } = useLoad<any>(`/inventory/assets/${id}`, [id]);
  const locs = useCatalog('locations');
  const depts = useLoad<any[]>(s.roles.some((r) => ['treasurer', 'secretary', 'assistant_secretary'].includes(r)) ? '/departments' : null, []);
  const [tab, setTab] = useState<'history' | 'assignments' | 'borrowing' | 'maintenance' | 'transfers' | 'cases' | 'stock'>('history');
  const [dlg, setDlg] = useState<Dialog>('');
  const [f, setF] = useState<any>({});
  const [person, setPerson] = useState<{ id: string; name: string } | null>(null);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!a) return <PageLoader rows={3} />;
  const open = (d: Dialog, init: any = {}) => { setF(init); setPerson(null); setDlg(d); };
  const post = (path: string, body: any, ok: string) => async () => { await axios.post(`/inventory/assets/${id}/${path}`, body, { withCredentials: true }); toast.push('success', ok); reload(); };
  const inService = !['disposed', 'lost', 'retired'].includes(a.status);
  const isTreas = s.roles.includes('treasurer');
  const fellowshipAsset = !a.owning_department_id;
  const dn = (did?: string | null) => (did ? a.departmentNames?.[did] ?? 'Department' : 'Fellowship');

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Breadcrumb items={[{ label: 'Resources', to: `${s.base}/inventory` }, { label: a.asset_tag }]} />
      <PageHeader eyebrow={`${a.asset_tag} · ${a.category?.name ?? 'Uncategorised'}`} title={a.name} description={a.description}
        actions={<span className="flex flex-wrap gap-2">
          <Status value={a.status} />
          <Button size="sm" onClick={() => openPdf(`/inventory/assets/${id}/label`).catch((e) => toast.push('error', errMsg(e, 'Could not open the label.')))}>Print label</Button>
          {inService && <Button size="sm" onClick={() => open('maintenance', { description: '' })}>Report a problem</Button>}
          {inService && <Button size="sm" onClick={() => open('incident', { incidentType: 'damaged', description: '' })}>Report loss / damage</Button>}
        </span>} />
      {a.overdueReturn && <Alert tone="danger">This borrowed resource was due back to {a.external_owner_name} on {fmtDate(a.expected_return_date)}.</Alert>}
      {!inService && <Alert tone="info">This resource is {label(a.status)}. Its record and history are kept.</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold">Ownership</h2>
          <Row k="Owner" v={a.ownerLabel} />
          <Row k="Classification" v={label(a.ownership_type)} />
          <Row k="Assigned to" v={a.assignedDepartment?.name ? `${a.assignedDepartment.name} (custody only)` : null} />
          <Row k="How acquired" v={label(a.acquisition_method)} />
          <Row k="Acquired on" v={a.acquisition_date ? fmtDate(a.acquisition_date) : null} />
          <Row k="From" v={a.acquisition_source} />
          <Row k="Donor" v={a.donor_name} />
          <Row k="Donated on" v={a.donation_date ? fmtDate(a.donation_date) : null} />
          <Row k="Borrowed on" v={a.borrowed_on ? fmtDate(a.borrowed_on) : null} />
          <Row k="Due back to owner" v={a.expected_return_date ? fmtDate(a.expected_return_date) : null} />
          <Row k="Returned to owner" v={a.actual_return_date ? fmtDate(a.actual_return_date) : null} />
          <Row k="Purchase price" v={a.acquisition_cost ? fmtMoney(a.acquisition_cost) : null} />
          <Row k="Estimated value" v={a.estimated_value ? fmtMoney(a.estimated_value) : null} />
        </Card>
        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold">Where and with whom</h2>
          <Row k="Location" v={a.location?.name ?? a.storage_location} />
          <Row k="Responsible person" v={a.custodian?.full_name} />
          <Row k="Condition" v={label(a.condition)} />
          <Row k="Last inspected" v={a.last_inspected_at ? fmtDate(a.last_inspected_at) : null} />
          <Row k="Serial number" v={a.serial_number} />
          <Row k="Quantity" v={a.is_consumable ? `${a.quantity} ${a.unit ?? ''}` : a.quantity} />
          <Row k="Reorder at" v={a.reorder_level} />
          {a.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{a.notes}</p>}
        </Card>
        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold">Finance</h2>
          {a.finance.purchase ? <Row k="Purchase" v={`${a.finance.purchase.expense_number ?? ''} · ${fmtMoney(a.finance.purchase.amount_paid ?? a.finance.purchase.amount)} (${label(a.finance.purchase.payment_status)})`} /> : <p className="text-sm text-ink-muted">{a.acquisition_method === 'donation' ? 'Donated: no money was spent.' : a.ownership_type === 'borrowed' ? 'Borrowed: not owned, no purchase.' : 'No purchase expense linked.'}</p>}
          {a.finance.repairs.map((r: any) => <Row key={r.id} k={`Repair ${r.expense_number ?? ''}`} v={`${fmtMoney(r.amount)} · ${r.payment_status === 'paid' ? 'paid' : label(r.approval_status)}`} />)}
          <div className="mt-3"><Attachments items={[...(a.photos ?? []), ...(a.attachments ?? [])]} /></div>
        </Card>
      </div>

      {a.canManage && inService && (
        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold">Manage</h2>
          <div className="flex flex-wrap gap-2">
            {fellowshipAsset && isTreas && !a.is_consumable && (a.assignedDepartment ? <Button size="sm" onClick={() => open('endAssign', { condition: a.condition })}>End assignment</Button> : <Button size="sm" onClick={() => open('assign', { departmentId: '', condition: a.condition, notes: '' })}>Assign to a department</Button>)}
            <Button size="sm" onClick={() => open('move', { toLocationId: '', reason: '' })}>Move / change custodian</Button>
            {a.ownership_type !== 'borrowed' && <Button size="sm" onClick={() => open('ownership', { toOwnership: fellowshipAsset ? 'department' : 'fellowship', toDepartmentId: '', reason: '' })}>Transfer ownership</Button>}
            <Button size="sm" onClick={() => open('inspect', { condition: a.condition, reason: '' })}>Record inspection</Button>
            {a.is_consumable && <Button size="sm" onClick={() => open('stock', { op: 'receive', quantity: '', reason: '', reference: '', toDepartmentId: 'central' })}>Stock in / out</Button>}
            {a.ownership_type === 'borrowed' && !a.actual_return_date && <Button size="sm" onClick={() => open('return', { conditionReturned: a.condition, returnedOn: today() })}>Return to owner</Button>}
            {a.ownership_type !== 'borrowed' && <Button size="sm" variant="danger-quiet" onClick={() => open('disposal', { proposedAction: 'dispose', description: '', disposalMethod: '' })}>Dispose / write off</Button>}
          </div>
        </Card>
      )}

      <Card className="card-pad space-y-3">
        <Tabs tabs={[{ key: 'history', label: 'History' }, { key: 'assignments', label: 'Assignments' }, { key: 'borrowing', label: 'Borrowing' }, { key: 'maintenance', label: 'Maintenance' }, { key: 'transfers', label: 'Transfers' }, { key: 'cases', label: 'Loss & damage' }, ...(a.is_consumable ? [{ key: 'stock' as const, label: 'Stock' }] : [])]} active={tab} onChange={setTab} />
        {tab === 'history' && <ul className="space-y-1 text-sm">{a.history.map((h: any) => <li key={h.id} className="flex justify-between gap-3 border-b border-hairline py-1"><span><span className="font-medium">{label(h.event_type)}</span>{h.note ? ` · ${h.note}` : ''}{h.to_value && !h.note ? ` → ${label(h.to_value)}` : ''}</span><span className="shrink-0 text-xs text-ink-subtle">{new Date(h.occurred_at).toLocaleString()}</span></li>)}</ul>}
        {tab === 'assignments' && (a.assignments.length ? <table className="table w-full text-sm"><thead><tr><th>Department</th><th>Handed over</th><th>Condition</th><th>Ended</th><th>Returned as</th></tr></thead><tbody>{a.assignments.map((x: any) => <tr key={x.id}><td>{dn(x.department_id)}</td><td>{fmtDate(x.handed_over_at)}</td><td>{label(x.condition_at_handover)}</td><td>{x.ended_at ? fmtDate(x.ended_at) : 'current'}</td><td>{x.condition_at_return ? label(x.condition_at_return) : '—'}</td></tr>)}</tbody></table> : <p className="text-sm text-ink-muted">Never assigned.</p>)}
        {tab === 'borrowing' && (a.requests.length ? <table className="table w-full text-sm"><thead><tr><th>Request</th><th>For</th><th>From</th><th>Due</th><th>Status</th><th>Back as</th></tr></thead><tbody>{a.requests.map((r: any) => <tr key={r.id}><td>{r.request_number}</td><td>{dn(r.department_id)}</td><td>{fmtDate(r.needed_from)}</td><td>{fmtDate(r.needed_until)}</td><td><Status value={r.status} /></td><td>{r.condition_in ? label(r.condition_in) : '—'}</td></tr>)}</tbody></table> : <p className="text-sm text-ink-muted">No borrowing yet.</p>)}
        {tab === 'maintenance' && (a.maintenance.length ? <table className="table w-full text-sm"><thead><tr><th>Reported</th><th>Issue</th><th>Technician</th><th>Status</th><th className="text-right">Cost</th></tr></thead><tbody>{a.maintenance.map((m: any) => <tr key={m.id}><td>{fmtDate(m.created_at)}</td><td>{m.description}</td><td>{m.technician ?? m.performed_by ?? '—'}</td><td><Status value={m.status} /></td><td className="text-right">{m.cost ? fmtMoney(m.cost) : m.estimated_cost ? `~${fmtMoney(m.estimated_cost)}` : '—'}</td></tr>)}</tbody></table> : <p className="text-sm text-ink-muted">No maintenance recorded.</p>)}
        {tab === 'transfers' && (a.transfers.length ? <table className="table w-full text-sm"><thead><tr><th>Transfer</th><th>Kind</th><th>From</th><th>To</th><th>Reason</th><th>Status</th></tr></thead><tbody>{a.transfers.map((x: any) => <tr key={x.id}><td>{x.transfer_number}</td><td>{label(x.kind)}</td><td>{x.kind === 'ownership' ? dn(x.from_department_id) : label(x.from_ownership)}</td><td>{x.kind === 'ownership' ? dn(x.to_department_id) : '—'}</td><td>{x.reason}</td><td><Status value={x.status} /></td></tr>)}</tbody></table> : <p className="text-sm text-ink-muted">No transfers.</p>)}
        {tab === 'cases' && (a.incidents.length ? <ul className="space-y-2 text-sm">{a.incidents.map((x: any) => <li key={x.id} className="rounded-control bg-surface-sunken px-3 py-2"><span className="font-medium">{x.incident_number} · {label(x.incident_type)}</span> <Status value={x.status} /><p>{x.description}</p>{x.outcome && <p className="text-ink-muted">Outcome: {x.outcome}</p>}<Attachments items={x.attachments} /></li>)}</ul> : <p className="text-sm text-ink-muted">No loss or damage reported.</p>)}
        {tab === 'stock' && <table className="table w-full text-sm"><thead><tr><th>When</th><th>Movement</th><th className="text-right">Qty</th><th className="text-right">Balance</th><th>Note</th></tr></thead><tbody>{a.stock.map((m: any) => <tr key={m.id}><td>{new Date(m.created_at).toLocaleString()}</td><td>{label(m.kind)}</td><td className={`text-right ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>{m.quantity}</td><td className="text-right">{m.balance_after}</td><td>{m.reason ?? m.reference ?? ''}</td></tr>)}</tbody></table>}
      </Card>

      {/* ---------------- dialogs ---------------- */}
      <FormModal open={dlg === 'assign'} onClose={() => setDlg('')} title="Assign to a department" description="The department gets custody and use; the fellowship stays the owner."
        onSubmit={async () => { await axios.post(`/inventory/assets/${id}/assign`, { ...f, responsibleMemberId: person?.id }, { withCredentials: true }); toast.push('success', 'Assigned'); reload(); }}>
        <Field label="Department" required><Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} placeholder="Choose" options={(depts.data ?? []).map((d: any) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="Responsible person"><MemberPicker value={person} onChange={setPerson} /></Field>
        <Field label="New location"><Select value={f.toLocationId ?? ''} onChange={(e) => setF({ ...f, toLocationId: e.target.value || undefined })} placeholder="Unchanged" options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <Field label="Condition at handover"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} options={conditionOptions} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'endAssign'} onClose={() => setDlg('')} title="End the assignment" onSubmit={post('end-assignment', f, 'Assignment ended')}>
        <Field label="Condition on return"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} options={conditionOptions} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'move'} onClose={() => setDlg('')} title="Move or change custodian" description="Recorded in the transfer history. Ownership does not change."
        onSubmit={post('transfer', { kind: 'location', toLocationId: f.toLocationId || undefined, toCustodianId: person?.id, reason: f.reason }, 'Moved')}>
        <Field label="New location"><Select value={f.toLocationId} onChange={(e) => setF({ ...f, toLocationId: e.target.value })} placeholder="Unchanged" options={(locs.data ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <Field label="New custodian"><MemberPicker value={person} onChange={setPerson} /></Field>
        <Field label="Reason" required><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'ownership'} onClose={() => setDlg('')} title="Transfer ownership" description={fellowshipAsset ? 'Giving a fellowship resource to a department needs the Fellowship Secretary and Chairperson.' : 'A department\'s resource leaves its ownership only with its Chairperson\'s authorization and the Treasurer\'s.'}
        onSubmit={post('transfer', { kind: 'ownership', toOwnership: f.toOwnership, toDepartmentId: f.toOwnership === 'department' ? f.toDepartmentId : undefined, reason: f.reason }, 'Sent for approval')}>
        <div className="flex gap-4">
          {!fellowshipAsset && <Radio name="to" label="To the fellowship" checked={f.toOwnership === 'fellowship'} onChange={() => setF({ ...f, toOwnership: 'fellowship' })} />}
          <Radio name="to" label="To a department" checked={f.toOwnership === 'department'} onChange={() => setF({ ...f, toOwnership: 'department' })} />
        </div>
        {f.toOwnership === 'department' && <Field label="Department" required>{depts.data ? <Select value={f.toDepartmentId} onChange={(e) => setF({ ...f, toDepartmentId: e.target.value })} placeholder="Choose" options={depts.data.filter((d: any) => d.id !== a.owning_department_id).map((d: any) => ({ value: d.id, label: d.name }))} /> : <Input placeholder="Department id" value={f.toDepartmentId} onChange={(e) => setF({ ...f, toDepartmentId: e.target.value })} />}</Field>}
        <Field label="Reason" required><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'inspect'} onClose={() => setDlg('')} title="Record an inspection" onSubmit={post('inspect', f, 'Condition recorded')}>
        <Field label="Condition found"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} options={conditionOptions} /></Field>
        <Field label="Notes" hint="Required for poor or damaged."><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'maintenance'} onClose={() => setDlg('')} title="Report a problem" description="The resource's manager reviews it and arranges the repair."
        onSubmit={post('maintenance', { description: f.description, estimatedCost: f.estimatedCost ? Number(f.estimatedCost) : undefined }, 'Reported')}>
        <Field label="What is wrong" required><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Estimated repair cost"><Input type="number" min="0" value={f.estimatedCost ?? ''} onChange={(e) => setF({ ...f, estimatedCost: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'incident'} onClose={() => setDlg('')} title="Report loss or damage" onSubmit={post('incidents', f, 'Reported')}>
        <Field label="What happened"><Select value={f.incidentType} onChange={(e) => setF({ ...f, incidentType: e.target.value })} options={['damaged', 'lost', 'missing', 'unusable'].map((v) => ({ value: v, label: label(v) }))} /></Field>
        <Field label="Description" required><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="When"><Input type="date" value={f.occurredAt ?? today()} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'disposal'} onClose={() => setDlg('')} title="Dispose or write off" description={fellowshipAsset ? 'The Fellowship Secretary reviews and the Chairperson decides. The record is never deleted.' : 'The Department Chairperson authorizes and the Treasurer confirms; significant disposals also need the Secretary and Chairperson.'}
        onSubmit={post('disposal', f, 'Sent for approval')}>
        <div className="flex gap-4"><Radio name="act" label="Dispose of it" checked={f.proposedAction === 'dispose'} onChange={() => setF({ ...f, proposedAction: 'dispose' })} /><Radio name="act" label="Write it off (lost)" checked={f.proposedAction === 'write_off'} onChange={() => setF({ ...f, proposedAction: 'write_off' })} /></div>
        {f.proposedAction === 'dispose' && <Field label="How"><Input value={f.disposalMethod} onChange={(e) => setF({ ...f, disposalMethod: e.target.value })} placeholder="e.g. sold, scrapped, given away" /></Field>}
        <Field label="Why" required><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'return'} onClose={() => setDlg('')} title={`Return to ${a.external_owner_name ?? 'owner'}`} onSubmit={post('return-to-owner', f, 'Returned')}>
        <Field label="Condition when returned"><Select value={f.conditionReturned} onChange={(e) => setF({ ...f, conditionReturned: e.target.value })} options={conditionOptions} /></Field>
        <Field label="Returned on"><Input type="date" value={f.returnedOn} onChange={(e) => setF({ ...f, returnedOn: e.target.value })} /></Field>
      </FormModal>
      <FormModal open={dlg === 'stock'} onClose={() => setDlg('')} title="Stock movement" description={`In stock: ${a.quantity} ${a.unit ?? ''}. More than is held can never be issued.`}
        onSubmit={async () => {
          const body: any = { quantity: Number(f.quantity), reason: f.reason || undefined, reference: f.reference || undefined };
          if (f.op === 'issue') body.memberId = person?.id;
          if (f.op === 'transfer') body.toDepartmentId = f.toDepartmentId;
          await axios.post(`/inventory/assets/${id}/stock/${f.op}`, body, { withCredentials: true }); toast.push('success', 'Recorded'); reload();
        }}>
        <Field label="Movement"><Select value={f.op} onChange={(e) => setF({ ...f, op: e.target.value })} options={[{ value: 'receive', label: 'Received (stock in)' }, { value: 'issue', label: 'Issued (stock out)' }, { value: 'adjust', label: 'Stock-take correction' }, { value: 'transfer', label: 'Transfer to another store' }]} /></Field>
        <Field label={f.op === 'adjust' ? 'Change (negative to reduce)' : 'Quantity'} required><Input type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        {f.op === 'issue' && <Field label="Issued to"><MemberPicker value={person} onChange={setPerson} /></Field>}
        {f.op === 'transfer' && <Field label="To">{a.owning_department_id ? <Input disabled value="The fellowship store" /> : <Select value={f.toDepartmentId} onChange={(e) => setF({ ...f, toDepartmentId: e.target.value })} placeholder="Choose" options={(depts.data ?? []).map((d: any) => ({ value: d.id, label: d.name }))} />}</Field>}
        {f.op === 'receive' && <Field label="Delivery note / reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
        <Field label="Reason" hint={f.op === 'adjust' ? 'Required for corrections.' : undefined}><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </FormModal>
    </div>
  );
}
