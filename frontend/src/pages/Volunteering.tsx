import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { HandRaisedIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import FormModal from '../components/resources/FormModal';
import { Bar, errMsg, isoDay } from '../components/finance/common';
import { DataTable, type Column } from '../components/DataTable';
import { EmptyState, PageLoader, Alert } from '../components/ui';

const badge = (s: string) => (s === 'open' ? 'status-active' : s === 'cancelled' ? 'status-rejected' : s === 'closed' ? 'status-inactive' : 'status-draft');
type Tab = 'opportunities' | 'mine' | 'roles' | 'reports';

export default function Volunteering() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('volunteer.manage') || hasPermission('volunteer.department_manage');
  const canRoles = hasPermission('volunteer.manage');
  const canReport = hasPermission('volunteer.reports_view');
  const [tab, setTab] = useState<Tab>('opportunities');
  const tabs: [Tab, string][] = [
    ['opportunities', 'Opportunities'], ['mine', 'My service'],
    ...(canRoles ? [['roles', 'Roles'] as [Tab, string]] : []),
    ...(canReport ? [['reports', 'Reports'] as [Tab, string]] : []),
  ];
  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Volunteering &amp; Service</h1>
          <p className="page-desc">Find ways to serve, sign up for shifts and keep track of the service you have given.</p>
        </div>
      </div>
      <div className="tabs mb-4">
        {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`tab ${tab === id ? 'tab-active' : ''}`}>{label}</button>)}
      </div>
      {tab === 'opportunities' && <OpportunitiesTab canCreate={canCreate} />}
      {tab === 'mine' && <MineTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}

