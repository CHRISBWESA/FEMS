import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../App';
import { KeyIcon, XMarkIcon, IdentificationIcon } from '@heroicons/react/24/outline';

export default function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/profile', { withCredentials: true })
      .then(res => setProfile(res.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await axios.post('/auth/change-password', { oldPassword, newPassword }, { withCredentials: true });
      setShowChangePassword(false);
      setOldPassword('');
      setNewPassword('');
      alert('Password changed');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="spinner" />
      </div>
    );
  }

  const info = profile || {
    first_name: user?.firstName,
    last_name: user?.lastName,
    email: user?.email,
    roles: user?.roles,
  };

  const initials = `${(info.first_name || '')[0] || ''}${(info.last_name || '')[0] || ''}`.toUpperCase() || 'U';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-desc">Your account information and security settings.</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex items-center gap-4 border-b border-border pb-5">
          <div className="avatar h-14 w-14 text-lg">{initials}</div>
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {info.first_name} {info.last_name}
            </p>
            <p className="text-sm text-slate-500">{info.email}</p>
          </div>
        </div>
        <dl className="space-y-3 pt-5">
          <div className="flex justify-between gap-4">
            <dt className="text-sm text-slate-500">Roles</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              {(info.roles || []).map((role: string) => (
                <span key={role} className="status-badge status-final capitalize">
                  {role.replace('_', ' ')}
                </span>
              ))}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-sm text-slate-500">Status</dt>
            <dd>
              <span className={`status-badge ${info.is_active === false ? 'status-inactive' : 'status-active'}`}>
                {info.is_active === false ? 'Inactive' : 'Active'}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      <button
        onClick={() => setShowChangePassword(true)}
        className="btn btn-primary"
      >
        <KeyIcon className="h-4 w-4" />
        Change Password
      </button>

      {showChangePassword && (
        <div className="modal-backdrop" onClick={() => setShowChangePassword(false)}>
          <form
            onSubmit={changePassword}
            onClick={(e) => e.stopPropagation()}
            className="modal"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="stat-icon bg-primary-light text-primary">
                  <IdentificationIcon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">Change Password</h3>
              </div>
              <button type="button" onClick={() => setShowChangePassword(false)} className="p-1.5 text-slate-400 hover:text-slate-700">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="label">Current password</label>
                <input
                  type="password"
                  className="input"
                  required
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="label">New password</label>
                <input
                  type="password"
                  className="input"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="btn btn-primary flex-1">
                {saving ? <span className="spinner border-white" /> : 'Save'}
              </button>
              <button type="button" onClick={() => setShowChangePassword(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
