import { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import {
  ArrowLeftIcon, BuildingOfficeIcon, UsersIcon, PlusIcon, XMarkIcon,
  UserMinusIcon, ArrowRightCircleIcon, UserPlusIcon,
} from '@heroicons/react/24/outline';

export default function DepartmentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSecretary = user?.roles.includes('secretary');
  const isDeptLeader =
    user?.roles.includes('department_secretary') || user?.roles.includes('department_chairperson');

  const [dept, setDept] = useState<any>(null);
  const [members, setMembers] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [allDepartments, setAllDepartments] = useState<any[]>([]);

  // modals
  const [showAssignLeader, setShowAssignLeader] = useState(false);
  const [leaderForm, setLeaderForm] = useState({ userId: '', roleInDepartment: 'department_chairperson' });
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({ memberId: '', toDepartmentId: '', reason: '' });
  const [showRemoval, setShowRemoval] = useState(false);
  const [removalForm, setRemovalForm] = useState({ memberId: '', reason: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchDept();
    axios.get('/departments', { withCredentials: true })
      .then(res => setAllDepartments(res.data))
      .catch(() => {});
    if (user?.roles.includes('secretary') || user?.roles.includes('admin')) {
      axios.get('/users', { withCredentials: true })
        .then(res => setUsers(Array.isArray(res.data) ? res.data : res.data.data || []))
        .catch(() => {});
    }
  }, [id]);

  const fetchDept = () => {
    setLoading(true);
    axios.get(`/departments/${id}`, { withCredentials: true })
      .then(res => { setDept(res.data); setError(''); })
      .catch(() => setError('Department not found'))
      .finally(() => setLoading(false));
  };

  const loadMembers = async () => {
    try {
      const res = await axios.get(`/departments/${id}/members`, { withCredentials: true });
      setMembers(res.data || []);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to load members');
    }
  };

  const submitAssignLeader = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.post(`/departments/${id}/leaders`, leaderForm, { withCredentials: true });
      setShowAssignLeader(false);
      fetchDept();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to assign leader');
    } finally {
      setSaving(false);
    }
  };

  const removeLeader = async (userId: string) => {
    if (!confirm('Remove this leader from the department?')) return;
    try {
      await axios.post(`/departments/${id}/leaders/${userId}/remove`, {}, { withCredentials: true });
      fetchDept();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to remove leader');
    }
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.post('/departments/transfers', {
        memberId: transferForm.memberId,
        fromDepartmentId: id,
        toDepartmentId: transferForm.toDepartmentId,
        reason: transferForm.reason,
      }, { withCredentials: true });
      setShowTransfer(false);
      setTransferForm({ memberId: '', toDepartmentId: '', reason: '' });
      alert('Transfer request submitted for approval.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to request transfer');
    } finally {
      setSaving(false);
    }
  };

  const submitRemoval = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await axios.post(`/departments/${id}/members/${removalForm.memberId}/remove`, {
        reason: removalForm.reason,
      }, { withCredentials: true });
      setShowRemoval(false);
      setRemovalForm({ memberId: '', reason: '' });
      alert('Removal request submitted for approval.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to request removal');
    } finally {
      setSaving(false);
    }
  };

  const getUserName = (userId: string) => {
    const u = users.find((x) => x.id === userId);
    return u ? `${u.first_name} ${u.last_name}` : null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }
  if (!dept) {
    return (
      <div className="empty-state">
        <p className="empty-title">{error || 'Department not found'}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <button
        onClick={() => navigate('/departments')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Departments
      </button>

      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-4">
            <div className="stat-icon bg-emerald-50 text-emerald-600">
              <BuildingOfficeIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{dept.name}</h1>
              <p className="mt-1 text-sm text-slate-500">{dept.description || 'No description'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadMembers} className="btn btn-secondary">
              <UsersIcon className="h-4 w-4" />
              View Members
            </button>
            {(isSecretary || isDeptLeader) && (
              <>
                <button onClick={() => { setError(''); setShowTransfer(true); }} className="btn btn-secondary">
                  <ArrowRightCircleIcon className="h-4 w-4" />
                  Transfer Member
                </button>
                <button onClick={() => { setError(''); setShowRemoval(true); }} className="btn btn-secondary">
                  <UserMinusIcon className="h-4 w-4" />
                  Request Removal
                </button>
              </>
            )}
            {isSecretary && (
              <button onClick={() => { setError(''); setShowAssignLeader(true); }} className="btn btn-primary">
                <PlusIcon className="h-4 w-4" />
                Assign Leader
              </button>
            )}
          </div>
        </div>

        <div className="pt-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Leadership</h2>
          {dept.leaders?.length ? (
            <ul className="divide-y divide-border">
              {dept.leaders.map((l: any) => (
                <li key={l.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-slate-900 capitalize">
                    {l.role_in_department?.replace(/_/g, ' ') || 'Leader'}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-500">{getUserName(l.user_id) || l.user_id}</span>
                    {isSecretary && (
                      <button onClick={() => removeLeader(l.user_id)} className="btn btn-icon" title="Remove leader">
                        <XMarkIcon className="h-4 w-4 text-rose-500" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No leaders assigned yet.</p>
          )}
        </div>
      </div>

      {members && (
        <div className="card mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Members ({members.length})</h2>
          </div>
          {members.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No active members in this department.</p>
          ) : (
            <div className="table-wrap overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Member Code</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {members.map((m: any) => (
                    <tr key={m.id} className="cursor-pointer" onClick={() => navigate(`/members/${m.id}`)}>
                      <td className="font-medium text-slate-900">{m.full_name}</td>
                      <td className="font-mono text-xs">{m.member_code}</td>
                      <td>{m.membership_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </div>
      )}

      {showAssignLeader && (
        <div className="modal-backdrop" onClick={() => setShowAssignLeader(false)}>
          <form onSubmit={submitAssignLeader} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <ModalHeader title="Assign Leader" desc="Add a leadership role in this department." onClose={() => setShowAssignLeader(false)} icon={<UserPlusIcon className="h-5 w-5" />} />
            <div className="space-y-4">
              <div>
                <label className="label">User *</label>
                <select
                  required
                  className="select"
                  value={leaderForm.userId}
                  onChange={(e) => setLeaderForm({ ...leaderForm, userId: e.target.value })}
                >
                  <option value="">Select a user…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Role in department *</label>
                <select
                  className="select"
                  value={leaderForm.roleInDepartment}
                  onChange={(e) => setLeaderForm({ ...leaderForm, roleInDepartment: e.target.value })}
                >
                  <option value="department_chairperson">Department Chairperson</option>
                  <option value="department_secretary">Department Secretary</option>
                </select>
              </div>
            </div>
            <SubmitRow saving={saving} label="Assign Leader" onCancel={() => setShowAssignLeader(false)} />
          </form>
        </div>
      )}

      {showTransfer && (
        <div className="modal-backdrop" onClick={() => setShowTransfer(false)}>
          <form onSubmit={submitTransfer} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <ModalHeader title="Transfer Member" desc="Request moving a member to another department." onClose={() => setShowTransfer(false)} icon={<ArrowRightCircleIcon className="h-5 w-5" />} />
            <div className="space-y-4">
              <div>
                <label className="label">Member *</label>
                <select
                  required
                  className="select"
                  value={transferForm.memberId}
                  onChange={(e) => setTransferForm({ ...transferForm, memberId: e.target.value })}
                >
                  <option value="">Select a member…</option>
                  {(members || []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Destination department *</label>
                <select
                  required
                  className="select"
                  value={transferForm.toDepartmentId}
                  onChange={(e) => setTransferForm({ ...transferForm, toDepartmentId: e.target.value })}
                >
                  <option value="">Select department…</option>
                  {allDepartments.filter((d: any) => d.id !== id && d.is_active !== false).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Reason *</label>
                <textarea
                  required
                  rows={3}
                  className="input"
                  value={transferForm.reason}
                  onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
                />
              </div>
            </div>
            <SubmitRow saving={saving} label="Submit Transfer Request" onCancel={() => setShowTransfer(false)} />
          </form>
        </div>
      )}

      {showRemoval && (
        <div className="modal-backdrop" onClick={() => setShowRemoval(false)}>
          <form onSubmit={submitRemoval} onClick={(e) => e.stopPropagation()} className="modal max-w-md">
            <ModalHeader title="Request Member Removal" desc="Goes through a two-stage approval workflow." onClose={() => setShowRemoval(false)} icon={<UserMinusIcon className="h-5 w-5" />} />
            <div className="space-y-4">
              <div>
                <label className="label">Member *</label>
                <select
                  required
                  className="select"
                  value={removalForm.memberId}
                  onChange={(e) => setRemovalForm({ ...removalForm, memberId: e.target.value })}
                >
                  <option value="">Select a member…</option>
                  {(members || []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Reason *</label>
                <textarea
                  required
                  rows={3}
                  className="input"
                  value={removalForm.reason}
                  onChange={(e) => setRemovalForm({ ...removalForm, reason: e.target.value })}
                />
              </div>
            </div>
            <SubmitRow saving={saving} label="Submit Removal Request" onCancel={() => setShowRemoval(false)} />
          </form>
        </div>
      )}
    </div>
  );
}

function ModalHeader({ title, desc, onClose, icon }: { title: string; desc: string; onClose: () => void; icon: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="stat-icon bg-primary-light text-primary">{icon}</div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{desc}</p>
        </div>
      </div>
      <button type="button" onClick={onClose} className="btn btn-icon">
        <XMarkIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

function SubmitRow({ saving, label, onCancel }: { saving: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="mt-5 flex gap-2">
      <button type="submit" disabled={saving} className="btn btn-primary flex-1">
        {saving ? <span className="spinner border-white" /> : label}
      </button>
      <button type="button" onClick={onCancel} className="btn btn-secondary flex-1">Cancel</button>
    </div>
  );
}