function OpportunitiesTab({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const manager = hasPermission('volunteer.manage');
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [lookups, setLookups] = useState<{ members: any[]; departments: any[] }>({ members: [], departments: [] });

  const load = () => {
    const p = new URLSearchParams({ limit: '100' });
    if (q.trim()) p.set('search', q.trim());
    if (status) p.set('status', status);
    axios.get(`/volunteers/opportunities?${p}`, { withCredentials: true }).then((r) => { setRows(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load opportunities')));
  };
  useEffect(load, [status]);
  useEffect(() => {
    if (!creating) return;
    axios.get('/members?limit=100&status=active', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, members: r.data.data || [] }))).catch(() => {});
    if (manager) axios.get('/departments', { withCredentials: true }).then((r) => setLookups((l) => ({ ...l, departments: r.data }))).catch(() => {});
  }, [creating]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex flex-1 gap-2">
          <input className="input max-w-xs" placeholder="Search opportunities…" value={q} onChange={(e) => setQ(e.target.value)} />
          {canCreate && (
            <select className="select w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['draft', 'open', 'closed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button className="btn btn-secondary" type="submit">Search</button>
        </form>
        {canCreate && <button className="btn btn-primary" onClick={() => setCreating(true)}><PlusIcon className="h-4 w-4" /> New opportunity</button>}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : !rows ? <PageLoader /> : rows.length === 0 ? <EmptyState title="No opportunities to show yet" /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((o) => (
            <button key={o.id} onClick={() => navigate(`/volunteering/${o.id}`)} className="card text-left transition hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-ink">{o.title}</h3>
                <span className={`status-badge ${badge(o.status)} capitalize`}>{o.status}</span>
              </div>
              {o.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{o.description}</p>}
              <dl className="mt-3 space-y-1 text-xs text-ink-muted">
                {o.department && <div>Department: <span className="text-ink">{o.department.name}</span></div>}
                {o.coordinator && <div>Coordinator: <span className="text-ink">{o.coordinator.full_name}</span></div>}
                <div>{o.upcomingShifts} upcoming shift{o.upcomingShifts === 1 ? '' : 's'} · <span className="text-ink">{o.spotsLeft} spot{o.spotsLeft === 1 ? '' : 's'} left</span>{o.nextShiftAt && <> · next {new Date(o.nextShiftAt).toLocaleString()}</>}</div>
              </dl>
            </button>
          ))}
        </div>
      )}
      {creating && (
        <FormModal
          title="New opportunity" submitLabel="Create"
          initial={{ status: 'draft' }}
          fields={[
            { name: 'title', label: 'Title', required: true },
            { name: 'description', label: 'Description', type: 'textarea' },
            { name: 'location', label: 'Location' },
            ...(manager ? [{ name: 'departmentId', label: 'Department', type: 'select' as const, options: [{ value: '', label: 'Fellowship-wide' }, ...lookups.departments.map((d) => ({ value: d.id, label: d.name }))] }] : []),
            { name: 'coordinatorMemberId', label: 'Coordinator', type: 'select', options: [{ value: '', label: 'None' }, ...lookups.members.map((m) => ({ value: m.id, label: m.full_name }))], help: 'A coordinator can manage shifts and applications for this opportunity.' },
            { name: 'status', label: 'Publish', type: 'select', options: [{ value: 'draft', label: 'Save as draft (hidden)' }, { value: 'open', label: 'Open for sign-ups' }] },
          ]}
          onSubmit={async (v) => {
            const r = await axios.post('/volunteers/opportunities', { title: v.title, description: v.description || undefined, location: v.location || undefined, departmentId: v.departmentId || undefined, coordinatorMemberId: v.coordinatorMemberId || undefined, status: v.status }, { withCredentials: true });
            navigate(`/volunteering/${r.data.id}`);
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function MineTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get('/volunteers/my-service', { withCredentials: true }).then((r) => setData(r.data)).catch((e) => setError(e.response?.status === 404 ? 'No member profile is linked to your account.' : errMsg(e, 'Could not load your service history')));
  }, []);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) return <PageLoader />;
  const myColumns: Column<any>[] = [
    { key: 'when', header: 'When', priority: 'primary', render: (i) => new Date(i.startsAt).toLocaleString() },
    { key: 'opportunity', header: 'Opportunity', priority: 'secondary', render: (i) => <span className="font-medium text-ink">{i.opportunity.title}{i.location && <span className="ml-2 text-xs text-ink-subtle">{i.location}</span>}</span> },
    { key: 'role', header: 'Role', render: (i) => i.role || '—' },
    { key: 'status', header: 'Status', render: (i) => <span className="capitalize">{i.status.replace('_', ' ')}{i.hours > 0 && <span className="ml-2 text-xs text-ink-subtle">{i.hours}h</span>}</span> },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[['Times served', data.totals.attended], ['Hours served', data.totals.hoursServed], ['Upcoming', data.totals.upcoming], ['Missed', data.totals.noShow]].map(([l, v]) => (
          <div key={l as string} className="card"><p className="text-sm text-ink-muted">{l}</p><p className="text-2xl font-semibold text-ink">{v}</p></div>
        ))}
      </div>
      <DataTable
        columns={myColumns}
        rows={data.items}
        rowKey={(i) => i.id}
        caption="My service"
        empty={{ title: 'You have not signed up for any service yet' }}
      />
    </div>
  );
}

function RolesTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [dialog, setDialog] = useState<null | { row?: any }>(null);
  const load = () => axios.get('/volunteers/roles', { withCredentials: true }).then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const toggle = async (r: any) => {
    try { await axios.put(`/volunteers/roles/${r.id}`, { isActive: !r.is_active }, { withCredentials: true }); load(); } catch (e) { alert(errMsg(e, 'Failed')); }
  };
  return (
    <div>
      <div className="mb-4 flex justify-between">
        <p className="text-sm text-ink-muted">Roles are the kinds of service people can do (usher, sound desk…). Required skills are matched against member profiles to suggest volunteers.</p>
        <button className="btn btn-primary" onClick={() => setDialog({})}><PlusIcon className="h-4 w-4" /> New role</button>
      </div>
      {!rows ? <PageLoader /> : rows.length === 0 ? <EmptyState title="No roles yet" /> : (
        <DataTable
          columns={[
            { key: 'name', header: 'Role', priority: 'primary', render: (r) => <span className="font-medium text-ink">{r.name}{r.description && <p className="text-xs font-normal text-ink-muted">{r.description}</p>}</span> },
            { key: 'skills', header: 'Required skills', priority: 'secondary', render: (r) => r.required_skills.length ? r.required_skills.join(', ') : '—' },
            { key: 'status', header: 'Status', render: (r) => <span className={`status-badge ${r.is_active ? 'status-active' : 'status-inactive'}`}>{r.is_active ? 'Active' : 'Inactive'}</span> },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          caption="Volunteer roles"
          rowActions={(r) => <span className="space-x-2"><button className="btn btn-secondary btn-sm" onClick={() => setDialog({ row: r })}>Edit</button><button className="btn btn-secondary btn-sm" onClick={() => toggle(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button></span>}
        />
      )}
      {dialog && (
        <FormModal
          title={dialog.row ? 'Edit role' : 'New role'}
          initial={dialog.row ? { name: dialog.row.name, description: dialog.row.description || '', requiredSkills: dialog.row.required_skills.join(', ') } : {}}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'requiredSkills', label: 'Required skills', help: 'Comma separated, e.g. sound desk, audio' }]}
          onSubmit={async (v) => {
            const body = { name: v.name, description: v.description || undefined, requiredSkills: String(v.requiredSkills || '').split(',').map((s) => s.trim()).filter(Boolean) };
            if (dialog.row) await axios.put(`/volunteers/roles/${dialog.row.id}`, body, { withCredentials: true });
            else await axios.post('/volunteers/roles', body, { withCredentials: true });
            load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ReportsTab() {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(isoDay());
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => {
    setData(null);
    axios.get(`/volunteers/reports/summary?from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z`, { withCredentials: true }).then((r) => { setData(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load the report')));
  };
  useEffect(load, []);
  const oppColumns: Column<any>[] = [
    { key: 'title', header: 'Opportunity', priority: 'primary', render: (o) => <span className="font-medium text-ink">{o.title}</span> },
    { key: 'department', header: 'Department', priority: 'secondary', render: (o) => o.department || '—' },
    { key: 'shifts', header: 'Shifts', tabular: true, render: (o) => o.shifts },
    { key: 'attended', header: 'Attended', tabular: true, render: (o) => o.attended },
    { key: 'noShow', header: 'No-show', tabular: true, render: (o) => o.no_show },
    { key: 'hours', header: 'Hours', tabular: true, render: (o) => o.hours },
  ];
  return (
    <div className="space-y-6">
      <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button className="btn btn-secondary" type="submit">Update</button>
      </form>
      {error ? <Alert tone="danger">{error}</Alert> : !data ? <PageLoader /> : (
        <>
          {data.scope === 'department' && <p className="text-sm text-ink-muted">Showing your department only.</p>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              ['Volunteers', data.participation.volunteers],
              ['Hours served', data.participation.hoursServed],
              ['Attendance rate', data.participation.attendanceRate == null ? '—' : `${data.participation.attendanceRate}%`],
              ['Shifts filled', data.participation.fillRate == null ? '—' : `${data.participation.fillRate}%`],
              ['Unfilled (next 14 days)', `${data.upcoming.unfilled} of ${data.upcoming.next14Days}`],
            ].map(([l, v]) => <div key={l as string} className="card"><p className="text-sm text-ink-muted">{l}</p><p className="text-2xl font-semibold text-ink">{v}</p></div>)}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">By department</h3>
              {data.byDepartment.length === 0 ? <p className="text-sm text-ink-muted">Nothing in this period.</p> : (
                <ul className="space-y-2">{data.byDepartment.map((d: any, i: number) => {
                  const max = Math.max(...data.byDepartment.map((x: any) => x.attended), 1);
                  return <li key={i} className="flex items-center gap-3 text-sm"><span className="w-40 truncate text-ink">{d.department}</span><Bar value={d.attended} max={max} /><span className="w-24 text-right text-ink-muted">{d.attended} · {d.hours}h</span></li>;
                })}</ul>
              )}
            </div>
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Service per month</h3>
              {data.monthly.length === 0 ? <p className="text-sm text-ink-muted">Nothing in this period.</p> : (
                <ul className="space-y-2">{data.monthly.map((m: any) => {
                  const max = Math.max(...data.monthly.map((x: any) => x.attended), 1);
                  return <li key={m.month} className="flex items-center gap-3 text-sm"><span className="w-20 text-ink">{m.month}</span><Bar value={m.attended} max={max} /><span className="w-24 text-right text-ink-muted">{m.attended} · {m.hours}h</span></li>;
                })}</ul>
              )}
            </div>
          </div>
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">By opportunity</h3>
            {data.byOpportunity.length === 0 ? <p className="text-sm text-ink-muted">Nothing in this period.</p> : (
              <DataTable
                columns={oppColumns}
                rows={data.byOpportunity}
                rowKey={(o) => o.id}
                caption="By opportunity"
              />
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-subtle"><HandRaisedIcon className="h-4 w-4" /> Figures are aggregates only; individual service history is visible just to the member and to authorised leaders.</div>
        </>
      )}
    </div>
  );
}
