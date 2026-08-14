import { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import {
  ArrowLeftIcon, PencilSquareIcon, XMarkIcon,
} from '@heroicons/react/24/outline';

export default function MemberDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const isSecretary = user?.roles.includes('secretary');
  const [member, setMember] = useState<any>(null);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [selectedProgramme, setSelectedProgramme] = useState('');
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any>({});
  const navigate = useNavigate();

  useEffect(() => {
    if (id) {
      axios.get(`/members/${id}`, { withCredentials: true })
        .then(res => setMember(res.data))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
    axios.get('/programmes', { withCredentials: true })
      .then(res => setProgrammes(Array.isArray(res.data) ? res.data : res.data.data || []))
      .catch(() => setProgrammes([]));
  }, [id]);

  const openEdit = () => {
    const programme = member.programme || '';
    setForm({
      fullName: member.full_name,
      gender: member.gender || 'male',
      phone: member.phone || '',
      email: member.email || '',
      programme,
      yearOfStudy: member.year_of_study || '',
      expectedGraduationYear: member.expected_graduation_year || new Date().getFullYear() + 4,
      expectedGraduationMonth: member.expected_graduation_month || 6,
    });
    setSelectedProgramme(programme && programmes.some((p) => p.name === programme) ? programme : (programme ? '__other__' : ''));
    setError('');
    setShowEdit(true);
  };

  const saveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await axios.put(`/members/${id}`, {
        ...form,
        expectedGraduationYear: Number(form.expectedGraduationYear),
        expectedGraduationMonth: Number(form.expectedGraduationMonth),
      }, { withCredentials: true });
      setShowEdit(false);
      const res = await axios.get(`/members/${id}`, { withCredentials: true });
      setMember(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update member');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: string) => {
    if (!window.confirm(`Change status to ${status}?`)) return;
    try {
      await axios.put(`/members/${id}/status`, { status }, { withCredentials: true });
      const res = await axios.get(`/members/${id}`, { withCredentials: true });
      setMember(res.data);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to change status');
    }
  };

  const markGraduated = async () => {
    if (!window.confirm('Mark this member as graduated?')) return;
    try {
      await axios.put(`/members/${id}/status`, { status: 'graduated' }, { withCredentials: true });
      const res = await axios.get(`/members/${id}`, { withCredentials: true });
      setMember(res.data);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to mark graduation');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }
  if (!member) {
    return (
      <div className="empty-state">
        <p className="empty-title">Member not found</p>
      </div>
    );
  }

  const infoSections = [
    {
      title: 'Personal Information',
      rows: [
        { label: 'Member Code', value: member.member_code },
        { label: 'Email', value: member.email || '—' },
        { label: 'Phone', value: member.phone || '—' },
        { label: 'Gender', value: member.gender || '—' },
      ],
    },
    {
      title: 'Academic Information',
      rows: [
        { label: 'Programme', value: member.programme || '—' },
        { label: 'Year of Study', value: member.year_of_study || '—' },
        {
          label: 'Expected Graduation',
          value: member.expected_graduation_year
            ? `Year ${member.expected_graduation_year}, Month ${member.expected_graduation_month}`
            : '—',
        },
        {
          label: 'Departments',
          value: member.departments?.filter((d: any) => !d.removed).length > 0
            ? member.departments.filter((d: any) => !d.removed).map((d: any) => d.department_id).join(', ')
            : 'None',
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>

      <div className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{member.full_name}</h1>
            <p className="mt-1 text-sm text-slate-500">{member.member_code}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`status-badge ${member.membership_status === 'active' ? 'status-active' : member.membership_status === 'graduated' ? 'status-graduated' : 'status-inactive'}`}>
              {member.membership_status}
            </span>
            {isSecretary && (
              <>
                <button onClick={openEdit} className="btn btn-secondary btn-sm">
                  <PencilSquareIcon className="h-4 w-4" />
                  Edit
                </button>
                {member.membership_status !== 'graduated' && (
                  <>
                    <select
                      className="select w-36"
                      value={member.membership_status}
                      onChange={(e) => changeStatus(e.target.value)}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <button onClick={markGraduated} className="btn btn-secondary btn-sm">
                      Mark Graduated
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 pt-5 md:grid-cols-2">
          {infoSections.map((section) => (
            <div key={section.title}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{section.title}</h2>
              <dl className="space-y-3">
                {section.rows.map((row) => (
                  <div key={row.label} className="flex justify-between gap-4">
                    <dt className="shrink-0 text-sm text-slate-500">{row.label}</dt>
                    <dd className="text-right text-sm font-medium text-slate-900">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>

      {showEdit && (
        <div className="modal-backdrop" onClick={() => setShowEdit(false)}>
          <form
            onSubmit={saveMember}
            onClick={(e) => e.stopPropagation()}
            className="modal max-w-lg"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <PencilSquareIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Edit Member</h3>
                  <p className="text-xs text-slate-500">{member.member_code}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowEdit(false)} className="btn btn-icon">
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
                    <option key={p._id} value={p.name}>{p.name}</option>
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
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Save Changes'}
              </button>
              <button type="button" onClick={() => setShowEdit(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
