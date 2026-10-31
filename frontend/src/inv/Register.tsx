import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Button, Field, Input, PageHeader, Radio, Select, Textarea, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { useI18n } from '../context/I18nContext';
import { Attachment, AttachmentPicker, fmtMoney, FormModal, label, MemberPicker, Status, today, useLoad } from '../fin/common';
import { canManageScope, isTreasurer, useInv } from './InventoryArea';

export const CONDITIONS = ['new', 'excellent', 'good', 'fair', 'poor', 'damaged', 'under_repair'];
export const conditionOptions = CONDITIONS.map((c) => ({ value: c, label: label(c) }));
const OWNERSHIP = [
  { value: 'fellowship', label: 'Fellowship-owned', hint: 'Bought or acquired by the whole fellowship (central funds).' },
  { value: 'department', label: 'Department-owned', hint: 'Bought with the department\'s own money or belonging only to it.' },
  { value: 'donated', label: 'Donated', hint: 'Given to the fellowship or a department. Not recorded as cash.' },
  { value: 'borrowed', label: 'Borrowed from outside', hint: 'Belongs to someone else; must be returned. Not counted as owned.' },
];

export function useCatalog(kind: 'categories' | 'locations') {
  return useLoad<any[]>(`/inventory/${kind}`, [kind]);
}

/** Purchase expenses that can be linked: paid or approved expenses of the right fund. */
function useExpenses() {
  const s = useInv();
  return useLoad<any[]>(`/finance/expenses?${s.departmentId ? `departmentId=${s.departmentId}` : 'departmentId=central'}&limit=200`, [s.departmentId]);
}

