import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';
import { PencilSquareIcon, UserPlusIcon, ArrowPathIcon, UserMinusIcon, UsersIcon, StarIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Breadcrumb, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, PageLoader, StatCard, StatGrid, useToast } from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { DepartmentForm, DepartmentSummary } from './Departments';

type Role = 'department_chairperson' | 'department_secretary';
const ROLE_LABEL: Record<Role, string> = { department_chairperson: 'Department Chairperson', department_secretary: 'Department Secretary' };
const errMsg = (e: any, f: string) => e?.response?.data?.message || f;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

type Detail = DepartmentSummary & { history: { id: string; role: Role; fullName: string | null; memberCode: string | null; startDate: string; endDate: string | null; current: boolean; endReason: string | null; appointedBy: string | null; endedBy: string | null }[] };

/** The Fellowship Secretary's view of one department: its figures, its two leaders and their history. */
export default function DepartmentDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [appointing, setAppointing] = useState<Role | null>(null);
  const [vacating, setVacating] = useState<Role | null>(null);
  const [vacateBusy, setVacateBusy] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string; name: string } | null>(null);

  const load = useCallback(() => {
    axios.get(`/department-admin/departments/${id}`, { withCredentials: true })
      .then((r) => { setD(r.data); setError(''); })
      .catch((e) => setError(e.response?.status === 404 ? 'Department not found.' : errMsg(e, 'Could not load the department.')));
  }, [id]);
  useEffect(load, [load]);
  const closeEdit = useCallback(() => setEditing(false), []);
  const closeAppoint = useCallback(() => setAppointing(null), []);

  if (error) return <div className="mx-auto max-w-5xl"><ErrorState message={error} onRetry={load} /></div>;
  if (!d) return <PageLoader rows={3} />;

  const vacate = async () => {
    if (!vacating) return;
    setVacateBusy(true);
    try {
      const r = await axios.post(`/department-admin/departments/${id}/leaders/${vacating}/vacate`, { reason: 'vacated by the Secretary' }, { withCredentials: true });
      setD({ ...d, ...r.data });
      toast.push('success', `${ROLE_LABEL[vacating]} position is now vacant`);
      setVacating(null);
    } catch (e) { toast.push('error', errMsg(e, 'Could not end the appointment.')); } finally { setVacateBusy(false); }
  };

  const Office = ({ role, holder }: { role: Role; holder: DepartmentSummary['chairperson'] }) => (
    <Card className="card-pad">
      <div className="flex items-start gap-3">
        <div className={`stat-icon h-10 w-10 shrink-0 ${holder ? 'bg-accent-light text-accent' : 'bg-surface-sunken text-ink-subtle'}`}><StarIcon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{ROLE_LABEL[role]}</p>
          {holder ? (
            <>
              <p className="mt-1 truncate text-base font-semibold text-ink"><Link to={`/members/${holder.memberId}`} className="hover:text-primary">{holder.fullName}</Link></p>
              <p className="text-xs text-ink-muted">Since {fmtDate(holder.since)}</p>
            </>
          ) : <p className="mt-1 text-sm text-ink-muted">Vacant</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
        <Button size="sm" variant={holder ? 'secondary' : 'primary'} onClick={() => setAppointing(role)}>
          {holder ? <><ArrowPathIcon className="h-4 w-4" /> Replace</> : <><UserPlusIcon className="h-4 w-4" /> Appoint</>}
        </Button>
        {holder && <Button size="sm" variant="danger-quiet" onClick={() => setVacating(role)}><UserMinusIcon className="h-4 w-4" /> End appointment</Button>}
      </div>
    </Card>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <Breadcrumb items={[{ label: 'Departments', to: '/departments' }, { label: d.name }]} />
      <div className="page-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title break-words">{d.name}</h1>
            {d.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>}
          </div>
          <p className="page-desc">{d.description || 'No description'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing(true)}><PencilSquareIcon className="h-4 w-4" /> Edit</Button>
        </div>
      </div>

      <StatGrid className="mb-6">
        <StatCard label="Members" value={d.memberCount} icon={<UsersIcon className="h-5 w-5" />} tone="primary" />
        <StatCard label="Male" value={d.maleCount} />
        <StatCard label="Female" value={d.femaleCount} />
        <StatCard label="Created" value={<span className="text-xl">{fmtDate(d.createdAt)}</span>} />
      </StatGrid>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Leadership</h2>
        <p className="mb-3 text-sm text-ink-muted">Both leaders have equal permissions in the department workspace. Replacing a leader moves the workspace access to the new person at once; the department's members, activities, reports and requests stay as they are.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Office role="department_chairperson" holder={d.chairperson} />
          <Office role="department_secretary" holder={d.secretary} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Leadership history</h2>
        {d.history.length === 0 ? <EmptyState compact title="No appointments yet" /> : (
          <Card>
            <div className="overflow-x-auto">
              <table className="table w-full text-sm">
                <thead><tr><th>Office</th><th>Name</th><th>From</th><th>To</th><th>Appointed by</th><th>Status</th></tr></thead>
                <tbody>
                  {d.history.map((h) => (
                    <tr key={h.id}>
                      <td>{ROLE_LABEL[h.role] ?? h.role}</td>
                      <td>{h.fullName ?? '—'}</td>
                      <td>{fmtDate(h.startDate)}</td>
                      <td>{h.endDate ? fmtDate(h.endDate) : '—'}</td>
                      <td>{h.appointedBy ?? '—'}</td>
                      <td>{h.current ? <Badge tone="success">Current</Badge> : <span className="capitalize text-ink-muted">{h.endReason ?? 'ended'}{h.endedBy ? ` by ${h.endedBy}` : ''}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {editing && <DepartmentForm department={d} onClose={closeEdit} onSaved={() => { closeEdit(); toast.push('success', 'Department saved'); load(); }} />}
      {appointing && (
        <AppointModal
          departmentId={id}
          role={appointing}
          current={appointing === 'department_chairperson' ? d.chairperson : d.secretary}
          other={appointing === 'department_chairperson' ? d.secretary : d.chairperson}
          onClose={closeAppoint}
          onDone={(r, name) => {
            closeAppoint();
            setD({ ...d, ...r.department });
            toast.push('success', `${name} appointed ${ROLE_LABEL[appointing]}`);
            if (r.account?.created) setCredentials({ email: r.account.email, password: r.account.initialPassword, name });
          }}
        />
      )}
      <ConfirmDialog open={!!vacating} title="End appointment" message={vacating ? `End the current ${ROLE_LABEL[vacating]}'s appointment? They lose access to this department's workspace straight away. The position stays vacant until you appoint someone.` : ''} confirmLabel="End appointment" loading={vacateBusy} onConfirm={vacate} onCancel={() => setVacating(null)} />
      <Modal open={!!credentials} onClose={() => setCredentials(null)} title="Login account created" footer={<Button variant="primary" onClick={() => setCredentials(null)}>Done</Button>}>
        {credentials && (
          <div className="space-y-3 text-sm">
            <p>{credentials.name} now has a login for the department workspace. Pass these details on to them:</p>
            <dl className="rounded-control bg-surface-sunken p-4">
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">E-mail</dt><dd className="font-mono text-ink">{credentials.email}</dd></div>
              <div className="mt-1 flex justify-between gap-3"><dt className="text-ink-muted">Initial password</dt><dd className="font-mono text-ink">{credentials.password}</dd></div>
            </dl>
            <Alert tone="warning">They must choose a new password the first time they sign in, before they can do anything else.</Alert>
          </div>
        )}
      </Modal>
    </div>
  );
}

type Candidate = { id: string; full_name: string; member_code: string; email: string | null; gender: string | null; membership_status: string };

function AppointModal({ departmentId, role, current, other, onClose, onDone }: {
  departmentId: string; role: Role; current: DepartmentSummary['chairperson']; other: DepartmentSummary['chairperson'];
  onClose: () => void; onDone: (r: any, name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const h = setTimeout(() => {
      const q = new URLSearchParams({ status: 'active', limit: '25' });
      if (search.trim()) q.set('search', search.trim());
      axios.get(`/members?${q}`, { withCredentials: true }).then((r) => setRows(r.data.data ?? r.data)).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(h);
  }, [search]);

  const appoint = async () => {
    if (!chosen) return;
    setSaving(true);
    setError('');
    try { onDone((await axios.post(`/department-admin/departments/${departmentId}/leaders`, { memberId: chosen.id, role }, { withCredentials: true })).data, chosen.full_name); }
    catch (e) { setError(errMsg(e, 'Could not make the appointment.')); } finally { setSaving(false); }
  };

  const columns: Column<Candidate>[] = [
    { key: 'name', header: 'Member', priority: 'primary', render: (m) => <span className="font-medium text-ink">{m.full_name}</span> },
    { key: 'code', header: 'Code', render: (m) => <span className="font-mono text-xs text-ink-subtle">{m.member_code}</span> },
    { key: 'email', header: 'E-mail', priority: 'secondary', render: (m) => m.email || <span className="text-danger">No e-mail</span> },
    { key: 'pick', header: '', render: (m) => (
      m.id === other?.memberId ? <span className="text-xs text-ink-subtle">Holds the other office</span>
        : m.id === current?.memberId ? <span className="text-xs text-ink-subtle">Current holder</span>
        : <Button size="sm" variant={chosen?.id === m.id ? 'primary' : 'secondary'} disabled={!m.email} onClick={() => setChosen(m)}>{chosen?.id === m.id ? <><CheckCircleIcon className="h-4 w-4" /> Chosen</> : 'Choose'}</Button>
    ) },
  ];

  return (
    <Modal open onClose={onClose} width="lg" title={`${current ? 'Replace' : 'Appoint'} ${ROLE_LABEL[role]}`}
      description="Choose a registered, active member. Their e-mail address becomes their login. A member who already has an account keeps it and its password."
      footer={<>
        <span className="mr-auto self-center text-sm text-ink-muted">{chosen ? `Chosen: ${chosen.full_name}` : 'Nobody chosen yet'}</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!chosen} loading={saving} onClick={appoint}>{current ? 'Replace' : 'Appoint'}</Button>
      </>}>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {current && <Alert tone="info" className="mb-4">{current.fullName} will be replaced and lose access to this department's workspace immediately.</Alert>}
      <DataTable columns={columns} rows={rows} rowKey={(m) => m.id} loading={rows === null} caption="Registered members"
        search={{ value: search, onChange: setSearch, placeholder: 'Search by name, code or e-mail' }}
        empty={{ title: 'No members match', description: 'Only active, registered members can be appointed.' }} loadingRows={5} />
    </Modal>
  );
}
