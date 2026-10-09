import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon, CubeIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import FormModal, { Field } from '../components/resources/FormModal';
import { Empty, Spinner, errMsg, isoDay, money } from '../components/finance/common';
import { ConfirmDialog } from '../components/ui';
import { useMembers } from '../context/MembersContext';

const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];
const condOpts = CONDITIONS.map((v) => ({ value: v, label: v }));
type Dialog = null | 'checkout' | 'checkin' | 'transfer' | 'maintenance' | 'retire' | 'adjust' | 'document' | 'edit';
type Tab = 'history' | 'maintenance' | 'loans' | 'documents';

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { searchMembers } = useMembers();
  const canManage = hasPermission('resources.manage');
  const canAssign = hasPermission('resources.assign');
  const canRetire = hasPermission('resources.retire');
  const canMaintain = hasPermission('resources.maintenance_manage');
  const canDocs = hasPermission('resources.documents_manage');
  const canCost = hasPermission('resources.cost_view');
  // Department leaders may lend their own department's assets (the server enforces the exact scope).
  const canLoan = hasPermission('resources.checkout') || hasPermission('resources.department_view');

  const [asset, setAsset] = useState<any>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('history');
  const [tabData, setTabData] = useState<any[] | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmRemoveDoc, setConfirmRemoveDoc] = useState<null | string>(null);
  const [lookups, setLookups] = useState<{ members: any[]; departments: any[]; locations: any[]; documents: any[] }>({ members: [], departments: [], locations: [], documents: [] });

  const loadAsset = () => axios.get(`/resources/assets/${id}`, { withCredentials: true })
    .then((r) => { setAsset(r.data); setError(''); })
    .catch((e) => setError(e.response?.status === 403 ? "You don't have access to this asset." : e.response?.status === 404 ? 'Asset not found.' : errMsg(e, 'Could not load the asset')));
  const loadTab = () => {
    setTabData(null);
    const path = tab === 'history' ? 'history' : tab === 'maintenance' ? 'maintenance' : tab === 'loans' ? 'loans' : 'documents';
    axios.get(`/resources/assets/${id}/${path}`, { withCredentials: true }).then((r) => setTabData(r.data)).catch(() => setTabData([]));
  };
  useEffect(() => { loadAsset(); }, [id]);
  useEffect(loadTab, [id, tab]);
  const refresh = () => { loadAsset(); loadTab(); };

  // Lookups are only fetched when a dialog that needs them opens.
  useEffect(() => {
    if (!dialog) return;
    if (['checkout', 'transfer'].includes(dialog) && lookups.members.length === 0) {
      searchMembers('', 100).then((members) => setLookups((l) => ({ ...l, members })));
    }
    if (dialog === 'transfer') {
      axios.get('/departments', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, departments: r.data }))).catch(() => {});
      axios.get('/resources/locations', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, locations: r.data.filter((x: any) => x.is_active) }))).catch(() => {});
    }
    if (dialog === 'document') {
      axios.get('/it-content/documents', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, documents: (Array.isArray(r.data) ? r.data : []).filter((d: any) => !d.is_website_content) }))).catch(() => {});
    }
  }, [dialog]);

  const post = (path: string, body: object) => axios.post(`/resources/${path}`, body, { withCredentials: true }).then(() => refresh());

  if (error) return <div className="mx-auto max-w-4xl"><button onClick={() => navigate('/resources')} className="mb-4 text-sm text-ink-muted">← Back</button><Empty text={error} /></div>;
  if (!asset) return <Spinner />;

  const inactive = ['retired', 'lost'].includes(asset.status);
  const memberOpts = (list: any[]) => [{ value: '', label: 'Select member…' }, ...list.map((m) => ({ value: m.id, label: m.full_name }))];

  const dialogs: Record<Exclude<Dialog, null>, { title: string; fields: Field[]; initial?: Record<string, any>; submit: (v: any) => Promise<any>; description?: string; label?: string }> = {
    checkout: {
      title: 'Check out', label: 'Check out',
      fields: [
        { name: 'memberId', label: 'Borrower', type: 'select', required: true, options: memberOpts(lookups.members) },
        { name: 'dueDate', label: 'Due back', type: 'date', min: undefined },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      submit: (v) => post(`assets/${id}/check-out`, { memberId: v.memberId, dueDate: v.dueDate || undefined, notes: v.notes || undefined }),
    },
    checkin: {
      title: 'Check in', label: 'Check in',
      initial: { condition: asset.condition },
      fields: [
        { name: 'condition', label: 'Condition on return', type: 'select', options: condOpts },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      submit: (v) => post(`assets/${id}/check-in`, { condition: v.condition, notes: v.notes || undefined }),
    },
    transfer: {
      title: 'Transfer', label: 'Transfer',
      description: 'Change the owning department, location and/or custodian. Leave a field on "unchanged" to keep it.',
      initial: { toDepartmentId: '__keep', toLocationId: '__keep', toCustodianMemberId: '__keep' },
      fields: [
        { name: 'toDepartmentId', label: 'Owning department', type: 'select', options: [{ value: '__keep', label: 'Unchanged' }, { value: '', label: 'Fellowship-wide (none)' }, ...lookups.departments.map((d) => ({ value: d.id, label: d.name }))] },
        { name: 'toLocationId', label: 'Location', type: 'select', options: [{ value: '__keep', label: 'Unchanged' }, { value: '', label: 'No location' }, ...lookups.locations.map((d) => ({ value: d.id, label: d.name }))] },
        { name: 'toCustodianMemberId', label: 'Custodian', type: 'select', options: [{ value: '__keep', label: 'Unchanged' }, { value: '', label: 'No custodian' }, ...lookups.members.map((m) => ({ value: m.id, label: m.full_name }))] },
        { name: 'reason', label: 'Reason', type: 'textarea' },
      ],
      submit: (v) => {
        const body: any = { reason: v.reason || undefined };
        (['toDepartmentId', 'toLocationId', 'toCustodianMemberId'] as const).forEach((k) => { if (v[k] !== '__keep') body[k] = v[k] === '' ? null : v[k]; });
        return post(`assets/${id}/transfer`, body);
      },
    },
    maintenance: {
      title: 'Schedule maintenance', label: 'Schedule',
      initial: { type: 'repair', scheduledFor: isoDay() },
      fields: [
        { name: 'type', label: 'Type', type: 'select', options: ['scheduled', 'repair', 'inspection'].map((v) => ({ value: v, label: v })) },
        { name: 'scheduledFor', label: 'Scheduled for', type: 'date', required: true },
        { name: 'description', label: 'What needs doing', type: 'textarea', required: true },
        { name: 'performedBy', label: 'Done by (person or vendor)' },
      ],
      submit: (v) => post(`assets/${id}/maintenance`, { ...v, performedBy: v.performedBy || undefined }),
    },
    retire: {
      title: 'Retire asset', label: 'Retire',
      description: 'This is final. Any open maintenance is cancelled. The asset must be checked in first.',
      initial: { outcome: 'retired' },
      fields: [
        { name: 'outcome', label: 'Outcome', type: 'select', options: [{ value: 'retired', label: 'Retired / disposed' }, { value: 'lost', label: 'Lost or stolen' }] },
        { name: 'reason', label: 'Reason', type: 'textarea', required: true },
      ],
      submit: (v) => post(`assets/${id}/retire`, v),
    },
    adjust: {
      title: 'Adjust stock', label: 'Adjust',
      description: `Current quantity: ${asset.quantity}. Use a negative number to remove stock.`,
      fields: [{ name: 'delta', label: 'Change (+/−)', type: 'number', required: true }, { name: 'reason', label: 'Reason', required: true }],
      submit: (v) => post(`assets/${id}/adjust-quantity`, { delta: Number(v.delta), reason: v.reason }),
    },
    document: {
      title: 'Attach document', label: 'Attach',
      description: 'Choose a document that has already been uploaded under IT Content.',
      fields: [
        { name: 'documentId', label: 'Document', type: 'select', required: true, options: [{ value: '', label: 'Select…' }, ...lookups.documents.map((d) => ({ value: d.id, label: d.title }))] },
        { name: 'label', label: 'Label (e.g. Warranty)' },
      ],
      submit: (v) => post(`assets/${id}/documents`, { documentId: v.documentId, label: v.label || undefined }),
    },
    edit: {
      title: 'Edit asset', label: 'Save',
      initial: { name: asset.name, serialNumber: asset.serial_number || '', condition: asset.condition, notes: asset.notes || '' },
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'serialNumber', label: 'Serial number' },
        { name: 'condition', label: 'Condition', type: 'select', options: condOpts },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      submit: (v) => axios.put(`/resources/assets/${id}`, { name: v.name, serialNumber: v.serialNumber || null, condition: v.condition, notes: v.notes || null }, { withCredentials: true }).then(() => refresh()),
    },
  };
  const current = dialog ? dialogs[dialog] : null;

  const btn = (label: string, d: Exclude<Dialog, null>, show: boolean) => show && <button key={d} onClick={() => setDialog(d)} className="btn btn-secondary btn-sm">{label}</button>;

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={() => navigate('/resources')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeftIcon className="h-4 w-4" /> Back to Resources</button>

      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-5">
          <div className="flex items-center gap-4">
            <div className="stat-icon bg-primary-light text-primary"><CubeIcon className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{asset.name}</h1>
              <p className="mt-1 font-mono text-xs text-ink-muted">{asset.asset_tag}{asset.serial_number ? ` · SN ${asset.serial_number}` : ''}</p>
            </div>
          </div>
          <span className={`status-badge ${asset.status === 'available' ? 'status-active' : inactive ? 'status-inactive' : 'status-draft'} capitalize`}>{asset.status.replace(/_/g, ' ')}</span>
        </div>

        <dl className="grid grid-cols-2 gap-4 py-5 sm:grid-cols-3">
          {[
            ['Category', asset.category?.name], ['Location', asset.location?.name], ['Owned by', asset.owning_department?.name || 'Fellowship-wide'],
            ['Custodian', asset.custodian?.full_name], ['Condition', asset.condition],
            ...(asset.is_consumable ? [['Quantity', `${asset.quantity}${asset.reorder_level != null ? ` (reorder at ${asset.reorder_level})` : ''}`]] : []),
            ...(asset.acquisition_date ? [['Acquired', new Date(asset.acquisition_date).toLocaleDateString()]] : []),
            ...(canCost && asset.acquisition_cost != null ? [['Cost', money(asset.acquisition_cost)]] : []),
            ...(asset.openLoan ? [['On loan to', `${asset.openLoan.member.full_name}${asset.openLoan.due_date ? ` · due ${new Date(asset.openLoan.due_date).toLocaleDateString()}` : ''}`]] : []),
            ...(inactive ? [['Reason', asset.retired_reason]] : []),
          ].map(([k, v]) => (
            <div key={k as string}><dt className="text-xs uppercase tracking-wider text-ink-subtle">{k}</dt><dd className="mt-1 text-sm capitalize text-ink">{(v as string) || '—'}</dd></div>
          ))}
        </dl>
        {asset.notes && <p className="border-t border-hairline pt-4 text-sm text-ink-muted">{asset.notes}</p>}

        {!inactive && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
            {btn('Check out', 'checkout', canLoan && !asset.is_consumable && asset.status === 'available')}
            {btn('Check in', 'checkin', canLoan && asset.status === 'checked_out')}
            {btn('Transfer', 'transfer', canAssign && asset.status !== 'checked_out')}
            {btn('Schedule maintenance', 'maintenance', canMaintain)}
            {btn('Adjust stock', 'adjust', canManage && asset.is_consumable)}
            {btn('Attach document', 'document', canDocs)}
            {btn('Edit', 'edit', canManage)}
            {canRetire && <button onClick={() => setDialog('retire')} className="btn btn-danger btn-sm">Retire</button>}
          </div>
        )}
      </div>

      <div className="tabs mb-4">
        {(['history', 'maintenance', 'loans', 'documents'] as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)} className={`tab capitalize ${tab === t ? 'tab-active' : ''}`}>{t}</button>)}
      </div>
      {!tabData ? <Spinner /> : tabData.length === 0 ? <Empty text={`No ${tab} yet`} /> : (
        <div className="card">
          {tab === 'history' && (
            <ol className="relative space-y-4 border-l border-hairline pl-6">
              {tabData.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-white" />
                  <p className="text-sm font-medium capitalize text-ink">{h.eventType.replace(/_/g, ' ')}
                    {h.member && <span className="ml-2 font-normal normal-case text-ink-muted">{h.member}</span>}
                    {(h.fromValue || h.toValue) && <span className="ml-2 font-normal normal-case text-ink-muted">{h.fromValue ?? '—'} → {h.toValue ?? '—'}</span>}
                    {(h.fromDepartment || h.toDepartment) && h.fromDepartment !== h.toDepartment && <span className="ml-2 font-normal normal-case text-ink-muted">dept: {h.fromDepartment ?? '—'} → {h.toDepartment ?? '—'}</span>}
                    {(h.fromLocation || h.toLocation) && h.fromLocation !== h.toLocation && <span className="ml-2 font-normal normal-case text-ink-muted">location: {h.fromLocation ?? '—'} → {h.toLocation ?? '—'}</span>}
                  </p>
                  <p className="text-xs text-ink-subtle">{new Date(h.occurredAt).toLocaleString()}{h.actor ? ` · ${h.actor}` : ''}</p>
                  {h.note && <p className="mt-1 text-sm text-ink-muted">“{h.note}”</p>}
                </li>
              ))}
            </ol>
          )}
          {tab === 'maintenance' && (
            <ul className="divide-y divide-hairline">
              {tabData.map((m) => (
                <li key={m.id} className="py-3 text-sm">
                  <div className="flex justify-between"><span className="font-medium capitalize text-ink">{m.type} · {m.status.replace('_', ' ')}</span><span className="text-ink-subtle">{new Date(m.scheduled_for).toLocaleDateString()}</span></div>
                  <p className="text-ink-muted">{m.description}</p>
                  {canCost && m.cost != null && <p className="text-xs text-ink-subtle">Cost {money(m.cost)}</p>}
                </li>
              ))}
            </ul>
          )}
          {tab === 'loans' && (
            <ul className="divide-y divide-hairline">
              {tabData.map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                  <span className="font-medium text-ink">{l.member.full_name}</span>
                  <span className="text-ink-muted">{new Date(l.checked_out_at).toLocaleDateString()} → {l.checked_in_at ? new Date(l.checked_in_at).toLocaleDateString() : <span className="text-amber-700">still out{l.due_date && new Date(l.due_date) < new Date() ? ' (overdue)' : ''}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          {tab === 'documents' && (
            <ul className="divide-y divide-hairline">
              {tabData.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-3 text-sm">
                  <span className="text-ink">{d.document?.title || 'Document unavailable'}{d.label && <span className="ml-2 text-ink-muted">({d.label})</span>}</span>
                  {canDocs && <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRemoveDoc(d.id)}>Remove</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {current && <FormModal title={current.title} description={current.description} fields={current.fields} initial={current.initial} submitLabel={current.label} onSubmit={current.submit} onClose={() => setDialog(null)} />}
      {confirmRemoveDoc && (
        <ConfirmDialog
          open
          title="Remove attachment"
          message="Remove this attachment?"
          onConfirm={async () => {
            try { await axios.post(`/resources/assets/${id}/documents/${confirmRemoveDoc}/remove`, {}, { withCredentials: true }); refresh(); } catch (e: any) { alert(errMsg(e, 'Failed')); }
            setConfirmRemoveDoc(null);
          }}
          onCancel={() => setConfirmRemoveDoc(null)}
        />
      )}
    </div>
  );
}
