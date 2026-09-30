import { idbAllByIndex, idbDelete, idbGet, idbPut } from './idb';

// The outbox of attendance recorded on this device. The device only remembers WHAT it saw; the server decides
// again when the operations arrive (authentication, permission, tenant, duplicates), so nothing here
// duplicates business rules.

export interface OutboxOp {
  opId: string; // client-generated UUID: the server stores it under UNIQUE (user, op), so replays are harmless
  userId: string; // the account that recorded it: another account never syncs it
  activityId: string;
  memberId: string;
  at: string; // ISO time the check-in was recorded
  state: 'pending' | 'rejected';
  reason?: string; // why it is rejected / cannot be sent
}

export interface SyncResponse {
  results: { opId: string; status: 'applied' | 'duplicate' | 'already_recorded' | 'rejected'; reason?: string }[];
}
export type SendFn = (activityId: string, ops: { opId: string; memberId: string; at: string }[]) => Promise<SyncResponse>;

export type SyncStatus = 'idle' | 'synced' | 'offline' | 'auth' | 'forbidden' | 'error';
export interface SyncOutcome {
  status: SyncStatus;
  applied: number; // newly recorded on the server
  confirmed: number; // removed from the outbox (applied, duplicate or already recorded)
  rejected: number; // refused by the server: stay visible until dismissed
  remaining: number; // still waiting
}

const MAX_BATCH = 200;
export const OUTBOX_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const newId = (): string => (globalThis.crypto && 'randomUUID' in globalThis.crypto ? globalThis.crypto.randomUUID() : fallbackUuid());
function fallbackUuid(): string {
  const b = new Uint8Array(16);
  (globalThis.crypto || ({ getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) } as Crypto)).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function listOps(userId: string, activityId?: string): Promise<OutboxOp[]> {
  const all = await idbAllByIndex<OutboxOp>('outbox', 'byUser', userId);
  return all.filter((o) => !activityId || o.activityId === activityId).sort((a, b) => a.at.localeCompare(b.at));
}

/** Records one check-in. The same member is never queued twice for the same activity by the same account. */
export async function enqueue(userId: string, activityId: string, memberId: string, now = new Date()): Promise<OutboxOp> {
  const existing = (await listOps(userId, activityId)).find((o) => o.memberId === memberId && o.state === 'pending');
  if (existing) return existing;
  const op: OutboxOp = { opId: newId(), userId, activityId, memberId, at: now.toISOString(), state: 'pending' };
  await idbPut('outbox', op);
  return op;
}

export async function dismiss(userId: string, opId: string): Promise<void> {
  const op = await idbGet<OutboxOp>('outbox', opId);
  if (op && op.userId === userId) await idbDelete('outbox', opId);
}

export async function pendingCount(userId: string): Promise<number> {
  return (await listOps(userId)).filter((o) => o.state === 'pending').length;
}

const inflight = new Map<string, Promise<SyncOutcome>>();

/**
 * Sends everything pending for this account. One run per account at a time (a second call joins the first), so
 * a double tap, an `online` event and a timer can never send the same operation concurrently. Each operation is
 * removed only after the server has confirmed it.
 */
export function syncOutbox(userId: string, send: SendFn): Promise<SyncOutcome> {
  const running = inflight.get(userId);
  if (running) return running;
  const p = run(userId, send).finally(() => inflight.delete(userId));
  inflight.set(userId, p);
  return p;
}

async function run(userId: string, send: SendFn): Promise<SyncOutcome> {
  const out: SyncOutcome = { status: 'idle', applied: 0, confirmed: 0, rejected: 0, remaining: 0 };
  const pending = (await listOps(userId)).filter((o) => o.state === 'pending');
  if (pending.length === 0) return out;

  const byActivity = new Map<string, OutboxOp[]>();
  for (const o of pending) byActivity.set(o.activityId, [...(byActivity.get(o.activityId) ?? []), o]);

  outer: for (const [activityId, ops] of byActivity) {
    for (let i = 0; i < ops.length; i += MAX_BATCH) {
      const batch = ops.slice(i, i + MAX_BATCH);
      try {
        const res = await send(activityId, batch.map((o) => ({ opId: o.opId, memberId: o.memberId, at: o.at })));
        const byId = new Map(res.results.map((r) => [r.opId, r]));
        for (const o of batch) {
          const r = byId.get(o.opId);
          if (!r) continue; // no verdict: keep it for the next run
          if (r.status === 'rejected') {
            await idbPut('outbox', { ...o, state: 'rejected', reason: r.reason ?? 'rejected' } satisfies OutboxOp);
            out.rejected++;
          } else {
            await idbDelete('outbox', o.opId);
            out.confirmed++;
            if (r.status === 'applied') out.applied++;
          }
        }
        out.status = 'synced';
      } catch (err: any) {
        const code = err?.response?.status as number | undefined;
        if (!code) { out.status = 'offline'; break outer; } // no connection: keep everything
        if (code === 401) { out.status = 'auth'; break outer; } // session ended: sign in again, then it continues
        if (code === 403) {
          // Permission or fellowship access is gone. Keep the records (the user decides), say why.
          for (const o of batch) await idbPut('outbox', { ...o, reason: 'no_permission' } satisfies OutboxOp);
          out.status = 'forbidden';
          break outer;
        }
        if (code === 404 || code === 400) {
          for (const o of batch) await idbPut('outbox', { ...o, state: 'rejected', reason: code === 404 ? 'activity_not_found' : 'invalid' } satisfies OutboxOp);
          out.rejected += batch.length;
          continue outer; // try the next activity
        }
        out.status = 'error'; // 429 / 5xx: retry later
        break outer;
      }
    }
  }
  out.remaining = (await listOps(userId)).filter((o) => o.state === 'pending').length;
  return out;
}
