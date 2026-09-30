// Keeps the browser's copy of the session in step with the server after a password change: the server ends every
// earlier session at that moment and hands back a fresh one, so the current tab carries on without signing in again.
export function storeSessionTokens(data: { accessToken?: string; refreshToken?: string } | undefined): void {
  if (data?.accessToken) localStorage.setItem('accessToken', data.accessToken);
  if (data?.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
}

export const PASSWORD_HINT = 'At least 10 characters. Avoid common passwords and your own name or e-mail.';
