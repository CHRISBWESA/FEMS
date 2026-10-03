import { useState } from 'react';
import axios from 'axios';
import { LockClosedIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { PASSWORD_HINT, storeSessionTokens } from '../lib/session';
import { onSignOut } from '../offline/session';
import { pendingCount } from '../offline/outbox';
import { useAuth } from '../App';
import { Alert, Button } from '../components/ui';

// Shown instead of the app while the account still has a temporary password. The server refuses everything else
// until it has been replaced, so this is the only thing that can work.
export default function ForcePasswordChange({ onDone }: { onDone: () => void }) {
  const { logout, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Typing the same password twice and getting it wrong is the most common failure on this screen, so each
  // field can be revealed on its own.
  const reveal = (field: string) => setVisible((v) => ({ ...v, [field]: !v[field] }));
  const field = (id: string, label: string, value: string, set: (s: string) => void, opts: { autoComplete: string; minLength?: number; hint?: string }) => (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          id={id}
          className="input pr-11"
          type={visible[id] ? 'text' : 'password'}
          autoComplete={opts.autoComplete}
          minLength={opts.minLength}
          required
          value={value}
          onChange={(e) => set(e.target.value)}
        />
        <button
          type="button"
          onClick={() => reveal(id)}
          aria-label={visible[id] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          title={visible[id] ? 'Hide' : 'Show'}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          {visible[id] ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
        </button>
      </div>
      {opts.hint && <p className="mt-1 text-xs text-slate-400">{opts.hint}</p>}
    </div>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) { setError('The two new passwords do not match.'); return; }
    setSaving(true);
    try {
      const res = await axios.post('/auth/change-password', { oldPassword: current, newPassword: next }, { withCredentials: true });
      storeSessionTokens(res.data);
      onDone();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    if (user?.id) {
      const waiting = await pendingCount(user.id).catch(() => 0);
      if (waiting > 0 && !window.confirm(`${waiting} attendance check-in${waiting === 1 ? ' has' : 's have'} not been sent yet. Signing out now will delete ${waiting === 1 ? 'it' : 'them'}. Sign out anyway?`)) return;
      await onSignOut(user.id, waiting > 0).catch(() => undefined);
    }
    await logout();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-6">
      <form onSubmit={submit} className="card w-full max-w-md card-pad space-y-5 p-6 sm:p-8">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-control bg-primary-light text-primary">
            <LockClosedIcon className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Choose your own password</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            You signed in with a temporary password. Set a new one to continue.
          </p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {field('current-pw', 'Temporary password', current, setCurrent, { autoComplete: 'current-password' })}
        {field('new-pw', 'New password', next, setNext, { autoComplete: 'new-password', minLength: 10, hint: PASSWORD_HINT })}
        {field('confirm-pw', 'Repeat the new password', confirm, setConfirm, { autoComplete: 'new-password' })}
        <Button type="submit" variant="primary" size="lg" className="btn-block" loading={saving}>
          Save and continue
        </Button>
        <Button type="button" variant="secondary" className="btn-block" onClick={signOut}>
          Sign out
        </Button>
      </form>
    </div>
  );
}
