import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../App';
import {
  UsersIcon, PlusIcon, XMarkIcon, PauseIcon, PlayIcon, UserPlusIcon,
  KeyIcon, PencilSquareIcon, ArrowPathIcon,
} from '@heroicons/react/24/outline';

const ROLE_OPTIONS = [
  { value: 'secretary', label: 'Secretary' },
  { value: 'assistant_secretary', label: 'Assistant Secretary' },
  { value: 'chairperson', label: 'Chairperson' },
  { value: 'assistant_chairperson', label: 'Assistant Chairperson' },
  { value: 'treasurer', label: 'Treasurer' },
  { value: 'department_secretary', label: 'Department Secretary' },
  { value: 'department_chairperson', label: 'Department Chairperson' },
  { value: 'gender_leader', label: 'Gender Leader' },
  { value: 'ordinary_member', label: 'Ordinary Member' },
];

export default function Users() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [resettingId, setResettingId] = useState('');

  const roleOptions = isAdmin()
    ? [{ value: 'secretary', label: 'Secretary' }]
    : ROLE_OPTIONS;

  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    roles: isAdmin() ? ['secretary'] : [] as string[],
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/users?limit=100', { withCredentials: true });
      setUsers(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const toggleRole = (role: string) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(role)
        ? f.roles.filter((r) => r !== role)
        : [...f.roles, role],
    }));
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await axios.post('/users', {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        password: form.password,
        roles: form.roles.length ? form.roles : ['ordinary_member'],
      }, { withCredentials: true });
      setShowCreate(false);
      setForm({ email: '', firstName: '', lastName: '', password: '', roles: [] });
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const setActive = async (id: string, isActive: boolean) => {
    try {
      await axios.put(`/users/${id}/${isActive ? 'activate' : 'deactivate'}`, {}, { withCredentials: true });
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const resetPassword = async (u: any) => {
    if (!window.confirm(`Reset the password for ${u.first_name} ${u.last_name}? The user must use the temporary password on next login.`)) {
      return;
    }
    setResettingId(u.id);
    try {
      const res = await axios.post('/auth/reset-password', { targetUserId: u.id }, { withCredentials: true });
      const tempPassword = res.data?.temporaryPassword || res.data?.data?.temporaryPassword;
      window.alert(
        `Password reset successful.\n\nTemporary password: ${tempPassword || 'see admin'}\n\nShare this with the user. They must change it on next login.`,
      );
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setResettingId('');
    }
  };

  const openEditEmail = (u: any) => {
    setNewEmail(u.email);
    setEditTarget(u);
  };

  const saveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setError('');
    setSavingEmail(true);
    try {
      await axios.put(`/users/${editTarget.id}`, { email: newEmail }, { withCredentials: true });
      setEditTarget(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const initials = (u: any) =>
    `${(u.first_name || '')[0] || ''}${(u.last_name || '')[0] || ''}`.toUpperCase() || 'U';

  return (
    <div className="mx-auto max-w-7xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-desc">
            {isAdmin()
              ? 'Admin can create Secretary accounts. Other leaders are created by the Secretary.'
              : 'Create leader accounts. Assigning the Admin role is restricted.'}
          </p>
        </div>
        <button onClick={() => { setError(''); setShowCreate(true); }} className="btn btn-primary">
          <PlusIcon className="h-4 w-4" />
          Add User
        </button>
      </div>

      {error && !showCreate && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <div className="stat-icon bg-slate-100 text-slate-400">
            <UsersIcon className="h-6 w-6" />
          </div>
          <p className="empty-title">No users found</p>
          <p className="empty-desc">Create a user account to get started.</p>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="avatar h-8 w-8 text-xs">{initials(u)}</div>
                      <span className="font-medium text-slate-900">
                        {u.first_name} {u.last_name}
                      </span>
                    </div>
                  </td>
                  <td className="text-slate-500">{u.email}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {(u.roles || []).map((role: string) => (
                        <span key={role} className="status-badge status-final capitalize">
                          {role.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${u.is_active === false ? 'status-inactive' : 'status-active'}`}>
                      {u.is_active === false ? 'Inactive' : 'Active'}
                    </span>
                  </td>
                  <td className="text-slate-500">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'â€”'}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => resetPassword(u)} disabled={resettingId === u.id} title="Reset Password" className="btn btn-secondary btn-sm">
                        <ArrowPathIcon className="h-4 w-4" />
                        {resettingId === u.id ? 'Resettingâ€¦' : 'Reset'}
                      </button>
                      <button onClick={() => openEditEmail(u)} title="Edit Email" className="btn btn-secondary btn-sm">
                        <PencilSquareIcon className="h-4 w-4" />
                        Edit Email
                      </button>
                      {u.is_active === false ? (
                        <button onClick={() => setActive(u.id, true)} className="btn btn-success btn-sm">
                          <PlayIcon className="h-4 w-4" />
                          Activate
                        </button>
                      ) : (
                        <button onClick={() => setActive(u.id, false)} className="btn btn-secondary btn-sm">
                          <PauseIcon className="h-4 w-4" />
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form
            onSubmit={createUser}
            onClick={(e) => e.stopPropagation()}
            className="modal max-w-lg"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <UserPlusIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Create User</h3>
                  <p className="text-xs text-slate-500">A temporary access for the new account.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1.5 text-slate-400 hover:text-slate-700">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">First name</label>
                <input
                  type="text"
                  className="input"
                  required
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Last name</label>
                <input
                  type="text"
                  className="input"
                  required
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Temporary password</label>
                <input
                  type="password"
                  className="input"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="label">Roles</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {roleOptions.map((role) => {
                  const checked = form.roles.includes(role.value);
                  return (
                    <button
                      key={role.value}
                      type="button"
                      onClick={() => toggleRole(role.value)}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        checked
                          ? 'border-primary bg-primary-light text-primary-dark font-medium'
                          : 'border-border bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {role.label}
                    </button>
                  );
                })}
              </div>
              {form.roles.length === 0 && (
                <p className="mt-1.5 text-xs text-slate-400">Defaults to Ordinary Member.</p>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={creating} className="btn btn-primary flex-1">
                {creating ? <span className="spinner border-white" /> : 'Create User'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {editTarget && (
        <div className="modal-backdrop" onClick={() => setEditTarget(null)}>
          <form
            onSubmit={saveEmail}
            onClick={(e) => e.stopPropagation()}
            className="modal max-w-md"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <KeyIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Edit Email</h3>
                  <p className="text-xs text-slate-500">
                    {editTarget.first_name} {editTarget.last_name}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setEditTarget(null)} className="btn btn-icon">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <label className="label">Email address</label>
            <input
              type="email"
              className="input"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@example.com"
            />

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={savingEmail} className="btn btn-primary flex-1">
                {savingEmail ? <span className="spinner border-white" /> : 'Save Email'}
              </button>
              <button type="button" onClick={() => setEditTarget(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
