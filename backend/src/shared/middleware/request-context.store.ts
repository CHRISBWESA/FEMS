import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The request currently being served, reachable from any service without threading `Request` through every
 * method signature. Audit entries use it to record where an action came from (ip / user agent) even when the
 * calling service never had the request object.
 */
export interface RequestContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
  /** Database work done while serving this request (filled in by PrismaService, read by the request logger). */
  db?: { queries: number; ms: number };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Counts one database query against the request being served (no-op outside a request, e.g. scheduled jobs). */
export function recordDbQuery(ms: number): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (!ctx.db) ctx.db = { queries: 0, ms: 0 };
  ctx.db.queries += 1;
  ctx.db.ms += ms;
}

/** Best-effort client address. `trust proxy` handling is Express's job; this only normalises the value we store. */
export function clientIp(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // Strip an IPv4-mapped IPv6 prefix and any :port suffix, and cap the length so a forged header cannot bloat a row.
  const cleaned = raw.trim().replace(/^::ffff:/, '').split(',')[0].trim();
  if (!cleaned) return undefined;
  return cleaned.length > 64 ? cleaned.slice(0, 64) : cleaned;
}

/** A short, safe device description. Never stores cookies, tokens or full headers. */
export function deviceSummary(userAgent: unknown): string | undefined {
  if (typeof userAgent !== 'string') return undefined;
  const cleaned = userAgent.replace(/[\r\n\t]/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > 256 ? `${cleaned.slice(0, 253)}...` : cleaned;
}
