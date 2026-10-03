import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, CloudArrowDownIcon, MagnifyingGlassIcon, WifiIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../App';
import { OutboxOp, dismiss, enqueue, listOps } from '../../offline/outbox';
import { Roster, loadRoster } from '../../offline/roster';
import { OUTBOX_EVENT, downloadRoster, notifyOutboxChanged, runSync } from '../../offline/sync-client';
import { useOnline } from '../../offline/hooks';

const REASONS: Record<string, string> = {
  member_not_found: 'This member is no longer available.',
  activity_not_found: 'This activity no longer exists.',
  invalid: 'The server could not accept this record.',
  no_permission: 'You no longer have permission to record attendance.',
};
const SHOWN = 40;

// Record attendance for members by tapping their name. It works with or without a connection: every tap is saved
// on this device first and sent to the server as soon as possible; the server re-checks everything (who you are,
// what you may do, whether the member and activity are yours, whether it was already recorded).
export default function AttendanceCheckIn({ activityId }: { activityId: string }) {
  const { user } = useAuth();
  const userId = user?.id || '';
  const online = useOnline();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setRoster(await loadRoster(userId, activityId));
    setOps(await listOps(userId, activityId));
  }, [userId, activityId]);

  const download = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    setMessage(null);
    try {
      setRoster(await downloadRoster(userId, activityId));
      setMessage({ kind: 'ok', text: 'Member list saved on this device for 24 hours. You can now record attendance without a connection.' });
    } catch (err: any) {
      setMessage({ kind: 'error', text: err.response?.data?.message || (err.response ? 'Could not download the member list.' : 'You are offline: could not download the member list.') });
    } finally {
      setBusy(false);
    }
  }, [userId, activityId]);

  useEffect(() => {
    reload().then(() => { if (navigator.onLine) loadRoster(userId, activityId).then((r) => { if (!r) download(); }); });
    const onChange = () => reload();
    window.addEventListener(OUTBOX_EVENT, onChange);
    return () => window.removeEventListener(OUTBOX_EVENT, onChange);
  }, [reload, download, userId, activityId]);

  const pending = ops.filter((o) => o.state === 'pending');
  const rejected = ops.filter((o) => o.state === 'rejected');
  const waiting = useMemo(() => new Set(pending.map((o) => o.memberId)), [pending]);
  const recorded = useMemo(() => new Set(roster?.recorded ?? []), [roster]);
  const nameOf = useMemo(() => new Map((roster?.members ?? []).map((m) => [m.id, m.fullName])), [roster]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = roster?.members ?? [];
    return (q ? all.filter((m) => m.fullName.toLowerCase().includes(q) || m.memberCode.toLowerCase().includes(q)) : all).slice(0, SHOWN);
  }, [roster, search]);

  const mark = async (memberId: string) => {
    if (!userId || recorded.has(memberId) || waiting.has(memberId)) return;
    await enqueue(userId, activityId, memberId);
    notifyOutboxChanged();
    if (navigator.onLine) await runSync(userId);
  };

  const undo = async (op: OutboxOp) => { await dismiss(userId, op.opId); notifyOutboxChanged(); };
  const syncNow = async () => { setBusy(true); try { const out = await runSync(userId); setMessage(out.status === 'offline' ? { kind: 'info', text: 'Still offline. Your check-ins are safe on this device.' } : out.status === 'auth' ? { kind: 'error', text: 'Your session has ended. Sign in again and your check-ins will be sent.' } : out.status === 'forbidden' ? { kind: 'error', text: REASONS.no_permission } : { kind: 'ok', text: 'Synced.' }); } finally { setBusy(false); } };

  if (!userId) return null;
  return (
    <div className="mt-6 rounded-xl bg-canvas p-4 ring-1 ring-inset ring-hairline sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Record attendance</h2>
          <p className="mt-1 text-sm text-ink-muted">Tap a name to mark them present. Works offline: check-ins are kept on this device and sent when you are back online.</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}><WifiIcon className="h-3.5 w-3.5" />{online ? 'Online' : 'Offline'}</span>
      </div>

      {!roster ? (
        <div className="mt-4 rounded-lg bg-white p-4 text-sm text-ink-muted ring-1 ring-inset ring-hairline">
          {online ? 'Download the member list to start.' : 'The member list is not on this device yet. Connect once to download it, then you can work offline.'}
          <button className="btn btn-primary mt-3 min-h-11 w-full sm:w-auto" onClick={download} disabled={!online || busy}><CloudArrowDownIcon className="h-5 w-5" />{busy ? 'Downloading…' : 'Download member list'}</button>
        </div>
      ) : (
        <>
          <div className="relative mt-3">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
            <input type="search" inputMode="search" autoComplete="off" className="input min-h-11 pl-10" placeholder="Search by name or member code…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="mt-3 max-h-[50vh] divide-y divide-hairline overflow-y-auto rounded-lg bg-white ring-1 ring-inset ring-hairline">
            {visible.length === 0 && <li className="p-4 text-sm text-ink-muted">No members match.</li>}
            {visible.map((m) => {
              const isRecorded = recorded.has(m.id);
              const isWaiting = waiting.has(m.id);
              return (
                <li key={m.id}>
                  <button type="button" disabled={isRecorded || isWaiting} onClick={() => mark(m.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors enabled:hover:bg-canvas enabled:active:bg-surface-sunken disabled:cursor-default">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${isRecorded ? 'bg-emerald-500 text-white ring-emerald-500' : isWaiting ? 'bg-amber-100 text-amber-700 ring-amber-300' : 'bg-white text-transparent ring-slate-300'}`}><CheckCircleIcon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{m.fullName}</span><span className="font-mono text-xs text-ink-subtle">{m.memberCode}</span></span>
                    <span className="text-xs text-ink-muted">{isRecorded ? 'Recorded' : isWaiting ? 'Waiting to sync' : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-subtle">Showing {visible.length} of {roster.members.length}{roster.truncated ? '+' : ''} members. Member list saved {new Date(roster.savedAt).toLocaleTimeString()} · kept on this device for 24 hours and removed when you sign out.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-secondary min-h-11" onClick={download} disabled={!online || busy}><CloudArrowDownIcon className="h-4 w-4" />Refresh list</button>
          </div>
        </>
      )}

      {pending.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20">
          <p className="font-medium">{pending.length} check-in{pending.length === 1 ? '' : 's'} waiting to sync</p>
          <ul className="mt-1 space-y-1">
            {pending.map((o) => (
              <li key={o.opId} className="flex items-center justify-between gap-2"><span className="truncate">{nameOf.get(o.memberId) ?? 'Member'}{o.reason ? <span className="ml-2 text-xs text-rose-700">{REASONS[o.reason] ?? o.reason}</span> : null}</span><button className="rounded p-1.5 text-amber-800 hover:bg-amber-100" aria-label="Remove this check-in" onClick={() => undo(o)}><XMarkIcon className="h-4 w-4" /></button></li>
            ))}
          </ul>
          <button className="btn btn-primary mt-2 min-h-11 w-full sm:w-auto" onClick={syncNow} disabled={!online || busy}>{online ? 'Sync now' : 'Waiting for connection'}</button>
        </div>
      )}
      {rejected.length > 0 && (
        <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-600/20">
          <p className="font-medium">{rejected.length} check-in{rejected.length === 1 ? ' was' : 's were'} not accepted</p>
          <ul className="mt-1 space-y-1">{rejected.map((o) => <li key={o.opId} className="flex items-center justify-between gap-2"><span>{nameOf.get(o.memberId) ?? 'Member'}: {REASONS[o.reason ?? ''] ?? o.reason}</span><button className="rounded p-1.5 hover:bg-rose-100" aria-label="Dismiss" onClick={() => undo(o)}><XMarkIcon className="h-4 w-4" /></button></li>)}</ul>
        </div>
      )}
      {message && <div className={`mt-3 rounded-lg px-4 py-2 text-sm ring-1 ring-inset ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : message.kind === 'info' ? 'bg-surface-sunken text-ink ring-slate-500/20' : 'bg-rose-50 text-rose-700 ring-rose-600/20'}`}>{message.text}</div>}
    </div>
  );
}
