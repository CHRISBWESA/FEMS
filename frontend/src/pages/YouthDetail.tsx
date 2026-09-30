import { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import {
  ArrowLeftIcon, FaceSmileIcon, UserPlusIcon, XMarkIcon, TrashIcon,
  ShieldExclamationIcon, DocumentTextIcon,
} from '@heroicons/react/24/outline';

const TABS = ['Basic Info', 'Guardians', 'Attendance', 'Documents', 'Safeguarding'] as const;
type Tab = (typeof TABS)[number];

export default function YouthDetail() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();

  const canEdit = hasPermission('youth.edit');
  const canManageGuardians = hasPermission('youth.guardians_manage');
  const canViewGuardians = hasPermission('youth.guardians_view');
  const canManageAttendance = hasPermission('youth.attendance_manage');
  const canViewAttendance = hasPermission('youth.attendance_view');
  const canViewSafeguarding = hasPermission('youth.safeguarding_view');

  const [participant, setParticipant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Basic Info');

  const [guardians, setGuardians] = useState<any[] | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[] | null>(null);
  const [documents, setDocuments] = useState<any[] | null>(null);

  const [showAddGuardian, setShowAddGuardian] = useState(false);
  const [guardianForm, setGuardianForm] = useState({ guardianMemberId: '', relationshipType: '', isPrimary: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchParticipant();
  }, [id]);

  const fetchParticipant = () => {
    setLoading(true);
    axios.get(`/youth/${id}`, { withCredentials: true })
      .then((res) => { setParticipant(res.data); setError(''); })
      .catch(() => setError('Participant not found'))
      .finally(() => setLoading(false));
  };

  const loadGuardians = async () => {
    try {
      const res = await axios.get(`/youth/${id}/guardians`, { withCredentials: true });
      setGuardians(res.data || []);
      if (members.length === 0) {
        const m = await axios.get('/members', { withCredentials: true });
        setMembers(Array.isArray(m.data) ? m.data : m.data.data || []);
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to load guardians');
    }
  };

  const loadAttendance = async () => {
    try {
      const res = await axios.get(`/youth/${id}/attendance`, { withCredentials: true });
      setAttendance(res.data || []);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to load attendance');
    }
  };

  const loadDocuments = async () => {
    try {
      const res = await axios.get('/it-content/documents', { withCredentials: true });
      const all = Array.isArray(res.data) ? res.data : res.data.data || [];
      setDocuments(all.filter((d: any) => d.department_id === participant?.departmentId));
    } catch {
      setDocuments([]);
    }
  };

  const selectTab = (t: Tab) => {
    setTab(t);
    if (t === 'Guardians' && guardians === null && canViewGuardians) loadGuardians();
    if (t === 'Attendance' && attendance === null && canViewAttendance) loadAttendance();
    if (t === 'Documents' && documents === null) loadDocuments();
  };

  const submitAddGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.post(`/youth/${id}/guardians`, guardianForm, { withCredentials: true });
      setShowAddGuardian(false);
      setGuardianForm({ guardianMemberId: '', relationshipType: '', isPrimary: false });
      loadGuardians();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to add guardian');
    } finally {
      setSaving(false);
    }
  };

  const removeGuardian = async (guardianId: string) => {
    if (!confirm('Remove this guardian relationship?')) return;
    try {
      await axios.post(`/youth/${id}/guardians/${guardianId}/remove`, {}, { withCredentials: true });
      loadGuardians();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to remove guardian');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }
  if (!participant) {
    return (
      <div className="empty-state">
        <p className="empty-title">{error || 'Participant not found'}</p>
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) => {
    if (t === 'Guardians') return canViewGuardians;
    if (t === 'Attendance') return canViewAttendance;
    if (t === 'Safeguarding') return canViewSafeguarding;
    return true;
  });

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate('/youth')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Youth &amp; Children
      </button>

      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-4">
            <div className="stat-icon bg-primary-light text-primary">
              <FaceSmileIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{participant.fullName}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {participant.ageGroup?.name || 'No age group assigned'}
                {participant.age !== undefined ? ` · ${participant.age} yrs` : ''}
              </p>
            </div>
          </div>
          <span className={`status-badge ${participant.status === 'active' ? 'status-active' : 'status-inactive'}`}>
            {participant.status}
          </span>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border pt-4">
          {visibleTabs.map((t) => (
            <button
              key={t}
              onClick={() => selectTab(t)}
              className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === t ? 'bg-primary-light text-primary' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="pt-5">
          {tab === 'Basic Info' && (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Status" value={participant.status} />
              <Field label="Age Group" value={participant.ageGroup?.name || 'Unassigned'} />
              {participant.dateOfBirth && (
                <Field label="Date of Birth" value={new Date(participant.dateOfBirth).toLocaleDateString()} />
              )}
              {participant.gender && <Field label="Gender" value={participant.gender} />}
              <Field label="Department" value={participant.departmentId ? 'Assigned' : 'None'} />
              {!canEdit && (
                <p className="col-span-2 text-xs text-slate-400">
                  Some fields are hidden — you don't have permission to view full participant details.
                </p>
              )}
            </dl>
          )}

          {tab === 'Guardians' && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Guardians</h2>
                {canManageGuardians && (
                  <button onClick={() => setShowAddGuardian(true)} className="btn btn-secondary">
                    <UserPlusIcon className="h-4 w-4" />
                    Add Guardian
                  </button>
                )}
              </div>
              {!guardians?.length ? (
                <p className="py-4 text-sm text-slate-500">No guardians recorded yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {guardians.map((g: any) => (
                    <li key={g.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {g.guardianMember?.full_name || g.guardian_member_id}
                          {g.is_primary && <span className="ml-2 status-badge status-active">Primary</span>}
                        </p>
                        <p className="text-xs capitalize text-slate-500">{g.relationship_type}</p>
                      </div>
                      {canManageGuardians && (
                        <button onClick={() => removeGuardian(g.id)} className="btn btn-icon" title="Remove guardian">
                          <TrashIcon className="h-4 w-4 text-rose-500" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'Attendance' && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Attendance History</h2>
              {!attendance?.length ? (
                <p className="py-4 text-sm text-slate-500">No attendance recorded yet.</p>
              ) : (
                <div className="table-wrap overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>Activity</th><th>Date</th></tr></thead>
                    <tbody>
                      {attendance.map((a: any) => (
                        <tr key={a.id}>
                          <td>{a.activity?.title || a.activity_id}</td>
                          <td>{a.activity?.date ? new Date(a.activity.date).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {canManageAttendance && (
                <p className="mt-4 text-xs text-slate-400">
                  Record new attendance from the activity's own attendance page under Youth Programs.
                </p>
              )}
            </div>
          )}

          {tab === 'Documents' && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <DocumentTextIcon className="h-4 w-4" /> Department Documents
              </h2>
              {!documents?.length ? (
                <p className="py-4 text-sm text-slate-500">
                  No documents found for this participant's department. Documents are managed from IT Content.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {documents.map((d: any) => (
                    <li key={d.id} className="py-3 text-sm text-slate-700">{d.title}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'Safeguarding' && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <ShieldExclamationIcon className="h-4 w-4" /> Safeguarding Notes
              </h2>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {participant.notes || 'No safeguarding notes recorded.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {showAddGuardian && (
        <div className="modal-backdrop" onClick={() => setShowAddGuardian(false)}>
          <form onSubmit={submitAddGuardian} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary"><UserPlusIcon className="h-5 w-5" /></div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Add Guardian</h3>
                  <p className="text-xs text-slate-500">Link an existing fellowship member as a guardian.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowAddGuardian(false)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">Guardian Member *</label>
                <select
                  required
                  className="select"
                  value={guardianForm.guardianMemberId}
                  onChange={(e) => setGuardianForm({ ...guardianForm, guardianMemberId: e.target.value })}
                >
                  <option value="">Select a member…</option>
                  {members.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Relationship *</label>
                <input
                  required
                  className="input"
                  placeholder="e.g. parent, grandparent, guardian"
                  value={guardianForm.relationshipType}
                  onChange={(e) => setGuardianForm({ ...guardianForm, relationshipType: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={guardianForm.isPrimary}
                  onChange={(e) => setGuardianForm({ ...guardianForm, isPrimary: e.target.checked })}
                />
                Primary guardian
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Add Guardian'}
              </button>
              <button type="button" onClick={() => setShowAddGuardian(false)} className="btn btn-secondary flex-1">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900 capitalize">{value}</dd>
    </div>
  );
}
