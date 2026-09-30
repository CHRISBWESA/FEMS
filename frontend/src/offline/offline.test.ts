import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { idbPut, resetDbConnection } from './idb';
import { OutboxOp, SendFn, dismiss, enqueue, listOps, pendingCount, syncOutbox } from './outbox';
import { ROSTER_TTL_MS, hasAnyRoster, loadRoster, markRecorded, saveRoster } from './roster';
import { clearAllOfflineData, onSessionEnded, onSignOut, purgeExpired } from './session';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACT2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ok = (status: string) => (activityId: string, ops: { opId: string }[]) => ({ results: ops.map((o) => ({ opId: o.opId, status })) });
const httpError = (status?: number) => Object.assign(new Error(status ? `HTTP ${status}` : 'Network Error'), status ? { response: { status } } : {});
const sender = (fn: (activityId: string, ops: any[]) => any): SendFn & { calls: { activityId: string; ops: any[] }[] } => {
  const calls: { activityId: string; ops: any[] }[] = [];
  const f: any = async (activityId: string, ops: any[]) => { calls.push({ activityId, ops }); return fn(activityId, ops); };
  f.calls = calls;
  return f;
};

beforeEach(async () => {
  await clearAllOfflineData();
});
afterAll(() => resetDbConnection());

describe('outbox', () => {
  it('queues a check-in once per account/activity/member and keeps accounts apart', async () => {
    const first = await enqueue(A, ACT, M(1));
    const again = await enqueue(A, ACT, M(1));
    expect(again.opId).toBe(first.opId);
    await enqueue(A, ACT, M(2));
    await enqueue(A, ACT2, M(1));
    await enqueue(B, ACT, M(1));
    expect((await listOps(A)).length).toBe(3);
    expect((await listOps(A, ACT)).length).toBe(2);
    expect((await listOps(B)).length).toBe(1);
    expect(await pendingCount(A)).toBe(3);
    expect(first.opId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('stores no names or tokens with an operation', async () => {
    const op = await enqueue(A, ACT, M(1));
    expect(Object.keys(op).sort()).toEqual(['activityId', 'at', 'memberId', 'opId', 'state', 'userId']);
  });

  it('only the owner can dismiss an operation', async () => {
    const op = await enqueue(A, ACT, M(1));
    await dismiss(B, op.opId);
    expect((await listOps(A)).length).toBe(1);
    await dismiss(A, op.opId);
    expect((await listOps(A)).length).toBe(0);
  });
});

describe('sync', () => {
  it('sends pending operations and removes each only after the server confirmed it', async () => {
    await enqueue(A, ACT, M(1)); await enqueue(A, ACT, M(2)); await enqueue(A, ACT, M(3));
    const ops = await listOps(A);
    const send = sender((_a, sent) => ({ results: [{ opId: sent[0].opId, status: 'applied' }, { opId: sent[1].opId, status: 'already_recorded' }, { opId: sent[2].opId, status: 'duplicate' }] }));
    const out = await syncOutbox(A, send);
    expect(out).toMatchObject({ status: 'synced', applied: 1, confirmed: 3, rejected: 0, remaining: 0 });
    expect(send.calls).toHaveLength(1);
    expect(send.calls[0].ops.map((o) => o.opId).sort()).toEqual(ops.map((o) => o.opId).sort());
    expect(await pendingCount(A)).toBe(0);
    expect((await syncOutbox(A, send)).status).toBe('idle'); // nothing left: no request at all
    expect(send.calls).toHaveLength(1);
  });

  it('keeps rejected operations visible with the reason, and keeps ones the server gave no verdict for', async () => {
    await enqueue(A, ACT, M(1)); await enqueue(A, ACT, M(2)); await enqueue(A, ACT, M(3));
    const ops = await listOps(A);
    const send = sender((_a, sent) => ({ results: [{ opId: sent[0].opId, status: 'rejected', reason: 'member_not_found' }, { opId: sent[1].opId, status: 'applied' }] }));
    const out = await syncOutbox(A, send);
    expect(out).toMatchObject({ applied: 1, confirmed: 1, rejected: 1, remaining: 1 });
    const left = await listOps(A);
    expect(left.find((o) => o.opId === ops[0].opId)).toMatchObject({ state: 'rejected', reason: 'member_not_found' });
    expect(left.find((o) => o.opId === ops[2].opId)?.state).toBe('pending');
    // a rejected operation is never sent again
    const later = sender(ok('applied'));
    await syncOutbox(A, later);
    expect(later.calls[0].ops.map((o) => o.opId)).toEqual([ops[2].opId]); // only the one with no verdict
  });

  it('offline: nothing is lost and the next attempt sends the same operation ids (idempotent)', async () => {
    await enqueue(A, ACT, M(1)); await enqueue(A, ACT, M(2));
    const ids = (await listOps(A)).map((o) => o.opId).sort();
    const dead = sender(() => { throw httpError(); });
    const out = await syncOutbox(A, dead);
    expect(out).toMatchObject({ status: 'offline', remaining: 2 });
    const live = sender(ok('applied'));
    const out2 = await syncOutbox(A, live);
    expect(out2).toMatchObject({ status: 'synced', applied: 2, remaining: 0 });
    expect(live.calls[0].ops.map((o) => o.opId).sort()).toEqual(ids);
  });

  it('expired session: keeps everything and reports it so the user can sign in again', async () => {
    await enqueue(A, ACT, M(1));
    expect(await syncOutbox(A, sender(() => { throw httpError(401); }))).toMatchObject({ status: 'auth', remaining: 1 });
    expect(await pendingCount(A)).toBe(1);
    // after signing in again as the same account it goes through
    expect(await syncOutbox(A, sender(ok('applied')))).toMatchObject({ status: 'synced', applied: 1 });
  });

  it('permission removed while offline: nothing is discarded silently, the reason is recorded', async () => {
    await enqueue(A, ACT, M(1));
    const out = await syncOutbox(A, sender(() => { throw httpError(403); }));
    expect(out).toMatchObject({ status: 'forbidden', remaining: 1 });
    expect((await listOps(A))[0]).toMatchObject({ state: 'pending', reason: 'no_permission' });
  });

  it('deleted activity: rejected for that activity only; other activities still sync', async () => {
    await enqueue(A, ACT, M(1)); await enqueue(A, ACT2, M(2));
    const send = sender((activityId, sent) => { if (activityId === ACT) throw httpError(404); return ok('applied')(activityId, sent); });
    const out = await syncOutbox(A, send);
    expect(out).toMatchObject({ applied: 1, rejected: 1, remaining: 0 });
    const ops = await listOps(A);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ activityId: ACT, state: 'rejected', reason: 'activity_not_found' });
  });

  it('server trouble (5xx / throttling): retried later, nothing changes', async () => {
    await enqueue(A, ACT, M(1));
    for (const code of [500, 502, 429]) expect(await syncOutbox(A, sender(() => { throw httpError(code); }))).toMatchObject({ status: 'error', remaining: 1 });
    expect((await listOps(A))[0].state).toBe('pending');
  });

  it('a double tap, an online event and a timer share ONE request per account', async () => {
    await enqueue(A, ACT, M(1));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const send = sender(async (a, sent) => { await gate; return ok('applied')(a, sent); });
    const runs = [syncOutbox(A, send), syncOutbox(A, send), syncOutbox(A, send)];
    release();
    const outs = await Promise.all(runs);
    expect(send.calls).toHaveLength(1);
    expect(outs.every((o) => o.applied === 1)).toBe(true);
  });

  it('never sends another account\'s operations', async () => {
    await enqueue(A, ACT, M(1)); await enqueue(B, ACT, M(2));
    const send = sender(ok('applied'));
    await syncOutbox(B, send);
    expect(send.calls.flatMap((c) => c.ops.map((o) => o.memberId))).toEqual([M(2)]);
    expect(await pendingCount(A)).toBe(1);
  });

  it('splits large outboxes into batches of at most 200', async () => {
    for (let i = 1; i <= 450; i++) await enqueue(A, ACT, M(i));
    const send = sender(ok('applied'));
    const out = await syncOutbox(A, send);
    expect(send.calls.map((c) => c.ops.length)).toEqual([200, 200, 50]);
    expect(out).toMatchObject({ applied: 450, remaining: 0 });
  }, 30000); // 450 sequential IndexedDB writes: slow under CPU load, the default 5 s made this test flaky

  it('a failure part-way keeps what has not been confirmed', async () => {
    for (let i = 1; i <= 250; i++) await enqueue(A, ACT, M(i));
    let n = 0;
    const send = sender((a, sent) => { if (++n === 2) throw httpError(); return ok('applied')(a, sent); });
    const out = await syncOutbox(A, send);
    expect(out).toMatchObject({ status: 'offline', applied: 200, remaining: 50 });
  }, 30000);
});

describe('roster and session lifecycle', () => {
  const data = (n = 2) => ({ activity: { id: ACT, title: 'Service', date: '2026-01-01' }, members: Array.from({ length: n }, (_, i) => ({ id: M(i + 1), fullName: `Member ${i}`, memberCode: `C${i}` })), recorded: [], truncated: false });

  it('caches per account and activity and expires after 24 hours', async () => {
    const t0 = 1_000_000_000_000;
    await saveRoster(A, ACT, data(), t0);
    expect((await loadRoster(A, ACT, t0 + 1000))!.members).toHaveLength(2);
    expect(await loadRoster(B, ACT, t0 + 1000)).toBeNull(); // another account has no access to it
    expect(await loadRoster(A, ACT2, t0 + 1000)).toBeNull();
    expect(await loadRoster(A, ACT, t0 + ROSTER_TTL_MS + 1)).toBeNull();
    expect(await hasAnyRoster()).toBe(false); // an expired roster is deleted when it is found
  });

  it('remembers who is already recorded', async () => {
    await saveRoster(A, ACT, data());
    await markRecorded(A, ACT, [M(1)]);
    await markRecorded(A, ACT, [M(1), M(2)]);
    expect((await loadRoster(A, ACT))!.recorded.sort()).toEqual([M(1), M(2)]);
    await markRecorded(B, ACT, [M(3)]); // not theirs: ignored
    expect((await loadRoster(A, ACT))!.recorded).toHaveLength(2);
  });

  it('an ended session forgets downloaded member lists but keeps unsynced check-ins', async () => {
    await saveRoster(A, ACT, data());
    await enqueue(A, ACT, M(1));
    await onSessionEnded();
    expect(await hasAnyRoster()).toBe(false);
    expect(await pendingCount(A)).toBe(1);
  });

  it('signing out wipes member lists, and unsynced check-ins only when the user agrees', async () => {
    await saveRoster(A, ACT, data());
    await enqueue(A, ACT, M(1));
    await onSignOut(A, false);
    expect(await hasAnyRoster()).toBe(false);
    expect(await pendingCount(A)).toBe(1);
    await onSignOut(A, true);
    expect(await pendingCount(A)).toBe(0);
  });

  it('clears expired rosters and very old check-ins at start-up', async () => {
    const t0 = 1_000_000_000_000;
    await saveRoster(A, ACT, data(), t0);
    const old: OutboxOp = { opId: '33333333-3333-4333-8333-333333333333', userId: A, activityId: ACT, memberId: M(9), at: new Date(t0).toISOString(), state: 'pending' };
    await idbPut('outbox', old);
    await enqueue(A, ACT, M(1), new Date(t0 + 20 * 24 * 60 * 60 * 1000));
    await purgeExpired(t0 + 20 * 24 * 60 * 60 * 1000 + 1000);
    expect(await hasAnyRoster()).toBe(false);
    expect((await listOps(A)).map((o) => o.memberId)).toEqual([M(1)]);
  });
});

describe('security and PWA guards (static checks on the source)', () => {
  const root = join(__dirname, '..', '..');
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts') ? [p] : []; });

  it('the service worker never caches API responses and never intercepts API navigations', () => {
    const cfg = readFileSync(join(root, 'vite.config.mts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(cfg).not.toMatch(/NetworkFirst|StaleWhileRevalidate|CacheFirst/);
    expect(cfg).toMatch(/runtimeCaching:\s*\[\s*\]/);
    expect(cfg).toContain(String.raw`navigateFallbackDenylist: [/^\/api\//]`);
  });

  it('the offline modules store no credentials or contact details, and only idb.ts touches IndexedDB', () => {
    const offline = walk(join(root, 'src', 'offline'));
    for (const f of offline) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src).not.toMatch(/accessToken|refreshToken|localStorage|sessionStorage|password|email|phone/i);
    }
    const users = walk(join(root, 'src')).filter((f) => /indexedDB/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(root, ''));
    expect(users.map((f) => f.split(String.fromCharCode(92)).join('/'))).toEqual(['/src/offline/idb.ts']);
  });

  it('the manifest icons exist and are real PNGs of the declared size', () => {
    for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
      const p = join(root, 'public', file);
      expect(existsSync(p)).toBe(true);
      const buf = readFileSync(p);
      expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(buf.readUInt32BE(16)).toBe(size);
      expect(buf.readUInt32BE(20)).toBe(size);
    }
    const cfg = readFileSync(join(root, 'vite.config.mts'), 'utf8');
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) expect(cfg).toContain(f);
  });

  it('the page is mobile-ready: viewport-fit, theme colour and touch icon', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toMatch(/width=device-width, initial-scale=1\.0, viewport-fit=cover/);
    expect(html).toMatch(/apple-touch-icon/);
    expect(html).toMatch(/theme-color/);
  });
});
