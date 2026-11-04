import { useState, useEffect } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { useMembers } from '../context/MembersContext';
import { DataTable, type Column } from '../components/DataTable';
import { EmptyState, PageLoader, Alert, StatCard, StatGrid, DialogBackdrop } from '../components/ui';
import {
  UsersIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  PlusIcon,
  XMarkIcon,
  UserPlusIcon,
  CloudArrowUpIcon,
  DocumentArrowDownIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  AcademicCapIcon,
} from '@heroicons/react/24/outline';

const emptyForm = {
  fullName: '',
  gender: 'male',
  phone: '',
  email: '',
  programme: '',
  yearOfStudy: '',
  expectedGraduationYear: new Date().getFullYear() + 4,
  expectedGraduationMonth: 6,
};

const CSV_HEADERS = [
  'full_name', 'gender', 'phone', 'email', 'programme',
  'year_of_study', 'expected_graduation_year', 'expected_graduation_month',
];

const CSV_TEMPLATE_ROWS = [
  'John Mwangi,male,0700111222,john@example.com,BSc. Computer Science,Year 2,2027,6',
  'Grace Achieng,female,0700333444,grace@example.com,BBA,Year 1,2028,12',
];

const emptyFilters = {
  skills: '', interests: '', serviceInterests: '', joinedFrom: '', joinedTo: '',
  groupId: '',
};

