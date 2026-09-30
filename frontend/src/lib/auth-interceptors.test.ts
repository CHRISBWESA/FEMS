import axios, { AxiosError, AxiosInstance } from 'axios';
import { createRequestId, createTokenRefresher, installAuthInterceptors } from './auth-interceptors';

// A fake server behind axios' adapter: only "Bearer good-*" tokens are accepted, /auth/refresh hands out good-N tokens.
function setup(opts: { refreshToken: string | null; refreshWorks?: boolean; failWith?: number } = { refreshToken: 'r1' }) {
  const store = { access: 'expired' as string | null, refresh: opts.refreshToken };
  const seen: { url: string; auth?: string }[] = [];
  let refreshCalls = 0;
  let ended = 0;
  const fail = (config: any, status: number) => Promise.reject(new AxiosError('failed', String(status), config, null, { status, statusText: '', data: {}, headers: {}, config } as any));
  const ok = (config: any, data: any) => Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });

  const adapter = async (config: any) => {
    seen.push({ url: config.url, auth: config.headers?.Authorization });
    if (config.url === '/auth/refresh') {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 5));
      return opts.refreshWorks === false ? fail(config, 401) : ok(config, { accessToken: `good-${refreshCalls}` });
    }
    if (config.url === '/auth/change-password') return fail(config, 401); // wrong current password: 401 whatever the token
    if (config.url === '/broken') return fail(config, opts.failWith ?? 500);
    if (String(config.headers?.Authorization ?? '').startsWith('Bearer good-')) return ok(config, { url: config.url });
    return fail(config, 401);
  };

  const client: AxiosInstance = axios.create({ adapter, baseURL: '' });
  const refreshClient = axios.create({ adapter, baseURL: '' });
  installAuthInterceptors(client, {
    getAccessToken: () => store.access,
    getRefreshToken: () => store.refresh,
    storeAccessToken: (t) => { store.access = t; },
    endSession: () => { ended++; store.access = null; store.refresh = null; },
    refreshClient,
  });
  return { client, store, seen, refreshCalls: () => refreshCalls, ended: () => ended };
}

describe('silent token refresh', () => {
  it('an expired access token is refreshed once and the request is repeated with the new token - the user notices nothing', async () => {
    const s = setup();
    const res = await s.client.get('/members');
    expect(res.data).toEqual({ url: '/members' });
    expect(s.refreshCalls()).toBe(1);
    expect(s.store.access).toBe('good-1');
    expect(s.ended()).toBe(0);
    expect(s.seen.filter((x) => x.url === '/members').map((x) => x.auth)).toEqual(['Bearer expired', 'Bearer good-1']);
  });

  it('several requests failing at the same moment share ONE refresh', async () => {
    const s = setup();
    const all = await Promise.all([s.client.get('/a'), s.client.get('/b'), s.client.get('/c')]);
    expect(all.map((r) => r.data.url)).toEqual(['/a', '/b', '/c']);
    expect(s.refreshCalls()).toBe(1);
  });

  it('a valid token is never refreshed', async () => {
    const s = setup();
    s.store.access = 'good-7';
    await s.client.get('/members');
    expect(s.refreshCalls()).toBe(0);
  });

  it('when the refresh token is refused (expired, revoked by a password change, account switched off) the session ends', async () => {
    const s = setup({ refreshToken: 'r1', refreshWorks: false });
    await expect(s.client.get('/members')).rejects.toMatchObject({ response: { status: 401 } });
    expect(s.ended()).toBe(1);
    expect(s.store.access).toBeNull();
  });

  it('with no refresh token at all the session ends right away, without calling the server', async () => {
    const s = setup({ refreshToken: null });
    await expect(s.client.get('/members')).rejects.toMatchObject({ response: { status: 401 } });
    expect(s.refreshCalls()).toBe(0);
    expect(s.ended()).toBe(1);
  });

  it('a wrong current password (401 from /auth/change-password) does not sign the user out', async () => {
    const s = setup();
    s.store.access = 'good-3';
    await expect(s.client.post('/auth/change-password', { oldPassword: 'x', newPassword: 'y' })).rejects.toMatchObject({ response: { status: 401 } });
    expect(s.ended()).toBe(0);
    expect(s.store.refresh).toBe('r1');
  });

  it('a request is repeated at most once: a token that is refreshed and still refused does not loop', async () => {
    const s = setup();
    s.store.access = 'expired';
    // change-password answers 401 for every token; it must be tried at most twice (before and after the refresh)
    await expect(s.client.post('/auth/change-password', {})).rejects.toBeDefined();
    expect(s.seen.filter((x) => x.url === '/auth/change-password').length).toBeLessThanOrEqual(2);
    expect(s.refreshCalls()).toBeLessThanOrEqual(1);
  });

  it('sign-in and refresh failures are handled by their own screens: no refresh attempt, no forced sign-out', async () => {
    const s = setup();
    await expect(s.client.post('/auth/login', {})).rejects.toMatchObject({ response: { status: 401 } });
    expect(s.refreshCalls()).toBe(0);
    expect(s.ended()).toBe(0);
  });

  it('errors that are not 401 pass straight through (network trouble and server errors keep the session)', async () => {
    const s = setup();
    await expect(s.client.get('/broken')).rejects.toMatchObject({ response: { status: 500 } });
    expect(s.refreshCalls()).toBe(0);
    expect(s.ended()).toBe(0);
    expect(s.store.access).toBe('expired');
  });

  it('every later refresh is a fresh request (the shared promise is not cached for ever)', async () => {
    let calls = 0;
    const refresh = createTokenRefresher({
      getRefreshToken: () => 'r',
      storeAccessToken: () => undefined,
      refreshClient: { post: async () => { calls++; return { data: { accessToken: `t${calls}` } } as any; } },
    });
    expect(await refresh()).toBe('t1');
    expect(await refresh()).toBe('t2');
    expect(calls).toBe(2);
  });

  it('generates a bounded request correlation id', () => {
    expect(createRequestId()).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  });

  it('a malformed refresh answer (no token) counts as a failed refresh and stores nothing', async () => {
    const stored: string[] = [];
    const refresh = createTokenRefresher({
      getRefreshToken: () => 'r',
      storeAccessToken: (t) => stored.push(t),
      refreshClient: { post: async () => ({ data: { accessToken: 42 } }) as any },
    });
    expect(await refresh()).toBeNull();
    expect(stored).toEqual([]);
  });
});
