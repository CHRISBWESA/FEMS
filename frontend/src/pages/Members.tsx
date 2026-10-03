import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import {
  UsersIcon, MagnifyingGlassIcon, ChevronLeftIcon, ChevronRightIcon, FunnelIcon,
  PlusIcon, XMarkIcon, UserPlusIcon, CloudArrowUpIcon, DocumentArrowDownIcon,
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
  groupId: '', attendance: '' as '' | 'attended' | 'not_attended', days: '90',
};

export default function Members() {
  const { user, hasPermission } = useAuth();
  const canManage = user?.roles.includes('secretary') || user?.roles.includes('admin');
  // Advanced filters are only offered for the parts the server will actually allow this user to use.
  const canFilterProfile = hasPermission('member.profile_view');
  const canFilterGroup = hasPermission('member.groups_view');
  const canFilterEngagement = hasPermission('member.engagement_view');
  const hasAdvanced = canFilterProfile || canFilterGroup || canFilterEngagement;
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [groups, setGroups] = useState<any[]>([]);
  const [members, setMembers] = useState([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [selectedProgramme, setSelectedProgramme] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchMembers();
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
  const activeFilterCount = Object.entries(applied).filter(([k, v]) => v && !(k === 'days')).length;

  const fetchProgrammes = async () => {
    try {
      const res = await axios.get('/programmes', { withCredentials: true });
      setProgrammes(Array.isArray(res.data) ? res.data : res.data.data || []);
    } catch {
      setProgrammes([]);
    }
  };

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (applied.skills.trim()) params.set('skills', applied.skills.trim());
      if (applied.interests.trim()) params.set('interests', applied.interests.trim());
      if (applied.serviceInterests.trim()) params.set('serviceInterests', applied.serviceInterests.trim());
      if (applied.joinedFrom) params.set('joinedFrom', applied.joinedFrom);
      if (applied.joinedTo) params.set('joinedTo', applied.joinedTo);
      if (applied.groupId) params.set('groupId', applied.groupId);
      if (applied.attendance === 'attended') params.set('attendedWithinDays', applied.days);
      if (applied.attendance === 'not_attended') params.set('notAttendedWithinDays', applied.days);
      params.set('page', page.toString());
      params.set('limit', '20');

      const res = await axios.get(`/members?${params}`, { withCredentials: true });
      setMembers(res.data.data);
      setTotal(res.data.total);
    } catch (err: any) {
      console.error('Failed to fetch members:', err);
    } finally {
      setLoading(false);
    }
  };

  const createMember = async (e: React.FormEvent) => {
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
      fetchMembers();
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
  const totalPages = Math.ceil(total / pageSize);

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

      {error && !showCreate && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
          <input
            type="text"
            placeholder="Search members..."
            className="input pl-10"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
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
                  <label className="label">Skills (any of, comma separated)</label>
                  <input className="input" value={draft.skills} onChange={(e) => setDraft({ ...draft, skills: e.target.value })} />
                </div>
                <div>
                  <label className="label">Interests</label>
                  <input className="input" value={draft.interests} onChange={(e) => setDraft({ ...draft, interests: e.target.value })} />
                </div>
                <div>
                  <label className="label">Service interests</label>
                  <input className="input" value={draft.serviceInterests} onChange={(e) => setDraft({ ...draft, serviceInterests: e.target.value })} />
                </div>
                <div>
                  <label className="label">Member since (from)</label>
                  <input type="date" className="input" value={draft.joinedFrom} onChange={(e) => setDraft({ ...draft, joinedFrom: e.target.value })} />
                </div>
                <div>
                  <label className="label">Member since (to)</label>
                  <input type="date" className="input" value={draft.joinedTo} onChange={(e) => setDraft({ ...draft, joinedTo: e.target.value })} />
                </div>
              </>
            )}
            {canFilterGroup && (
              <div>
                <label className="label">Group</label>
                <select className="select" value={draft.groupId} onChange={(e) => setDraft({ ...draft, groupId: e.target.value })}>
                  <option value="">Any group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}
            {canFilterEngagement && (
              <div>
                <label className="label">Attendance (member-linked records)</label>
                <div className="flex gap-2">
                  <select className="select" value={draft.attendance} onChange={(e) => setDraft({ ...draft, attendance: e.target.value as any })}>
                    <option value="">Any</option>
                    <option value="attended">Attended within</option>
                    <option value="not_attended">Has not attended within</option>
                  </select>
                  <select className="select w-28" value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })}>
                    {['30', '90', '180', '365'].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </div>
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
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : members.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-surface-sunken text-ink-subtle">
            <UsersIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No members found</p>
          <p className="empty-desc">Try adjusting your search or filter.</p>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Member Code</th>
                <th>Status</th>
                <th>Department</th>
                {canFilterProfile && <th>Skills</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m: any) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => navigate(`/members/${m.id}`)}>
                  <td className="font-medium text-ink">{m.full_name}</td>
                  <td className="font-mono text-xs">{m.member_code}</td>
                  <td>
                    <span className={`status-badge ${getStatusClass(m.membership_status)}`}>
                      {m.membership_status}
                    </span>
                  </td>
                  <td className="text-ink-muted">
                    {m.departments?.filter((d: any) => !d.removed).map((d: any) => d.department_id || '').join(', ') || '—'}
                  </td>
                  {canFilterProfile && (
                    <td className="text-ink-muted">
                      {m.profile?.skills?.length ? m.profile.skills.slice(0, 3).join(', ') : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-ink-muted">
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn btn-secondary btn-sm"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Prev
            </button>
            <span className="text-sm text-ink-muted">Page {page} of {totalPages || 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="btn btn-secondary btn-sm"
            >
              Next
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form
            onSubmit={createMember}
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
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Full name *</label>
                <input
                  className="input"
                  required
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Gender *</label>
                <select
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
                <label className="label">Phone</label>
                <input
                  className="input"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Programme</label>
                <select
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
                  <label className="label">Programme (manual)</label>
                  <input
                    className="input"
                    placeholder="e.g. BSc. Statistics"
                    value={form.programme}
                    onChange={(e) => setForm({ ...form, programme: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="label">Year of study</label>
                <input
                  className="input"
                  value={form.yearOfStudy}
                  onChange={(e) => setForm({ ...form, yearOfStudy: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Expected graduation year *</label>
                <input
                  type="number"
                  className="input"
                  min={new Date().getFullYear()}
                  required
                  value={form.expectedGraduationYear}
                  onChange={(e) => setForm({ ...form, expectedGraduationYear: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Expected graduation month *</label>
                <select
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
        </div>
      )}

      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
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
              <button type="button" onClick={() => setShowUpload(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
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
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <label className="label">CSV file</label>
            <input
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
        </div>
      )}
    </div>
  );
}
