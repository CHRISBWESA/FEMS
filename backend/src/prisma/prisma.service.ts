import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { recordDbQuery } from '../shared/middleware/request-context.store';

// A single query slower than this is logged by name (model + action only, never its arguments).
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) || 500;

// Prisma reads and writes every DateTime as a UTC wall-clock value in `timestamp` (without time zone) columns. Raw SQL
// (`now()`, or a JS Date compared with such a column) uses the database SESSION time zone instead, so on a database whose
// time zone is not UTC the two disagree by the offset: reports shift their date boundaries by hours and, worse, the
// account lock-out written with now() lasts hours longer or shorter than intended. Forcing the session to UTC removes the
// whole class of problem. It is done with a connection option so it does not depend on how the database was configured.
// Some connection poolers (PgBouncer in transaction mode) refuse startup options: set DATABASE_FORCE_UTC_SESSION=false
// there and configure the database (ALTER DATABASE ... SET timezone TO 'UTC') instead. The application logs a warning
// at start-up whenever the session is not UTC.
export function withUtcSession(url: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!url || env.DATABASE_FORCE_UTC_SESSION === 'false') return url;
  const m = /([?&])options=([^&]*)/.exec(url);
  const existing = m ? decodeURIComponent(m[2]) : '';
  if (/time_?zone\s*=/i.test(existing)) return url; // the operator has already chosen one
  const merged = encodeURIComponent(`${existing} -c TimeZone=UTC`.trim());
  if (m) return url.replace(m[0], `${m[1]}options=${merged}`);
  return `${url}${url.includes('?') ? '&' : '?'}options=${merged}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = withUtcSession(process.env.DATABASE_URL);
    super({
      ...(url ? { datasources: { db: { url } } } : {}),
      // Interactive transactions default to 5 s, which a multi-step write (e.g. appointing a leader and creating
      // their account) can exceed when the database is in another region. Still bounded, so nothing hangs.
      transactionOptions: { maxWait: 10_000, timeout: 30_000 },
    });
    // Lightweight measurement: every query is timed (including any wait for a free connection) and counted against
    // the request being served, so the request log shows how much of each request was database time. Returning the
    // extended client keeps every method of this class (Nest's lifecycle hooks included) while routing all queries,
    // transactions included, through the timer.
    const logger = this.logger;
    return this.$extends({
      query: {
        async $allOperations({ args, query, model, operation }) {
          const started = performance.now();
          try {
            return await query(args);
          } finally {
            const ms = performance.now() - started;
            recordDbQuery(ms);
            if (ms >= SLOW_QUERY_MS) logger.warn(`Slow query ${model ?? 'raw'}.${operation} took ${Math.round(ms)}ms`);
          }
        },
      },
    }) as unknown as this;
  }

  async onModuleInit() {
    await this.$connect();
    try {
      const rows = await this.$queryRaw<{ TimeZone: string }[]>`SHOW TimeZone`;
      const tz = rows[0]?.TimeZone;
      if (tz && !/^(UTC|Etc\/UTC|GMT|Etc\/GMT)$/i.test(tz)) {
        this.logger.warn(`The database session time zone is "${tz}", not UTC. Raw SQL date logic (reports, account lock-out) can be off by the offset. Set DATABASE_FORCE_UTC_SESSION=true (the default) or ALTER DATABASE ... SET timezone TO 'UTC'.`);
      }
    } catch {
      // not a PostgreSQL connection or no permission: nothing to check
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
