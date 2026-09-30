// Per-route rate limits for the endpoints attackers go after. Values are read once when the module loads, so they
// can be tuned by environment variable per deployment (and lifted in tests).
//
// The global limit (app.module.ts) protects the API as a whole; these are much tighter and apply per client IP:
//   AUTH    sign-in, token refresh, password change/reset
//   PUBLIC  unauthenticated endpoints (public attendance link, billing webhook)
const num = (v: string | undefined, fallback: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

export const AUTH_THROTTLE = {
  default: { limit: num(process.env.AUTH_RATE_LIMIT_MAX, 10), ttl: num(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000) },
};

export const PUBLIC_THROTTLE = {
  default: { limit: num(process.env.PUBLIC_RATE_LIMIT_MAX, 30), ttl: num(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS, 60_000) },
};
