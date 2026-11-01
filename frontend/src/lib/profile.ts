import axios from 'axios';

/**
 * The signed-in person's profile (name, roles, disabled modules), fetched once per session.
 *
 * App start-up, the sidebar and the dashboard all need it; they used to request it separately, three calls on
 * every first load. Callers now share one request. It is held in memory only and keyed by the access token, so
 * signing in as someone else (or a refreshed session) fetches it again, and nothing is written to storage.
 */
let cached: { token: string | null; request: Promise<any> } | null = null;

export function loadProfile(): Promise<any> {
  const token = localStorage.getItem('accessToken');
  if (cached && cached.token === token) return cached.request;
  const request = axios.get('/profile', { withCredentials: true }).then((r) => r.data);
  cached = { token, request };
  // A failed request is not kept, so the next caller tries again.
  request.catch(() => { if (cached?.request === request) cached = null; });
  return request;
}

export function clearProfile(): void {
  cached = null;
}
