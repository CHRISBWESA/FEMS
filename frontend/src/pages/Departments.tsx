import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import {
  BuildingOfficeIcon, PlusIcon, SparklesIcon, MagnifyingGlassIcon, UsersIcon, CheckCircleIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageLoader, Switch, Textarea, useToast, StatCard, StatGrid } from '../components/ui';

export type DepartmentSummary = {
  id: string; name: string; description: string | null; isActive: boolean; createdAt: string;
  memberCount: number; maleCount: number; femaleCount: number;
  chairperson: { memberId: string; fullName: string | null; since: string } | null;
  secretary: { memberId: string; fullName: string | null; since: string } | null;
};

const errMsg = (e: any, f: string) => e?.response?.data?.message || f;

/** The Fellowship Secretary's list of departments. */
export default function Departments() {
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<DepartmentSummary[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState<DepartmentSummary | 'new' | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(() => {
    axios.get('/department-admin/departments', { withCredentials: true })
      .then((r) => { setRows(r.data); setError(''); })
      .catch((e) => setError(e.response?.status === 403 ? 'Only the Fellowship Secretary manages departments.' : errMsg(e, 'Could not load departments.')));
  }, []);
  useEffect(load, [load]);
  const closeEditor = useCallback(() => setEditing(null), []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((d) => (showInactive || d.isActive) && (!q || d.name.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q)));
  }, [rows, search, showInactive]);

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await axios.post('/department-admin/departments/standard', {}, { withCredentials: true });
      toast.push('success', r.data.created.length ? `Added ${r.data.created.join(', ')}` : 'All standard departments already exist');
      load();
    } catch (e) { toast.push('error', errMsg(e, 'Could not add the departments.')); } finally { setSeeding(false); }
  };

  const missingStandard = rows !== null && ['Praise', 'Choir', 'Evangelism', 'Prayers', 'Events', 'Word', 'Deacon', 'IT', 'Music', 'Decoration']
    .some((n) => !rows.some((d) => d.name.toLowerCase() === n.toLowerCase()));

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Departments</h1>
          <p className="page-desc">Create departments, appoint their Chairperson and Secretary, and see how many members each has.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {missingStandard && <Button loading={seeding} onClick={seed}><SparklesIcon className="h-4 w-4" /> Add standard departments</Button>}
          <Button variant="primary" onClick={() => setEditing('new')}><PlusIcon className="h-4 w-4" /> New department</Button>
        </div>
      </div>
      {rows && rows.length > 0 && (
        <StatGrid className="mb-6">
          <StatCard label="Departments" value={rows.length} icon={<BuildingOfficeIcon className="h-5 w-5" />} tone="primary" />
          <StatCard label="Active" value={rows.filter((d) => d.isActive).length} icon={<CheckCircleIcon className="h-5 w-5" />} tone="success" />
          <StatCard label="Members in departments" value={rows.reduce((n, d) => n + (d.memberCount ?? 0), 0)} icon={<UsersIcon className="h-5 w-5" />} />
          <StatCard label="Vacant offices" value={rows.filter((d) => d.isActive).reduce((n, d) => n + (d.chairperson ? 0 : 1) + (d.secretary ? 0 : 1), 0)} icon={<ExclamationTriangleIcon className="h-5 w-5" />} tone={rows.some((d) => d.isActive && (!d.chairperson || !d.secretary)) ? 'warning' : 'neutral'} hint="Chairperson or Secretary not appointed" />
        </StatGrid>
      )}

      {error ? <ErrorState message={error} onRetry={load} /> : rows === null ? <PageLoader rows={2} /> : rows.length === 0 ? (
        <EmptyState icon={<BuildingOfficeIcon className="h-8 w-8" />} title="No departments yet"
          description="Start with the ten standard departments (Praise, Choir, Evangelism, Prayers, Events, Word, Deacon, IT, Music, Decoration) or create your own."
          action={<div className="flex flex-wrap justify-center gap-2"><Button loading={seeding} onClick={seed}>Add standard departments</Button><Button variant="primary" onClick={() => setEditing('new')}>New department</Button></div>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="relative w-full max-w-sm">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <input className="input pl-9" placeholder="Search departments" aria-label="Search departments" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Switch label="Show inactive" checked={showInactive} onChange={setShowInactive} />
          </div>
          {shown.length === 0 ? <EmptyState compact title="No departments match" /> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((d) => (
                <Link key={d.id} to={`/departments/${d.id}`} className="card card-interactive card-pad flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="stat-icon bg-primary-light text-primary"><BuildingOfficeIcon className="h-6 w-6" /></div>
                    {!d.isActive && <Badge tone="warning">Inactive</Badge>}
                  </div>
                  <h3 className={`mt-4 break-words text-base font-semibold ${d.isActive ? 'text-ink' : 'text-ink-subtle'}`}>{d.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{d.description || 'No description'}</p>
                  <dl className="mt-4 space-y-1.5 border-t border-hairline pt-3 text-sm">
                    {[['Chairperson', d.chairperson], ['Secretary', d.secretary]].map(([label, l]: any) => (
                      <div key={label} className="flex justify-between gap-3">
                        <dt className="text-ink-muted">{label}</dt>
                        <dd className={`truncate text-right ${l ? 'font-medium text-ink' : 'text-ink-subtle'}`}>{l?.fullName ?? 'Vacant'}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-auto flex items-center gap-1.5 pt-3 text-sm text-ink-muted">
                    <UsersIcon className="h-4 w-4" /> {d.memberCount} {d.memberCount === 1 ? 'member' : 'members'} · {d.maleCount} male · {d.femaleCount} female
                  </p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <DepartmentForm
          department={editing === 'new' ? null : editing}
          onClose={closeEditor}
          onSaved={(d) => { closeEditor(); toast.push('success', 'Department saved'); if (editing === 'new') navigate(`/departments/${d.id}`); else load(); }}
        />
      )}
    </div>
  );
}

export function DepartmentForm({ department, onClose, onSaved }: { department: DepartmentSummary | null; onClose: () => void; onSaved: (d: DepartmentSummary) => void }) {
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [isActive, setIsActive] = useState(department?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Enter a department name.'); return; }
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim() || null, isActive };
      const r = department
        ? await axios.put(`/department-admin/departments/${department.id}`, body, { withCredentials: true })
        : await axios.post('/department-admin/departments', body, { withCredentials: true });
      onSaved(r.data);
    } catch (err) { setError(errMsg(err, 'Could not save the department.')); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={department ? 'Edit department' : 'New department'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button type="submit" form="dept-form" variant="primary" loading={saving}>{department ? 'Save' : 'Create department'}</Button></>}>
      <form id="dept-form" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" required hint="Must be different from the fellowship's other departments."><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></Field>
        <Switch label="Active" description="Leaders of an inactive department cannot use its workspace." checked={isActive} onChange={setIsActive} />
      </form>
    </Modal>
  );
}
