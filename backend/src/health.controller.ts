import { Controller, Get, Injectable, Req, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './shared/decorators/public.decorator';
import { PlatformAccess } from './shared/decorators/platform.decorators';
import { Roles } from './shared/decorators/role.decorators';
import { ROLES } from './shared/authorization/roles';
import { PERMISSIONS } from './shared/authorization/permissions';
import { requirePermission } from './platform/platform.util';

@Injectable()
export class DiagnosticsService {
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Operational facts for the platform administrator. Every figure is measured at call time from the running
   * process or the database; nothing here is a stored or hard-coded value, and nothing here exposes tenant
   * content (counts and metadata only).
   */
  async report(user: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_ANALYTICS_VIEW);
    const now = new Date();

    const [database, migrations, failedWebhooks, oldestPendingWebhook, backupRows] = await Promise.all([
      this.database(),
      this.migrations(),
      this.prisma.saasWebhookEvent.count({ where: { status: 'failed' } }),
      this.prisma.saasWebhookEvent.findFirst({ where: { status: 'received' }, orderBy: { received_at: 'asc' }, select: { received_at: true } }),
      this.prisma.backup.count(),
    ]);

    const memory = process.memoryUsage();
    return {
      generatedAt: now,
      application: {
        name: 'FEMS API',
        version: this.packageVersion(),
        node: process.version,
        environment: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
        startedAt: new Date(this.startedAt).toISOString(),
        port: Number(process.env.PORT || 3000),
        timezone: 'UTC (database sessions are pinned to UTC)',
      },
      process: {
        memoryRssMb: Math.round(memory.rss / 1_048_576),
        memoryHeapUsedMb: Math.round(memory.heapUsed / 1_048_576),
        memoryHeapTotalMb: Math.round(memory.heapTotal / 1_048_576),
        // process.cpuUsage() is cumulative CPU time for this process, not a utilisation percentage.
        cpuUserMs: Math.round(process.cpuUsage().user / 1000),
        cpuSystemMs: Math.round(process.cpuUsage().system / 1000),
      },
      database,
      migrations,
      integrations: {
        // No payment provider is connected; this reports the truth rather than implying one is.
        paymentProviderConfigured: Boolean(process.env.BILLING_WEBHOOK_SECRET && process.env.BILLING_WEBHOOK_SECRET.length >= 32),
        failedWebhookEvents: failedWebhooks,
        oldestUnprocessedWebhookAt: oldestPendingWebhook?.received_at ?? null,
        // Reported as configured/not, never as reachable: nothing in this codebase opens a Redis connection to test.
        redisConfigured: Boolean(process.env.REDIS_URL),
        backupMetadataRows: backupRows,
        applicationBackupsRunInApp: false,
      },
      notes: [
        'Rate limiting runs in-process unless REDIS_URL points at a reachable Redis, so limits are per API instance.',
        'No scheduler or job queue exists: trial and overdue transitions only run when an administrator triggers them.',
        'Backup dumps are an external operator procedure; FEMS stores metadata only and never creates or restores a dump.',
      ],
    };
  }

  private async database() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { reachable: true, latencyMs: Date.now() - startedAt };
    } catch {
      return { reachable: false, latencyMs: null };
    }
  }

  /**
   * Compares the migrations Prisma has applied against the migration folders shipped in this build, so schema
   * drift is visible without an operator shelling into the database. `_prisma_migrations` is only queried for
   * names and timestamps - never migration SQL, which may contain schema detail.
   */
  private async migrations() {
    try {
      const applied = await this.prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
        SELECT migration_name, finished_at, rolled_back_at
        FROM _prisma_migrations
        ORDER BY started_at`;
      const lastRun = applied.filter((m) => !m.rolled_back_at).at(-1);
      return {
        tableReadable: true,
        applied: applied.filter((m) => m.finished_at && !m.rolled_back_at).length,
        failed: applied.filter((m) => !m.finished_at && !m.rolled_back_at).length,
        rolledBack: applied.filter((m) => m.rolled_back_at).length,
        lastApplied: lastRun?.migration_name ?? null,
        lastAppliedAt: lastRun?.finished_at ?? null,
      };
    } catch {
      // A database that has never been migrated has no _prisma_migrations table at all.
      return { tableReadable: false, applied: 0, failed: 0, rolledBack: 0, lastApplied: null, lastAppliedAt: null };
    }
  }

  private packageVersion(): string {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
      return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly diagnostics: DiagnosticsService) {}

  @SkipThrottle()
  @Public()
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @SkipThrottle()
  @Public()
  @Get('health/ready')
  async ready() {
    return this.checkDatabase();
  }

  @SkipThrottle()
  @Public()
  @Get('health')
  async check() {
    return this.checkDatabase();
  }

  /**
   * The operational view a platform administrator signs in to see. Role-gated and permission-checked, unlike the
   * anonymous probes above, because it reports version, migration and process internals.
   */
  @PlatformAccess()
  @Roles(ROLES.ADMIN, ROLES.PLATFORM_SUPPORT)
  @Get('health/system')
  system(@Req() req) {
    return this.diagnostics.report(req.user);
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unavailable' });
    }
  }
}
