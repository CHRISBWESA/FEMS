export const DEV_JWT_FALLBACK = 'default-secret-change-me';

type Env = Record<string, string | undefined>;

const POSITIVE_INTEGER_SETTINGS = [
  'PORT',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  'AUTH_RATE_LIMIT_MAX',
  'PUBLIC_RATE_LIMIT_WINDOW_MS',
  'PUBLIC_RATE_LIMIT_MAX',
  'UPLOAD_MAX_SIZE',
] as const;

function isPlaceholderSecret(value: string): boolean {
  return /(?:change[-_ ]?this|replace[-_ ]?me|placeholder|example|your[-_ ])/i.test(value);
}

function assertStrongSecret(name: string, value: string | undefined, required: boolean): void {
  if (!value) {
    if (required) throw new Error(`${name} must be set in production.`);
    return;
  }
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters in production.`);
  if (isPlaceholderSecret(value)) throw new Error(`${name} must not use a placeholder value in production.`);
  if (new Set(value).size < 8) throw new Error(`${name} must not be a repeated or low-variety value in production.`);
}

function validatePostgresUrl(value: string | undefined): void {
  if (!value) throw new Error('DATABASE_URL must be set in production.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL in production.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql scheme in production.');
  }
  if (!url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL must name a PostgreSQL database in production.');
  }
}

function validateFrontendOrigin(value: string | undefined): void {
  if (!value) throw new Error('FRONTEND_URL must be set in production.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FRONTEND_URL must be a valid public HTTPS origin in production.');
  }
  if (url.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)$/i.test(url.hostname)) {
    throw new Error('FRONTEND_URL must be set to the public https origin of the web app in production.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || value.endsWith('/')) {
    throw new Error('FRONTEND_URL must be an exact origin without credentials, a path, a query, a fragment, or a trailing slash.');
  }
}

export function resolveJwtSecret(env: Env = process.env): string {
  if (env.NODE_ENV === 'production') {
    assertStrongSecret('JWT_SECRET', env.JWT_SECRET, true);
    return env.JWT_SECRET!;
  }
  return env.JWT_SECRET || DEV_JWT_FALLBACK;
}

export function assertProductionConfig(env: Env = process.env): string[] {
  const warnings: string[] = [];
  if (env.NODE_ENV !== 'production') return warnings;
  resolveJwtSecret(env);
  validatePostgresUrl(env.DATABASE_URL);
  validateFrontendOrigin(env.FRONTEND_URL);
  if (env.BILLING_WEBHOOK_SECRET) assertStrongSecret('BILLING_WEBHOOK_SECRET', env.BILLING_WEBHOOK_SECRET, false);
  for (const name of POSITIVE_INTEGER_SETTINGS) {
    const raw = env[name];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0 || (name === 'PORT' && value > 65_535)) {
      throw new Error(`${name} must be a valid positive integer in production.`);
    }
  }
  if (env.DATABASE_FORCE_UTC_SESSION !== undefined && !['true', 'false'].includes(env.DATABASE_FORCE_UTC_SESSION)) {
    throw new Error('DATABASE_FORCE_UTC_SESSION must be true or false in production.');
  }
  if (!env.TRUST_PROXY) warnings.push('TRUST_PROXY is not set: verify whether the API is directly exposed or behind a reverse proxy.');
  if (!env.BILLING_WEBHOOK_SECRET) warnings.push('BILLING_WEBHOOK_SECRET is not set: billing webhooks are rejected.');
  return warnings;
}

export function parseTrustProxy(value: string | undefined): boolean | number | string | string[] | undefined {
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