export default function Members() {
  const { user, hasPermission } = useAuth();
  const { members, total, loading, fetchMembers, refreshMembers } = useMembers();
  const canManage = user?.roles.includes('secretary') || user?.roles.includes('admin');
  // Editing a member's details is the Secretary's (the same rule as the member page and the API).
  const canEdit = !!user?.roles.includes('secretary');
  // Advanced filters are only offered for the parts the server will actually allow this user to use.
  const canFilterProfile = hasPermission('member.profile_view');
  const canFilterGroup = hasPermission('member.groups_view');
  const hasAdvanced = canFilterProfile || canFilterGroup;
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [groups, setGroups] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [selectedProgramme, setSelectedProgramme] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const navigate = useNavigate();
  // Membership totals for the KPI row (needs the member reports permission; hidden without it).
  const [totals, setTotals] = useState<any>(null);
  useEffect(() => {
    if (!hasPermission('member.reports_view')) return;
    axios.get('/members/reports/summary?months=12', { withCredentials: true }).then((r) => setTotals(r.data?.totals ?? null)).catch(() => setTotals(null));
  }, []);

  useEffect(() => {
    fetchMembers({ search, status: statusFilter, page, ...applied });
    fetchProgrammes();
  }, [search, statusFilter, page, applied]);

  useEffect(() => {
    if (!canFilterGroup) return;
    axios.get('/member-groups', { withCredentials: true }).then((res) => setGroups(res.data)).catch(() => setGroups([]));
  }, [canFilterGroup]);

  const applyFilters = () => {
    setApplied(draft);
    setPage(1);
  };
  const clearFilters = () => {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
  };
  const activeFilterCount = Object.values(applied).filter(Boolean).length;

  const fetchProgrammes = async () => {
    try {
      const res = await axios.get('/programmes', { withCredentials: true });
      setProgrammes(Array.isArray(res.data) ? res.data : res.data.data || []);
    } catch {
      setProgrammes([]);
    }
  };

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await axios.post('/members', {
        ...form,
        programme: form.programme || undefined,
        expectedGraduationYear: Number(form.expectedGraduationYear),
        expectedGraduationMonth: Number(form.expectedGraduationMonth),
      }, { withCredentials: true });
      setShowCreate(false);
      setForm(emptyForm);
      setSelectedProgramme('');
      fetchMembers();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to register member');
    } finally {
      setCreating(false);
    }
  };

  const downloadTemplate = () => {
    const csv = [CSV_HEADERS.join(','), ...CSV_TEMPLATE_ROWS].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'members-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setError('Please choose a CSV file');
      return;
    }
    setError('');
    setUploadResult(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const res = await axios.post('/members/bulk-upload', fd, { withCredentials: true });
      setUploadResult(res.data);
      refreshMembers();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to upload CSV');
    } finally {
      setUploading(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'active': return 'status-active';
      case 'inactive': return 'status-inactive';
      case 'graduated': return 'status-graduated';
      default: return 'status-draft';
    }
  };

  const pageSize = 20;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-desc">Manage member records and membership status.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setError(''); setShowUpload(true); setUploadResult(null); setUploadFile(null); }} className="btn btn-secondary">
              <CloudArrowUpIcon className="h-4 w-4" />
              Bulk Upload
            </button>
            <button onClick={() => { setError(''); setShowCreate(true); }} className="btn btn-primary">
              <PlusIcon className="h-4 w-4" />
              Add Member
            </button>
          </div>
        )}
      </div>
      {totals && (
        <StatGrid className="mb-6">
          <StatCard label="Total members" value={totals.total} icon={<UsersIcon className="h-5 w-5" />} tone="primary" />
          <StatCard label="Active" value={totals.active} icon={<CheckCircleIcon className="h-5 w-5" />} tone="success" />
          <StatCard label="Inactive" value={totals.inactive} icon={<PauseCircleIcon className="h-5 w-5" />} tone="warning" />
          <StatCard label="Graduated" value={totals.graduated} icon={<AcademicCapIcon className="h-5 w-5" />} />
        </StatGrid>
      )}

      {error && !showCreate && (
        <div className="alert alert-danger mb-4" role="alert">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
          <input aria-label="Search members"             type="text"
            placeholder="Search members..."
            className="input pl-10"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          aria-label="Filter by status"
          className="select sm:w-48"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="graduated">Graduated</option>
        </select>
        {hasAdvanced && (
          <button onClick={() => setShowFilters((s) => !s)} className="btn btn-secondary">
            <FunnelIcon className="h-4 w-4" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        )}
      </div>

      {hasAdvanced && showFilters && (
        <div className="card mb-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {canFilterProfile && (
              <>
                <div>
                  <label className="label" htmlFor="members-skills-any-of-comma-separated">Skills (any of, comma separated)</label>
                  <input id="members-skills-any-of-comma-separated" className="input" value={draft.skills} onChange={(e) => setDraft({ ...draft, skills: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="members-interests">Interests</label>
                  <input id="members-interests" className="input" value={draft.interests} onChange={(e) => setDraft({ ...draft, interests: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="members-service-interests">Service interests</label>
                  <input id="members-service-interests" className="input" value={draft.serviceInterests} onChange={(e) => setDraft({ ...draft, serviceInterests: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="members-member-since-from">Member since (from)</label>
                  <input id="members-member-since-from" type="date" className="input" value={draft.joinedFrom} onChange={(e) => setDraft({ ...draft, joinedFrom: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="members-member-since-to">Member since (to)</label>
                  <input id="members-member-since-to" type="date" className="input" value={draft.joinedTo} onChange={(e) => setDraft({ ...draft, joinedTo: e.target.value })} />
                </div>
              </>
            )}
            {canFilterGroup && (
              <div>
                <label className="label" htmlFor="members-group">Group</label>
                <select id="members-group" className="select" value={draft.groupId} onChange={(e) => setDraft({ ...draft, groupId: e.target.value })}>
                  <option value="">Any group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={applyFilters} className="btn btn-primary btn-sm">Apply filters</button>
            <button onClick={clearFilters} className="btn btn-secondary btn-sm">Clear</button>
          </div>
        </div>
      )}

      {loading ? (
        <PageLoader rows={2} />
      ) : members.length === 0 ? (
        <EmptyState title="No members found" description="Try adjusting your search or filter." />
      ) : (
        <DataTable
          columns={[
            { key: 'name', header: 'Name', priority: 'primary', render: (m: any) => <Link to={`/members/${m.id}`} className="inline-block py-1 font-medium text-primary hover:underline">{m.full_name}</Link> },
            { key: 'code', header: 'Member Code', priority: 'secondary', render: (m: any) => <span className="font-mono text-xs">{m.member_code}</span> },
            { key: 'status', header: 'Status', render: (m: any) => <span className={`status-badge ${getStatusClass(m.membership_status)}`}>{m.membership_status}</span> },
            { key: 'departments', header: 'Department', render: (m: any) => <span className="text-ink-muted">{m.departments?.filter((d: any) => !d.removed).map((d: any) => d.department?.name ?? '').filter(Boolean).join(', ') || '—'}</span> },
            ...(canFilterProfile ? [{ key: 'skills', header: 'Skills', render: (m: any) => <span className="text-ink-muted">{m.profile?.skills?.length ? m.profile.skills.slice(0, 3).join(', ') : '—'}</span> }] : []),
          ] as Column<any>[]}
          rows={members}
          rowKey={(m) => m.id}
          onRowClick={(m: any) => navigate(`/members/${m.id}`)}
          rowClickLabel={(m: any) => `Open ${m.full_name}`}
          rowActions={canEdit ? (m: any) => (
            <span className="inline-flex gap-1">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/members/${m.id}`)}>View</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/members/${m.id}?edit=1`)}><PencilSquareIcon className="h-4 w-4" /> Edit</button>
            </span>
          ) : undefined}
          caption="Members"
          empty={{ title: 'No members found', description: 'Try adjusting your search or filter.' }}
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
        />
      )}

      

      {showCreate && (
        <DialogBackdrop onClose={() => setShowCreate(false)}>
          <form
            onSubmit={handleCreateMember}
            onClick={(e) => e.stopPropagation()}
            className="modal max-w-lg"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <UserPlusIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Register Member</h3>
                  <p className="text-xs text-ink-muted">A new member record with a generated code.</p>
                </div>
              </div>
              <button aria-label="Close" type="button" onClick={() => setShowCreate(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" aria-hidden />
              </button>
            </div>

            {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="members-full-name">Full name *</label>
                <input id="members-full-name"
                  className="input"
                  required
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="members-gender">Gender *</label>
                <select id="members-gender"
                  className="select"
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="members-phone">Phone</label>
                <input id="members-phone"
                  className="input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="members-email">Email</label>
                <input id="members-email"
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="members-programme">Programme</label>
                <select id="members-programme"
                  className="select"
                  value={selectedProgramme}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedProgramme(v);
                    setForm({ ...form, programme: v === '__other__' ? '' : v });
                  }}
                >
                  <option value="">Select programme or write manually</option>
                  {programmes.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                  <option value="__other__">Other (write manually)…</option>
                </select>
              </div>
              {selectedProgramme === '__other__' && (
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="members-programme-manual">Programme (manual)</label>
                  <input id="members-programme-manual"
                    className="input"
                    placeholder="e.g. BSc. Statistics"
                    value={form.programme}
                    onChange={(e) => setForm({ ...form, programme: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="label" htmlFor="members-year-of-study">Year of study</label>
                <input id="members-year-of-study"
                  className="input"
                  value={form.yearOfStudy}
                  onChange={(e) => setForm({ ...form, yearOfStudy: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="members-expected-graduation-year">Expected graduation year *</label>
                <input id="members-expected-graduation-year"
                  type="number"
                  className="input"
                  min={new Date().getFullYear()}
                  required
                  value={form.expectedGraduationYear}
                  onChange={(e) => setForm({ ...form, expectedGraduationYear: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label" htmlFor="members-expected-graduation-month">Expected graduation month *</label>
                <select id="members-expected-graduation-month"
                  className="select"
                  value={form.expectedGraduationMonth}
                  onChange={(e) => setForm({ ...form, expectedGraduationMonth: Number(e.target.value) })}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={creating} className="btn btn-primary flex-1">
                {creating ? <span className="spinner border-white" /> : 'Register Member'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </DialogBackdrop>
      )}

      {showUpload && (
        <DialogBackdrop onClose={() => setShowUpload(false)}>
          <form
            onSubmit={submitUpload}
            onClick={(e) => e.stopPropagation()}
            className="modal max-w-lg"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <CloudArrowUpIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Bulk Upload Members</h3>
                  <p className="text-xs text-ink-muted">Import members from a CSV file.</p>
                </div>
              </div>
              <button aria-label="Close" type="button" onClick={() => setShowUpload(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-primary-light px-4 py-3 text-sm text-ink-muted">
              Columns: <span className="font-mono text-xs">{CSV_HEADERS.join(', ')}</span>
              <br />
              <span className="text-xs text-ink-muted">Only <span className="font-mono">full_name</span> is required. Gender: male / female / other.</span>
            </div>

            <button type="button" onClick={downloadTemplate} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-dark">
              <DocumentArrowDownIcon className="h-4 w-4" />
              Download template CSV
            </button>

            {error && (
              <div className="alert alert-danger mb-4" role="alert">
                {error}
              </div>
            )}

            <label className="label" htmlFor="members-csv-file">CSV file</label>
            <input id="members-csv-file"
              type="file"
              accept=".csv,text/csv"
              required
              className="input"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />

            {uploadResult && (
              <div className="mt-4 rounded-lg border border-hairline bg-white p-4">
                <p className="text-sm font-semibold text-ink">
                  Import complete: {uploadResult.created} created, {uploadResult.failed} failed
                </p>
                {uploadResult.failures?.length > 0 && (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-rose-700">
                    {uploadResult.failures.map((f: any, idx: number) => (
                      <li key={idx}>Row {f.row}: {f.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={uploading} className="btn btn-primary flex-1">
                {uploading ? <span className="spinner border-white" /> : 'Upload & Import'}
              </button>
              <button type="button" onClick={() => setShowUpload(false)} className="btn btn-secondary flex-1">
                {uploadResult ? 'Close' : 'Cancel'}
              </button>
            </div>
          </form>
        </DialogBackdrop>
      )}
</div>
  );
}
