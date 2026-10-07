import { useState, useEffect } from 'react';
import axios from 'axios';
import { storeSessionTokens } from '../lib/session';
import { useAuth } from '../App';
import { KeyIcon, XMarkIcon, IdentificationIcon, PencilIcon } from '@heroicons/react/24/outline';
import { PageLoader } from '../components/ui';
import { Field, Input, Alert, Button } from '../components/ui';

export default function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/profile', { withCredentials: true })
      .then(res => {
        setProfile(res.data);
        setFirstName(res.data.firstName || '');
        setLastName(res.data.lastName || '');
        setEmail(res.data.email || '');
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await axios.put('/profile', { firstName, lastName, email }, { withCredentials: true });
      setProfile(res.data);
      setFirstName(res.data.firstName);
      setLastName(res.data.lastName);
      setEmail(res.data.email);
      setShowEditProfile(false);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await axios.post('/auth/change-password', { oldPassword, newPassword }, { withCredentials: true });
      storeSessionTokens(res.data);
      setShowChangePassword(false);
      setOldPassword('');
      setNewPassword('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <PageLoader rows={2} />;
  }

  const info = profile || {
    first_name: user?.firstName,
    last_name: user?.lastName,
    email: user?.email,
    roles: user?.roles,
  };

  const initials = `${(info.first_name || info.firstName || '')[0] || ''}${(info.last_name || info.lastName || '')[0] || ''}`.toUpperCase() || 'U';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-desc">Your account information and security settings.</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex items-center gap-4 border-b border-hairline pb-5">
          <div className="avatar h-14 w-14 text-lg">{initials}</div>
          <div className="flex-1">
            <p className="text-lg font-semibold text-ink">
              {info.first_name || info.firstName} {info.last_name || info.lastName}
            </p>
            <p className="text-sm text-ink-muted">{info.email}</p>
          </div>
          {showEditProfile ? (
            <Button variant="ghost" size="sm" onClick={() => { setShowEditProfile(false); setFirstName(info.first_name || info.firstName || ''); setLastName(info.last_name || info.lastName || ''); setEmail(info.email || ''); }}>
              <XMarkIcon className="h-5 w-5" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => { setShowEditProfile(true); setFirstName(info.first_name || info.firstName || ''); setLastName(info.last_name || info.lastName || ''); setEmail(info.email || ''); }}>
              <PencilIcon className="h-5 w-5" />
            </Button>
          )}
        </div>

        {showEditProfile ? (
          <form onSubmit={saveProfile} className="space-y-4 pt-5">
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name *">
                <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </Field>
              <Field label="Last name *">
                <Input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
            </div>
            <Field label="Email *">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={saving} className="flex-1">
                {saving ? <span className="spinner border-white" /> : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setShowEditProfile(false); setFirstName(info.first_name || info.firstName || ''); setLastName(info.last_name || info.lastName || ''); setEmail(info.email || ''); }} className="flex-1">
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="space-y-3 pt-5">
            <div className="flex justify-between gap-4">
              <dt className="text-sm text-ink-muted">Roles</dt>
              <dd className="flex flex-wrap justify-end gap-1.5">
                {(info.roles || []).map((role: string) => (
                  <span key={role} className="status-badge status-final capitalize">
                    {role.replace('_', ' ')}
                  </span>
                ))}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-sm text-ink-muted">Status</dt>
              <dd>
                <span className={`status-badge ${info.is_active === false ? 'status-inactive' : 'status-active'}`}>
                  {info.is_active === false ? 'Inactive' : 'Active'}
                </span>
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={() => setShowChangePassword(true)} variant="primary">
          <KeyIcon className="h-4 w-4" />
          Change Password
        </Button>
        <Button onClick={() => { setShowEditProfile(true); setFirstName(info.first_name || info.firstName || ''); setLastName(info.last_name || info.lastName || ''); setEmail(info.email || ''); }} variant="secondary">
          <PencilIcon className="h-4 w-4" />
          Edit Profile
        </Button>
      </div>

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
                <h3 className="text-base font-semibold text-ink">Change Password</h3>
              </div>
              <button type="button" onClick={() => setShowChangePassword(false)} className="p-1.5 text-ink-subtle hover:text-ink">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <Alert tone="danger" className="mb-3">{error}</Alert>
            )}

            <div className="space-y-3">
              <Field label="Current password">
                <Input type="password" required value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} />
              </Field>
              <Field label="New password">
                <Input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </Field>
            </div>

            <div className="mt-5 flex gap-2">
              <Button type="submit" disabled={saving} variant="primary" className="flex-1">
                {saving ? <span className="spinner border-white" /> : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowChangePassword(false)} className="flex-1">
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}