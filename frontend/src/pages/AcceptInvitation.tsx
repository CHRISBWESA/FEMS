import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircleIcon, ExclamationTriangleIcon, ShieldCheckIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { PASSWORD_HINT, storeSessionTokens } from '../lib/session';
import { Alert, Button } from '../components/ui';

/**
 * Accepting an invitation.
 *
 * The person arriving here has never signed in — that is the whole point — so this page is deliberately plain: it
 * says which fellowship is asking, which offices the invitation offers, and who sent it, and then asks for a
 * password. It shows nothing else, and there is no navigation to anywhere else.
 *
 * Two things it deliberately does NOT do:
 *  - It does not show the token. The URL is the secret; rendering it into the page would put it in any screenshot
 *    and in the browser history of a page that is, by design, unauthenticated.
 *  - It does not claim an e-mail was sent. Nothing sent it; somebody passed the link along.
 */

interface Peek {
  fellowshipName: string;
  invitedName: string;
  emailHint: string;
  roles: string[];
  invitedBy: string;
  expiresAt: string;
  usable: boolean;
  reason: string | null;
}

export default function AcceptInvitation() {
  const { token } = useParams();
  const [peek, setPeek] = useState<Peek | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    axios
      .get(`/invitations/peek/${encodeURIComponent(token ?? '')}`)
      .then((r) => {
        if (!cancelled) setPeek(r.data);
      })
      .catch((e) => {
        if (!cancelled) {
          // A bad token and a withdrawn one answer alike, so the page does not explain which it was.
          setLoadError(
            e.response?.status === 404
              ? 'This invitation link is not valid. It may have been withdrawn, or it may never have worked.'
              : e.response?.data?.message || 'Could not load this invitation.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const r = await axios.post(`/invitations/accept/${encodeURIComponent(token ?? '')}`, { password });
      // The account exists now, so sign in and hand them straight into it rather than making them type it again.
      const login = await axios.post('/auth/login', { email: r.data.email, password });
      storeSessionTokens(login.data);
      setDone(r.data.message);
      window.setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not complete the invitation.');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <div className="card p-8 text-center">
          <ExclamationTriangleIcon className="mx-auto h-10 w-10 text-ink-subtle" />
          <h1 className="mt-3 text-lg font-semibold text-ink">This invitation cannot be used</h1>
          <p className="mt-2 text-sm text-ink-muted">{loadError}</p>
          <Link to="/login" className="btn btn-secondary mt-6">Go to sign in</Link>
        </div>
      </Shell>
    );
  }

  if (!peek) {
    return (
      <Shell>
        <p className="text-sm text-ink-muted">Checking this invitation…</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="card p-8 text-center">
          <CheckCircleIcon className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="mt-3 text-lg font-semibold text-ink">Your account is ready</h1>
          <p className="mt-2 text-sm text-ink-muted">{done}</p>
          <p className="mt-4 text-xs text-ink-subtle">Taking you to your dashboard…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="card card-pad">
        <p className="eyebrow">Invitation</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{peek.fellowshipName}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {peek.invitedBy} has invited you to join as{' '}
          <span className="font-medium text-ink">{peek.roles.map(roleLabel).join(', ')}</span>.
        </p>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Invitation for {peek.emailHint} · expires{' '}
          {new Date(peek.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>

        {!peek.usable ? (
          <Alert tone="warning" className="mt-6">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{peek.reason}</p>
            </div>
          </Alert>
        ) : (
          <>
            <form className="mt-6 space-y-4" onSubmit={submit}>
              {error && <Alert tone="danger">{error}</Alert>}

              <div className="field-group">
                <label htmlFor="pw" className="label">
                  Choose a password
                  <span className="ml-0.5 text-danger">*</span>
                </label>
                <div className="relative">
                  <input
                    id="pw"
                    type={showPw ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    className="input pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Toggle show={showPw} onToggle={() => setShowPw((v) => !v)} />
                </div>
                <p className="hint">{PASSWORD_HINT}</p>
              </div>

              <div className="field-group">
                <label htmlFor="pw2" className="label">
                  Type it again
                  <span className="ml-0.5 text-danger">*</span>
                </label>
                <div className="relative">
                  <input
                    id="pw2"
                    type={showPw2 ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    className="input pr-10"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <Toggle show={showPw2} onToggle={() => setShowPw2((v) => !v)} />
                </div>
              </div>

              <Button type="submit" variant="primary" size="lg" className="btn-block" loading={busy}>
                {busy ? 'Creating your account…' : 'Accept and create my account'}
              </Button>
            </form>

            <p className="mt-6 flex items-start gap-2.5 border-t border-hairline pt-5 text-xs leading-relaxed text-ink-subtle">
              <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                This link works once. If somebody sends you another invitation to the same address, it will be refused,
                because an account already exists.
              </span>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}

function Toggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? 'Hide password' : 'Show password'}
      aria-pressed={show}
      title={show ? 'Hide password' : 'Show password'}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {show ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-primary text-base font-bold text-white">
            F
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">Fellowship Manager</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  return (
    {
      chairperson: 'Chairperson',
      assistant_chairperson: 'Assistant Chairperson',
      secretary: 'Secretary',
      assistant_secretary: 'Assistant Secretary',
      treasurer: 'Treasurer',
      it_admin: 'IT / content manager',
      ordinary_member: 'Ordinary member',
      gender_leader: 'Gender leader',
      department_secretary: 'Department secretary',
      department_chairperson: 'Department chairperson',
    } as Record<string, string>
  )[role] ?? role;
}
