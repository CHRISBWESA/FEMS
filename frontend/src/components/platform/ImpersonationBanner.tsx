import { useEffect, useState } from 'react';
import axios from 'axios';
import { EyeIcon, UserIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../App';
import { currentSession, endImpersonation, hasExpired, isImpersonating } from '../../lib/impersonation';
import { Spinner, errMsg } from '../finance/common';

/**
 * Shown to the administrator while they are acting as somebody else. It is deliberately loud: the person using
 * the screen must never be able to forget whose account they are in, or edit a client's records thinking they
 * are their own.
 */
export default function ImpersonationBanner() {
  const [session, setSession] = useState(currentSession());
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSession(currentSession()); }, []);

  // Expired sessions are cleared locally as well as server-side, so a stale target token is never left behind.
  useEffect(() => {
    if (!session) return;
    if (!hasExpired(session)) return;
    const t = setTimeout(async () => {
      try {
        await axios.post(`/platform/impersonations/${session.id}/end`, { reason: 'The session reached its time limit.' });
      } catch {
        // It may already have ended; either way the local state must not survive it.
      }
      endImpersonation();
      window.location.href = '/platform';
    }, Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(t);
  }, [session]);

  if (!session) return null;

  const stop = async () => {
    if (!window.confirm(`Stop acting as ${session.targetName}?`)) return;
    setBusy(true);
    try {
      await axios.post(`/platform/impersonations/${session.id}/end`, { reason: 'Ended by the administrator.' });
    } catch (e: any) {
      if (!/already ended|no longer exists/i.test(errMsg(e, ''))) {
        alert(errMsg(e, 'Could not end the session. Reloading will end it anyway.'));
      }
    } finally {
      setBusy(false);
      endImpersonation();
      // The administrator's own identity is back, so a full reload is the safest way to resume.
      window.location.href = '/platform';
    }
  };

  const left = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 60000));

  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 bg-amber-500 px-4 py-2.5 text-white sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <EyeIcon className="h-5 w-5 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            Acting as {session.targetName} <span className="font-normal">({session.targetEmail})</span>
          </p>
          <p className="truncate text-amber-50">
            {session.fellowship} · reason: {session.reason} · ends in {left} min
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={stop}
          disabled={busy}
          className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm hover:bg-amber-50"
        >
          {busy ? <Spinner /> : 'Stop impersonating'}
        </button>
      </div>
    </div>
  );
}

/**
 * Shown to the person whose account a platform administrator is acting as. They can end it themselves - that
 * reversibility is what makes an unapproved session acceptable.
 */
export function SupportSessionBanner() {
  const { hasRole } = useAuth();
  const [active, setActive] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  // A platform account is never an impersonation target, and the client route is closed to platform roles by
  // design, so asking would only produce a 403 on every page. Skipped rather than swallowed.
  const isPlatformAccount = hasRole('admin') || hasRole('platform_support');

  useEffect(() => {
    if (isImpersonating() || isPlatformAccount) return;
    let cancelled = false;
    axios.get('/impersonation/active', { withCredentials: true })
      .then((r) => { if (!cancelled) setActive(r.data?.active ? r.data.session : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isPlatformAccount]);

  if (!active) return null;

  const end = async () => {
    setBusy(true);
    try {
      await axios.post('/impersonation/active/end', { sessionId: active.id, reason: 'Ended by the account holder.' });
      window.location.reload();
    } catch (e: any) {
      alert(e.response?.data?.message || 'Could not end the session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 bg-rose-600 px-4 py-2.5 text-white sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <UserIcon className="h-5 w-5 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{active.adminName} (platform support) is signed in as you</p>
          <p className="truncate text-rose-50">
            Reason: {active.reason} · until {new Date(active.expiresAt).toLocaleString()} · every action is recorded
          </p>
        </div>
      </div>
      <button
        onClick={end}
        disabled={busy}
        className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50"
      >
        {busy ? 'Ending…' : 'End this session'}
      </button>
    </div>
  );
}
