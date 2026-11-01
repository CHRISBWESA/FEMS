import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

/**
 * Lightweight performance measurement, kept in the browser only (nothing is sent anywhere).
 *
 * Records the page load and every API call (with the server's own time and query count,
 * read from its Server-Timing header). Read it from the console with `__femsPerf.summary()`. Setting
 * localStorage `fems.perf` to `1` also prints each entry as it happens.
 */
type Entry = { kind: 'load' | 'api'; name: string; ms: number; serverMs?: number; dbMs?: number; queries?: number; at: number };

const MAX_ENTRIES = 300;
const entries: Entry[] = [];
const verbose = (() => { try { return localStorage.getItem('fems.perf') === '1'; } catch { return false; } })();

function record(e: Entry) {
  entries.push(e);
  if (entries.length > MAX_ENTRIES) entries.shift();
  // eslint-disable-next-line no-console
  if (verbose) console.debug('[perf]', e.kind, e.name, `${Math.round(e.ms)}ms`, e.serverMs !== undefined ? `(server ${e.serverMs}ms, db ${e.dbMs ?? 0}ms / ${e.queries ?? 0} queries)` : '');
}

function serverTiming(res?: AxiosResponse) {
  const h = String(res?.headers?.['server-timing'] ?? '');
  const app = /app;dur=(\d+)/.exec(h);
  const db = /db;dur=(\d+);desc="(\d+) queries"/.exec(h);
  return app ? { serverMs: Number(app[1]), dbMs: db ? Number(db[1]) : 0, queries: db ? Number(db[2]) : 0 } : {};
}

// Paths only: ids and query strings are dropped so the record holds no personal data.
const routeOf = (url = '') => url.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');

export function installPerfTiming() {
  axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    (config as any).__started = performance.now();
    return config;
  });
  const done = (res?: AxiosResponse, config?: any) => {
    if (config?.__started === undefined) return;
    record({ kind: 'api', name: `${(config.method || 'get').toUpperCase()} ${routeOf(config.url)}`, ms: performance.now() - config.__started, at: Date.now(), ...serverTiming(res) });
  };
  axios.interceptors.response.use(
    (res) => { done(res, res.config); return res; },
    (err) => { done(err?.response, err?.config); return Promise.reject(err); },
  );

  window.addEventListener('load', () => {
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return;
      record({ kind: 'load', name: 'first byte', ms: nav.responseStart, at: Date.now() });
      record({ kind: 'load', name: 'page ready (DOMContentLoaded)', ms: nav.domContentLoadedEventEnd, at: Date.now() });
      record({ kind: 'load', name: 'fully loaded', ms: nav.loadEventEnd || performance.now(), at: Date.now() });
    }, 0);
  });

  (window as any).__femsPerf = {
    entries: () => [...entries],
    summary: () => {
      const byName = new Map<string, number[]>();
      for (const e of entries) byName.set(`${e.kind} ${e.name}`, [...(byName.get(`${e.kind} ${e.name}`) ?? []), e.ms]);
      const rows = Array.from(byName, ([name, xs]) => ({ name, count: xs.length, avgMs: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), maxMs: Math.round(Math.max(...xs)) }));
      // eslint-disable-next-line no-console
      console.table(rows.sort((a, b) => b.avgMs - a.avgMs));
      return rows;
    },
  };
}

