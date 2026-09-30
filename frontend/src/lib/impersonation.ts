// Admin-side impersonation session state.
//
// Starting an impersonation replaces the signed-in tokens with a token issued for the TARGET, so every
// subsequent request is authorised as that person. The administrator's own tokens are kept aside so that
// stopping restores exactly who was signed in before - there is no second sign-in.

const ADMIN_TOKENS = 'impersonation.adminTokens';
const SESSION = 'impersonation.session';

export interface ImpersonationState {
  id: string;
  targetName: string;
  targetEmail: string;
  fellowship: string;
  reason: string;
  expiresAt: string;
}

export function isImpersonating(): boolean {
  return !!localStorage.getItem(SESSION);
}

export function currentSession(): ImpersonationState | null {
  try {
    const raw = localStorage.getItem(SESSION);
    return raw ? (JSON.parse(raw) as ImpersonationState) : null;
  } catch {
    return null;
  }
}

/** Swap in the target's token, keeping the administrator's so the session can be reversed. */
export function beginImpersonation(session: ImpersonationState, accessToken: string, refreshToken: string): void {
  localStorage.setItem(ADMIN_TOKENS, JSON.stringify({
    accessToken: localStorage.getItem('accessToken'),
    refreshToken: localStorage.getItem('refreshToken'),
  }));
  localStorage.setItem(SESSION, JSON.stringify(session));
  localStorage.setItem('accessToken', accessToken);
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
}

/**
 * Put the administrator's own tokens back. Called after the session is ended server-side, and also whenever a
 * page load finds a session that has already expired - otherwise the browser would sit on a dead target token.
 */
export function endImpersonation(): boolean {
  const raw = localStorage.getItem(ADMIN_TOKENS);
  localStorage.removeItem(SESSION);
  localStorage.removeItem(ADMIN_TOKENS);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw) as { accessToken: string | null; refreshToken: string | null };
    if (saved.accessToken) localStorage.setItem('accessToken', saved.accessToken); else localStorage.removeItem('accessToken');
    if (saved.refreshToken) localStorage.setItem('refreshToken', saved.refreshToken); else localStorage.removeItem('refreshToken');
    return true;
  } catch {
    return false;
  }
}

/** True once the stored session has passed its expiry, even if nothing has ended it server-side yet. */
export function hasExpired(session: ImpersonationState | null): boolean {
  if (!session) return true;
  return new Date(session.expiresAt).getTime() <= Date.now();
}