export function RegisterModal({ open, onClose, onSaved, consumable = false }: { open: boolean; onClose: () => void; onSaved: (a: any) => void; consumable?: boolean }) {
  const s = useInv();
  const cats = useCatalog('categories');
  const locs = useCatalog('locations');
  const exps = useExpenses();
  const settings = useLoad<any>('/inventory/settings', []);
  const [f, setF] = useState<any>({});
  const [custodian, setCustodian] = useState<{ id: string; name: string } | null>(null);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [docs, setDocs] = useState<Attachment[]>([]);
  const ownershipChoices = OWNERSHIP.filter((o) => (s.departmentId ? o.value !== 'fellowship' : o.value !== 'department'));
  const reset = () => { setF({ ownershipType: s.departmentId ? 'department' : 'fellowship', name: '', condition: 'good', quantity: consumable ? '0' : '1', isConsumable: consumable, unit: consumable ? 'piece' : '', acquisitionDate: today() }); setCustodian(null); setPhotos([]); setDocs([]); };
  useEffect(() => { if (open) reset(); }, [open]);
  const o = f.ownershipType;
  return (
    <FormModal open={open} onClose={() => { onClose(); setF({}); }} title={consumable ? 'Add a stock item' : 'Register a resource'} width="lg" submitLabel="Register"
      onSubmit={async () => {
        const body: any = { ...f, departmentId: s.departmentId ?? undefined, custodianMemberId: custodian?.id, photos, attachments: docs, quantity: Number(f.quantity), reorderLevel: f.reorderLevel === '' || f.reorderLevel === undefined ? undefined : Number(f.reorderLevel) };
        for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
        if (body.acquisitionCost) body.acquisitionCost = Number(body.acquisitionCost);
        if (body.estimatedValue) body.estimatedValue = Number(body.estimatedValue);
        const r = await axios.post('/inventory/assets', body, { withCredentials: true });
        setF({});
        onSaved(r.data);
      }}>
      {!consumable && (
        <fieldset className="space-y-2">
          <legend className="label">Ownership</legend>
          {ownershipChoices.map((x) => <Radio key={x.value} name="own" label={x.label} description={x.hint} checked={o === x.value} onChange={() => setF({ ...f, ownershipType: x.value })} />)}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Category"><Select value={f.categoryId ?? ''} onChange={(e) => setF({ ...f, categoryId: e.target.value })} placeholder="Choose" options={(cats.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Location"><Select value={f.locationId ?? ''} onChange={(e) => setF({ ...f, locationId: e.target.value })} placeholder="Choose" options={(locs.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        {!consumable && <Field label="Serial number"><Input value={f.serialNumber ?? ''} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} /></Field>}
        <Field label="Condition"><Select value={f.condition ?? 'good'} onChange={(e) => setF({ ...f, condition: e.target.value })} options={conditionOptions} /></Field>
        <Field label={consumable ? 'Opening quantity' : 'Quantity'} hint={consumable ? undefined : 'e.g. 50 identical chairs'}><Input type="number" min={consumable ? 0 : 1} value={f.quantity ?? ''} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        {consumable && <>
          <Field label="Unit"><Select value={f.unit ?? 'piece'} onChange={(e) => setF({ ...f, unit: e.target.value })} options={(settings.data?.units ?? ['piece']).map((u: string) => ({ value: u, label: u }))} /></Field>
          <Field label="Reorder when at or below"><Input type="number" min="0" value={f.reorderLevel ?? ''} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>
          <Field label="Stored at"><Input value={f.storageLocation ?? ''} onChange={(e) => setF({ ...f, storageLocation: e.target.value })} /></Field>
        </>}
        {o === 'borrowed' ? <>
          <Field label="Owner (organisation or person)" required><Input value={f.externalOwnerName ?? ''} onChange={(e) => setF({ ...f, externalOwnerName: e.target.value })} /></Field>
          <Field label="Owner's contact"><Input value={f.externalOwnerContact ?? ''} onChange={(e) => setF({ ...f, externalOwnerContact: e.target.value })} /></Field>
          <Field label="Borrowed on" required><Input type="date" value={f.borrowedOn ?? ''} onChange={(e) => setF({ ...f, borrowedOn: e.target.value })} /></Field>
          <Field label="Must be returned by" required><Input type="date" value={f.expectedReturnDate ?? ''} onChange={(e) => setF({ ...f, expectedReturnDate: e.target.value })} /></Field>
          <Field label="Condition when received"><Select value={f.conditionReceived ?? 'good'} onChange={(e) => setF({ ...f, conditionReceived: e.target.value })} options={conditionOptions} /></Field>
        </> : o === 'donated' ? <>
          <Field label="Donor"><Input value={f.donorName ?? ''} onChange={(e) => setF({ ...f, donorName: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Donor's contact"><Input value={f.donorContact ?? ''} onChange={(e) => setF({ ...f, donorContact: e.target.value })} /></Field>
          <Field label="Donated on"><Input type="date" value={f.donationDate ?? ''} onChange={(e) => setF({ ...f, donationDate: e.target.value })} /></Field>
          <Field label="Estimated value" hint="Not recorded as income"><Input type="number" min="0" value={f.estimatedValue ?? ''} onChange={(e) => setF({ ...f, estimatedValue: e.target.value })} /></Field>
        </> : <>
          <Field label="Acquired on"><Input type="date" value={f.acquisitionDate ?? ''} onChange={(e) => setF({ ...f, acquisitionDate: e.target.value })} /></Field>
          <Field label="Purchase price"><Input type="number" min="0" value={f.acquisitionCost ?? ''} onChange={(e) => setF({ ...f, acquisitionCost: e.target.value })} /></Field>
          <Field label="Bought from"><Input value={f.acquisitionSource ?? ''} onChange={(e) => setF({ ...f, acquisitionSource: e.target.value })} /></Field>
          <Field label="Purchase expense in Finance" hint={s.departmentId ? 'Must be paid from this department\'s own money.' : 'Must be paid from central funds.'}>
            <Select value={f.acquisitionExpenseId ?? ''} onChange={(e) => setF({ ...f, acquisitionExpenseId: e.target.value })} placeholder="Not linked" options={(exps.data ?? []).filter((e) => e.payment_status === 'paid' || e.approval_status === 'FINAL_APPROVED').map((e) => ({ value: e.id, label: `${e.expense_number ?? ''} ${e.title} · ${fmtMoney(e.amount_paid ?? e.amount)}` }))} />
          </Field>
        </>}
      </div>
      <Field label="Responsible person (custodian)"><MemberPicker value={custodian} onChange={setCustodian} /></Field>
      <Field label="Description"><Textarea rows={2} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <AttachmentPicker value={photos} onChange={setPhotos} label="Photos" />
      <AttachmentPicker value={docs} onChange={setDocs} label={o === 'donated' ? 'Donation documents' : o === 'borrowed' ? 'Borrowing agreement' : 'Receipts, warranty, documents'} />
    </FormModal>
  );
}

export function AssetList({ ownership: fixed }: { ownership?: string }) {
  const s = useInv();
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const cats = useCatalog('categories');
  const [q, setQ] = useState<any>({ search: '', ownership: fixed ?? '', categoryId: '', condition: '', status: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)), consumable: 'false', page: String(page), limit: '50', ...(s.departmentId ? { departmentId: s.departmentId } : {}) } as any).toString();
  const list = useLoad<any>(`/inventory/assets?${qs}`, [qs]);
  const [open, setOpen] = useState(false);
  const depts = useLoad<any[]>(!s.departmentId && fixed === 'department' ? '/departments' : null, []);
  const [deptFilter, setDeptFilter] = useState('');
  const rows = (list.data?.data ?? []).filter((r: any) => !deptFilter || r.owning_department_id === deptFilter);
  const canRegister = canManageScope(s) && !fixed;
  return (
    <div className="space-y-4">
      <PageHeader title={fixed === 'department' ? t('inv.nav.departmentAssets') : t('inv.nav.inventory')}
        description={fixed === 'department' ? 'Resources that belong to departments. You can see them for oversight; only each department manages its own.' : s.departmentId ? 'This department\'s own resources and fellowship resources assigned to it.' : 'Every resource and who owns it. Assigning a fellowship resource to a department never changes its ownership.'}
        actions={canRegister ? <Button variant="primary" onClick={() => setOpen(true)}><PlusIcon className="h-4 w-4" /> Register</Button> : undefined} />
      <div className="flex flex-wrap gap-2">
        {!fixed && <Select className="w-44" value={q.ownership} onChange={(e) => { setQ({ ...q, ownership: e.target.value }); setPage(1); }} options={[{ value: '', label: 'All ownership' }, { value: 'fellowship', label: 'Fellowship-owned' }, { value: 'department', label: 'Department-owned' }, { value: 'donated', label: 'Donated' }, { value: 'borrowed', label: 'Borrowed' }]} />}
        {fixed === 'department' && <Select className="w-44" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} options={[{ value: '', label: 'All departments' }, ...(depts.data ?? []).map((d: any) => ({ value: d.id, label: d.name }))]} />}
        <Select className="w-48" value={q.categoryId} onChange={(e) => { setQ({ ...q, categoryId: e.target.value }); setPage(1); }} options={[{ value: '', label: 'All categories' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <Select className="w-40" value={q.condition} onChange={(e) => { setQ({ ...q, condition: e.target.value }); setPage(1); }} options={[{ value: '', label: 'Any condition' }, ...conditionOptions]} />
        <Select className="w-44" value={q.status} onChange={(e) => { setQ({ ...q, status: e.target.value }); setPage(1); }} options={[{ value: '', label: 'Any availability' }, ...['available', 'assigned', 'reserved', 'borrowed', 'in_maintenance', 'lost', 'disposed'].map((v) => ({ value: v, label: label(v) }))]} />
      </div>
      <DataTable rows={rows} loading={list.loading && !list.data} error={list.error || null} onRetry={list.reload} rowKey={(r: any) => r.id}
        search={{ value: q.search, onChange: (v) => { setQ({ ...q, search: v }); setPage(1); }, placeholder: 'Name, tag or serial number' }}
        total={list.data?.total} page={page} pageSize={50} onPageChange={setPage}
        empty={{ title: 'No resources found', description: canRegister ? 'Register the first resource.' : undefined }}
        columns={[
          { key: 'tag', header: 'Tag', render: (r: any) => <Link className="font-medium text-primary hover:underline" to={`${s.base}/assets/${r.id}`}>{r.asset_tag}</Link>, priority: 'primary' },
          { key: 'name', header: 'Resource', render: (r: any) => r.name },
          { key: 'cat', header: 'Category', render: (r: any) => r.category?.name ?? '—', priority: 'meta' },
          { key: 'own', header: 'Owner', render: (r: any) => <span>{r.ownerLabel}{r.assignedDepartment ? <span className="block text-xs text-ink-subtle">assigned to {r.assignedDepartment.name}</span> : null}</span> },
          { key: 'cond', header: 'Condition', render: (r: any) => label(r.condition) },
          { key: 'qty', header: 'Qty', align: 'right', render: (r: any) => r.quantity, priority: 'meta' },
          { key: 'st', header: 'Availability', render: (r: any) => <span className="inline-flex gap-1"><Status value={r.status} />{r.overdueReturn && <Status value="overdue" />}</span> },
        ]} />
      <RegisterModal open={open} onClose={() => setOpen(false)} onSaved={(a) => { toast.push('success', `Registered as ${a.asset_tag}`); navigate(`${s.base}/assets/${a.id}`); }} />
      {isTreasurer(s) && !s.departmentId && <p className="text-xs text-ink-subtle">Tip: print a QR label from a resource's page; scanning it opens the resource for people allowed to see it.</p>}
    </div>
  );
}
