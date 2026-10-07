import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { CubeIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import FormModal from '../components/resources/FormModal';
import { Bar, Empty, Spinner, errMsg, isoDay, money } from '../components/finance/common';

const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];
const STATUSES = ['available', 'checked_out', 'in_maintenance', 'retired', 'lost'];
const opts = (list: string[], any?: string) => [
  ...(any !== undefined ? [{ value: '', label: any }] : []),
  ...list.map((v) => ({ value: v, label: v.replace(/_/g, ' ') })),
];
const badge = (status: string) =>
  status === 'available' ? 'status-active' : status === 'checked_out' ? 'status-submitted' : status === 'in_maintenance' ? 'status-draft' : 'status-inactive';

const PAGE = 25;

export default function Resources() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('resources.manage');
  const canMaintain = hasPermission('resources.maintenance_manage');
  const canCost = hasPermission('resources.cost_view');
  const canReport = hasPermission('resources.reports_view') || hasPermission('resources.department_view');
  const [tab, setTab] = useState<'assets' | 'maintenance' | 'setup' | 'reports'>('assets');

  const tabs: [typeof tab, string][] = [
    ['assets', 'Assets'], ['maintenance', 'Maintenance'],
    ...(canManage ? [['setup', 'Categories & Locations'] as [typeof tab, string]] : []),
    ...(canReport ? [['reports', 'Reports'] as [typeof tab, string]] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Resources &amp; Assets</h1>
          <p className="page-desc">Equipment and stock owned by the fellowship: who has it, where it is and what state it is in.</p>
        </div>
      </div>
      <div className="tabs mb-4">
        {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`tab ${tab === id ? 'tab-active' : ''}`}>{label}</button>)}
      </div>
      {tab === 'assets' && <AssetsTab canManage={canManage} canCost={canCost} />}
      {tab === 'maintenance' && <MaintenanceTab canMaintain={canMaintain} canCost={canCost} />}
      {tab === 'setup' && <SetupTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

function AssetsTab({ canManage, canCost }: { canManage: boolean; canCost: boolean }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const fellowshipWide = hasPermission('resources.view');
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', status: '', categoryId: '', locationId: '', departmentId: '' });
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    const p = new URLSearchParams({ limit: String(PAGE), page: String(page) });
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    axios.get(`/resources/assets?${p}`, { withCredentials: true })
      .then((r) => { setRows(r.data); setTotal(Number(r.headers['x-total-count'] ?? r.data.length)); setError(''); })
      .catch((e) => { setError(errMsg(e, 'Could not load assets')); setRows([]); });
  };
  useEffect(load, [page, filters]);
  useEffect(() => {
    axios.get('/resources/categories', { withCredentials: true }).then((r) => setCategories(r.data)).catch(() => {});
    axios.get('/resources/locations', { withCredentials: true }).then((r) => setLocations(r.data)).catch(() => {});
    if (fellowshipWide) axios.get('/departments', { withCredentials: true }).then((r) => setDepartments(r.data)).catch(() => {});
  }, []);

  const set = (k: string, v: string) => { setPage(1); setFilters({ ...filters, [k]: v }); };
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const create = async (v: Record<string, any>) => {
    const r = await axios.post('/resources/assets', {
      name: v.name, categoryId: v.categoryId || undefined, locationId: v.locationId || undefined,
      owningDepartmentId: v.owningDepartmentId || undefined, serialNumber: v.serialNumber || undefined,
      condition: v.condition, isConsumable: v.isConsumable, quantity: v.quantity ? Number(v.quantity) : undefined,
      reorderLevel: v.reorderLevel !== '' && v.isConsumable ? Number(v.reorderLevel) : undefined,
      acquisitionDate: v.acquisitionDate || undefined, acquisitionCost: v.acquisitionCost ? Number(v.acquisitionCost) : undefined,
      notes: v.notes || undefined,
    }, { withCredentials: true });
    load();
    navigate(`/resources/${r.data.id}`);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><label className="label">Search</label><input className="input" placeholder="Name, tag or serial" value={filters.q} onChange={(e) => set('q', e.target.value)} /></div>
        <div><label className="label">Status</label>
          <select className="select" value={filters.status} onChange={(e) => set('status', e.target.value)}>{opts(STATUSES, 'Any').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div><label className="label">Category</label>
          <select className="select" value={filters.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Any</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label">Location</label>
          <select className="select" value={filters.locationId} onChange={(e) => set('locationId', e.target.value)}><option value="">Any</option>{locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {fellowshipWide && <div><label className="label">Department</label>
          <select className="select" value={filters.departmentId} onChange={(e) => set('departmentId', e.target.value)}><option value="">Any</option>{departments.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        {canManage && <button onClick={() => setShow(true)} className="btn btn-primary"><PlusIcon className="h-4 w-4" /> New Asset</button>}
      </div>
      {error && <Empty text={error} />}
      {!rows ? <Spinner /> : rows.length === 0 && !error ? (
        <div className="empty-state"><div className="stat-icon bg-surface-sunken text-ink-subtle"><CubeIcon className="h-6 w-6" /></div><p className="empty-title">No assets found</p></div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Tag</th><th>Name</th><th>Category</th><th>Location</th><th>Department</th><th>Condition</th><th>Status</th>{canCost && <th>Cost</th>}</tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="cursor-pointer" onClick={() => navigate(`/resources/${a.id}`)}>
                  <td className="font-mono text-xs">{a.asset_tag}</td>
                  <td className="font-medium text-ink">{a.name}{a.is_consumable && <span className="ml-2 text-xs text-ink-subtle">× {a.quantity}</span>}</td>
                  <td>{a.category?.name || '—'}</td>
                  <td>{a.location?.name || '—'}</td>
                  <td>{a.owning_department?.name || '—'}</td>
                  <td className="capitalize">{a.condition}</td>
                  <td><span className={`status-badge ${badge(a.status)} capitalize`}>{a.status.replace(/_/g, ' ')}</span></td>
                  {canCost && <td>{a.acquisition_cost != null ? money(a.acquisition_cost) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
          <span>Page {page} of {pages} · {total} assets</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</button>
            <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
      {show && (
        <FormModal
          title="New asset" submitLabel="Create" onClose={() => setShow(false)} onSubmit={create}
          initial={{ condition: 'good', quantity: '1' }}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'categoryId', label: 'Category', type: 'select', options: [{ value: '', label: 'None' }, ...categories.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))] },
            { name: 'locationId', label: 'Location', type: 'select', options: [{ value: '', label: 'None' }, ...locations.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))] },
            { name: 'owningDepartmentId', label: 'Owned by department', type: 'select', options: [{ value: '', label: 'Fellowship-wide' }, ...departments.map((c) => ({ value: c.id, label: c.name }))] },
            { name: 'serialNumber', label: 'Serial number' },
            { name: 'condition', label: 'Condition', type: 'select', options: opts(CONDITIONS) },
            { name: 'isConsumable', label: 'This is consumable stock (counted, not checked out)', type: 'checkbox' },
            { name: 'quantity', label: 'Quantity', type: 'number', min: 1 },
            { name: 'reorderLevel', label: 'Reorder level (consumables)', type: 'number', min: 0 },
            { name: 'acquisitionDate', label: 'Acquired on', type: 'date', max: isoDay() },
            ...(canCost ? [{ name: 'acquisitionCost', label: 'Acquisition cost', type: 'number' as const, min: 0 }] : []),
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
        />
      )}
    </div>
  );
}

function MaintenanceTab({ canMaintain, canCost }: { canMaintain: boolean; canCost: boolean }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[] | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [completing, setCompleting] = useState<any>(null);
  const [error, setError] = useState('');

  const load = () => axios.get(`/resources/maintenance${overdue ? '?overdue=true' : ''}`, { withCredentials: true })
    .then((r) => setRows(r.data)).catch((e) => { setError(errMsg(e, 'Could not load maintenance')); setRows([]); });
  useEffect(() => { setRows(null); load(); }, [overdue]);

  const act = async (id: string, action: 'start' | 'cancel') => {
    try { await axios.post(`/resources/maintenance/${id}/${action}`, {}, { withCredentials: true }); load(); }
    catch (e: any) { alert(errMsg(e, 'Failed')); }
  };

  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only</label>
      {error && <Empty text={error} />}
      {!rows ? <Spinner /> : rows.length === 0 && !error ? <Empty text="No maintenance to show" /> : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Asset</th><th>Type</th><th>Description</th><th>Scheduled</th><th>Status</th>{canCost && <th>Cost</th>}{canMaintain && <th />}</tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="cursor-pointer font-medium text-primary" onClick={() => navigate(`/resources/${m.asset.id}`)}>{m.asset.name} <span className="font-mono text-xs text-ink-subtle">{m.asset.asset_tag}</span></td>
                  <td className="capitalize">{m.type}</td>
                  <td className="max-w-xs truncate">{m.description}</td>
                  <td className={m.status !== 'completed' && m.status !== 'cancelled' && new Date(m.scheduled_for) < new Date() ? 'font-medium text-rose-700' : ''}>{new Date(m.scheduled_for).toLocaleDateString()}</td>
                  <td className="capitalize">{m.status.replace('_', ' ')}</td>
                  {canCost && <td>{m.cost != null ? money(m.cost) : '—'}</td>}
                  {canMaintain && (
                    <td><div className="flex gap-1.5">
                      {m.status === 'scheduled' && <button className="btn btn-secondary btn-sm" onClick={() => act(m.id, 'start')}>Start</button>}
                      {m.status === 'in_progress' && <button className="btn btn-primary btn-sm" onClick={() => setCompleting(m)}>Complete</button>}
                      {['scheduled', 'in_progress'].includes(m.status) && <button className="btn btn-danger btn-sm" onClick={() => act(m.id, 'cancel')}>Cancel</button>}
                    </div></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {completing && (
        <FormModal
          title="Complete maintenance" submitLabel="Complete" onClose={() => setCompleting(null)}
          initial={{ conditionAfter: '' }}
          onSubmit={async (v) => { await axios.post(`/resources/maintenance/${completing.id}/complete`, { conditionAfter: v.conditionAfter || undefined, cost: v.cost !== '' && canCost ? Number(v.cost) : undefined, notes: v.notes || undefined }, { withCredentials: true }); load(); }}
          fields={[
            { name: 'conditionAfter', label: 'Condition afterwards', type: 'select', options: [{ value: '', label: 'Unchanged' }, ...opts(CONDITIONS)] },
            ...(canCost ? [{ name: 'cost', label: 'Cost', type: 'number' as const, min: 0 }] : []),
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
        />
      )}
    </div>
  );
}

function SetupTab() {
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [adding, setAdding] = useState<'category' | 'location' | null>(null);
  const load = () => {
    axios.get('/resources/categories', { withCredentials: true }).then((r) => setCategories(r.data)).catch(() => {});
    axios.get('/resources/locations', { withCredentials: true }).then((r) => setLocations(r.data)).catch(() => {});
  };
  useEffect(load, []);
  const toggle = async (kind: 'categories' | 'locations', row: any) => {
    try { await axios.put(`/resources/${kind}/${row.id}`, { isActive: !row.is_active }, { withCredentials: true }); load(); }
    catch (e: any) { alert(errMsg(e, 'Failed')); }
  };
  const List = ({ title, kind, rows, singular }: { title: string; kind: 'categories' | 'locations'; rows: any[]; singular: 'category' | 'location' }) => (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">{title}</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(singular)}><PlusIcon className="h-4 w-4" /> Add</button>
      </div>
      {rows.length === 0 ? <Empty text={`No ${title.toLowerCase()} yet`} /> : (
        <ul className="divide-y divide-hairline rounded-lg bg-white ring-1 ring-inset ring-hairline">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className={r.is_active ? 'text-ink' : 'text-ink-subtle line-through'}>{r.name}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => toggle(kind, r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <List title="Categories" kind="categories" rows={categories} singular="category" />
      <List title="Locations" kind="locations" rows={locations} singular="location" />
      {adding && (
        <FormModal
          title={`New ${adding}`} submitLabel="Create" onClose={() => setAdding(null)}
          onSubmit={async (v) => { await axios.post(`/resources/${adding === 'category' ? 'categories' : 'locations'}`, { name: v.name, description: v.description || undefined }, { withCredentials: true }); load(); }}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }]}
        />
      )}
    </div>
  );
}

function ReportsTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get('/resources/reports/summary', { withCredentials: true }).then((r) => setData(r.data)).catch((e) => setError(errMsg(e, 'Could not load the report')));
  }, []);
  if (error) return <Empty text={error} />;
  if (!data) return <Spinner />;
  const Rows = ({ rows, label }: { rows: any[]; label: (r: any) => string }) => {
    if (!rows.length) return <p className="text-sm text-ink-muted">Nothing to show.</p>;
    const max = Math.max(...rows.map((r) => r.count), 1);
    return <ul className="space-y-2">{rows.map((r, i) => <li key={i} className="flex items-center gap-3 text-sm"><span className="w-40 truncate text-ink">{label(r)}</span><Bar value={r.count} max={max} /><span className="w-8 text-right font-medium">{r.count}</span></li>)}</ul>;
  };
  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="card"><h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">{title}</h3>{children}</div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[['Available', data.totals.available ?? 0], ['On loan', data.totals.checked_out ?? 0], ['In maintenance', data.totals.in_maintenance ?? 0], ['Overdue loans', data.loans.overdue]].map(([l, v]) => (
          <div key={l as string} className="card"><p className="text-sm text-ink-muted">{l}</p><p className="text-2xl font-semibold text-ink">{v}</p></div>
        ))}
      </div>
      {data.acquisitionValue !== null && <p className="text-sm text-ink-muted">Acquisition value of active assets: <span className="font-semibold">{money(data.acquisitionValue)}</span></p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="By category"><Rows rows={data.byCategory} label={(r) => r.name} /></Card>
        <Card title="By location"><Rows rows={data.byLocation} label={(r) => r.name} /></Card>
        <Card title="By condition"><Rows rows={data.byCondition} label={(r) => r.condition} /></Card>
        <Card title="By department"><Rows rows={data.byDepartment} label={(r) => r.name} /></Card>
        <Card title={`Movement (${new Date(data.range.from).toLocaleDateString()} – ${new Date(data.range.to).toLocaleDateString()})`}>
          <ul className="space-y-1 text-sm">{Object.entries(data.movement).length === 0 ? <li className="text-ink-muted">No movement.</li> : Object.entries(data.movement).map(([k, v]) => <li key={k} className="flex justify-between"><span className="capitalize text-ink">{k.replace(/_/g, ' ')}</span><span className="font-medium">{v as number}</span></li>)}</ul>
        </Card>
        <Card title="Maintenance & stock">
          <p className="text-sm text-ink">Overdue maintenance: <span className="font-medium">{data.maintenance.overdue}</span></p>
          <h4 className="mt-3 text-xs font-semibold uppercase text-ink-subtle">Low stock</h4>
          {data.lowStock.length === 0 ? <p className="text-sm text-ink-muted">All stock above reorder level.</p> : (
            <ul className="mt-1 space-y-1 text-sm">{data.lowStock.map((s: any) => <li key={s.id} className="flex justify-between"><span>{s.name}</span><span className="text-amber-700">{s.quantity} / {s.reorder_level}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
