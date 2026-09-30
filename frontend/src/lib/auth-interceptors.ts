import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

// Session handling for API calls, kept free of browser globals and Vite's import.meta so it can be unit-tested.
//
// The access token is short-lived (15 minutes by default). Until now an expired token simply signed the user out, so
// everybody had to sign in again every quarter of an hour. Now a 401 first tries the long-lived refresh token, once,
// and repeats the original request with the new access token. Only when that fails (the refresh token is expired, or
// the session was revoked by a password change / deactivation / suspension) is the session ended.

export interface AuthDeps {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  storeAccessToken(token: string): void;
  /** Called when the session is really over: wipe tokens and downloaded data, go to the sign-in page. */
  endSession(): void;
  /** A client WITHOUT these interceptors, used only for POST /auth/refresh (otherwise a failing refresh would loop). */
  refreshClient: Pick<AxiosInstance, 'post'>;
}

type Retryable = InternalAxiosRequestConfig & { _retried?: boolean };

export function createRequestId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (value) return value;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const isAuthEndpoint = (url: string | undefined) => /\/auth\/(login|refresh)(\?|$)/.test(url ?? '');

/** One refresh at a time: several requests failing together share a single /auth/refresh call. */
export function createTokenRefresher(deps: Pick<AuthDeps, 'getRefreshToken' | 'storeAccessToken' | 'refreshClient'>): () => Promise<string | null> {
  let inFlight: Promise<string | null> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const refreshToken = deps.getRefreshToken();
    if (!refreshToken) return Promise.resolve(null);
    inFlight = (async () => {
      try {
        const res = await deps.refreshClient.post('/auth/refresh', { refreshToken });
        const token = res?.data?.accessToken;
        if (typeof token !== 'string' || !token) return null;
        deps.storeAccessToken(token);
        return token;
      } catch {
        return null; // expired, revoked, offline: the caller decides what that means
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}

export function installAuthInterceptors(client: AxiosInstance, deps: AuthDeps): void {
  const refresh = createTokenRefresher(deps);

  client.interceptors.request.use((config) => {
    const token = deps.getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    const requestId = (config.headers as Record<string, unknown>)['X-Request-Id'];
    if (typeof requestId !== 'string' || !requestId) config.headers['X-Request-Id'] = createRequestId();
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as Retryable | undefined;
      if (error.response?.status === 401 && original && !isAuthEndpoint(original.url)) {
        if (!original._retried) {
          original._retried = true;
          const token = await refresh();
          if (token) {
            original.headers.Authorization = `Bearer ${token}`;
            return client(original);
          }
          deps.endSession(); // no refresh token, or it was refused: the session is really over
        }
        // Repeated with a fresh token and still 401: this endpoint answers 401 for a reason of its own (for example a
        // wrong current password on /auth/change-password), which must not sign the user out.
      }
      return Promise.reject(error);
    },
  );
}
