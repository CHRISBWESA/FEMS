import { useCallback, useEffect, useRef, useState } from 'react';
import { pendingCount, SyncStatus } from './outbox';
import { OUTBOX_EVENT, runSync } from './sync-client';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * Keeps unsynced check-ins moving: tries when the app opens, when the connection returns, when the tab becomes
 * visible again and every 30 seconds while something is waiting. `runSync` is single-flight, so these triggers
 * can overlap without sending anything twice.
 */
export function useOfflineSync(userId: string | undefined) {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [syncing, setSyncing] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => { if (userId) { const n = await pendingCount(userId).catch(() => 0); if (alive.current) setPending(n); } }, [userId]);
  const sync = useCallback(async () => {
    if (!userId || !navigator.onLine) return;
    setSyncing(true);
    try { const out = await runSync(userId); if (alive.current) setStatus(out.status); } catch { if (alive.current) setStatus('error'); } finally { if (alive.current) setSyncing(false); }
    await refresh();
  }, [userId, refresh]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(OUTBOX_EVENT, onChange);
    return () => window.removeEventListener(OUTBOX_EVENT, onChange);
  }, [refresh]);
  useEffect(() => { if (online) sync(); }, [online, sync]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (pending > 0) sync(); }, 30_000);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer); };
  }, [sync, pending]);

  return { online, pending, status, syncing, sync };
}
