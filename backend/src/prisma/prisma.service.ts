import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
    super(url ? { datasources: { db: { url } } } : undefined);
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
