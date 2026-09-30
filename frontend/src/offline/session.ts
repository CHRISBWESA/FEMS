import { idbAll, idbClear, idbDelete } from './idb';
import { OUTBOX_MAX_AGE_MS, OutboxOp, listOps } from './outbox';
import { ROSTER_TTL_MS, Roster, wipeRosters } from './roster';

// Lifecycle of the offline data. The rule of thumb: downloaded personal data (rosters) goes away when the
// session ends, records the user created (outbox) are kept until they are synced or the user says otherwise.

/** Session ended by expiry or another account signing in: forget downloaded member lists, keep unsynced check-ins. */
export async function onSessionEnded(): Promise<void> {
  await wipeRosters();
}

/** The user chose to sign out (possibly abandoning unsynced check-ins). */
export async function onSignOut(userId: string, discardOutbox: boolean): Promise<void> {
  await wipeRosters();
  if (discardOutbox) for (const op of await listOps(userId)) await idbDelete('outbox', op.opId);
}

/** Runs at start-up: expired rosters and very old outbox entries are removed. */
export async function purgeExpired(now = Date.now()): Promise<void> {
  for (const r of await idbAll<Roster>('rosters')) if (now - r.savedAt > ROSTER_TTL_MS) await idbDelete('rosters', r.key);
  for (const o of await idbAll<OutboxOp>('outbox')) if (now - new Date(o.at).getTime() > OUTBOX_MAX_AGE_MS) await idbDelete('outbox', o.opId);
}

/** Everything (tests, and the "clear offline data" action). */
export async function clearAllOfflineData(): Promise<void> {
  await idbClear('rosters');
  await idbClear('outbox');
}
