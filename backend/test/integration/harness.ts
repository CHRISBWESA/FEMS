import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import type { PrismaService } from '../../src/prisma/prisma.service';

export const HAS_DB = !!process.env.TEST_DATABASE_URL;
export const describeDb: jest.Describe = HAS_DB ? describe : describe.skip;

// Every run creates uniquely-named data and never deletes/truncates anything, so the suite is safe to
// re-run against the same scratch database and never needs destructive cleanup.
export function uniq(): string {
  return randomBytes(4).toString('hex');
}

export async function createTestApp(): Promise<NestExpressApplication> {
  // Imported lazily so env-setup.ts has already forced DATABASE_URL to the test database.
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // Generic <NestExpressApplication> because `createNestApplication` returns the base interface, which has no `set`.
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');
  // The rate limiter keys on the client IP, which behind a proxy comes from X-Forwarded-For. Trusting the loopback
  // proxy in tests lets a spec give each test its own address (see the `clientIp` argument on `api`), so one test
  // cannot throttle the next.
  app.set('trust proxy', 'loopback');
  await app.init();
  return app;
}

/**
 * Accepts the base `INestApplication` as well as the Express one.
 *
 * `createTestApp` returns a `NestExpressApplication` (it needs `set` for `trust proxy`), but most existing specs
 * declare their `app` as the base interface. Accepting a union keeps those specs compiling, so widening the harness
 * to add trust-proxy support does not force a change to nineteen files.
 */
export type TestApp = NestExpressApplication | { getHttpServer: () => any; get: (t: any) => any };

export function getPrisma(app: TestApp): PrismaService {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaService: Prisma } = require('../../src/prisma/prisma.service');
  return app.get(Prisma);
}

export interface TestUser {
  id: string;
  email: string;
  roles: string[];
  fellowship_id: string | null;
  department_id: string | null;
  token: string;
}

export function tokenFor(user: { id: string; email: string; roles: string[] }): string {
  return jwt.sign(
    { sub: user.id, email: user.email, roles: user.roles, permissions: [] },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  );
}

export async function makeFellowship(prisma: PrismaService, label = 'F') {
  return prisma.fellowship.create({ data: { name: `${label}-${uniq()}`, created_by: randomUUID() } });
}

export async function makeDepartment(prisma: PrismaService, fellowshipId: string | null, label = 'Dept') {
  return prisma.department.create({
    data: { name: `${label}-${uniq()}`, fellowship_id: fellowshipId, is_active: true, created_by: randomUUID() },
  });
}

export async function makeUser(
  prisma: PrismaService,
  opts: { fellowshipId: string | null; roles: string[]; departmentId?: string | null },
): Promise<TestUser> {
  const email = `u${uniq()}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      password_hash: 'not-a-real-hash',
      first_name: 'Test',
      last_name: opts.roles[0],
      roles: opts.roles,
      fellowship_id: opts.fellowshipId,
      department_id: opts.departmentId ?? null,
    },
  });
  return {
    id: user.id,
    email,
    roles: opts.roles,
    fellowship_id: user.fellowship_id,
    department_id: user.department_id,
    token: tokenFor({ id: user.id, email, roles: opts.roles }),
  };
}

export async function makeMember(
  prisma: PrismaService,
  opts: { fellowshipId: string | null; name?: string; status?: 'active' | 'inactive' | 'graduated'; userId?: string },
) {
  return prisma.member.create({
    data: {
      member_code: `T${uniq()}`,
      full_name: opts.name ?? `Member ${uniq()}`,
      membership_status: opts.status ?? 'active',
      expected_graduation_year: 2035,
      expected_graduation_month: 6,
      created_by: randomUUID(),
      fellowship_id: opts.fellowshipId,
      user_id: opts.userId,
    },
  });
}

export async function addToDepartment(prisma: PrismaService, memberId: string, departmentId: string) {
  return prisma.departmentMember.create({ data: { member_id: memberId, department_id: departmentId } });
}

export async function makeActivity(
  prisma: PrismaService,
  opts: { fellowshipId: string | null; departmentId?: string | null; title?: string },
) {
  return prisma.activity.create({
    data: {
      title: opts.title ?? `Activity ${uniq()}`,
      date: new Date(),
      audience_type: opts.departmentId ? 'department' : 'all_members',
      department_id: opts.departmentId ?? null,
      fellowship_id: opts.fellowshipId,
      created_by: randomUUID(),
    },
  });
}

// Thin wrapper over supertest that prefixes the API base path and (optionally) attaches a bearer token.
export function api(app: TestApp, token?: string, clientIp?: string) {
  // `clientIp` becomes X-Forwarded-For, which the rate limiter keys on. Giving each test its own address keeps
  // one test's request count from throttling the next - and mirrors production, where every visitor is a different
  // client. Requires `trust proxy` to be set on the app, which `createTestApp` does.
  const wrap = (t: request.Test) => {
    const withAuth = token ? t.set('Authorization', `Bearer ${token}`) : t;
    return clientIp ? withAuth.set('X-Forwarded-For', clientIp) : withAuth;
  };
  const http = () => request(app.getHttpServer());
  return {
    get: (url: string) => wrap(http().get(`/api/v1${url}`)),
    post: (url: string, body: object = {}) => wrap(http().post(`/api/v1${url}`)).send(body),
    put: (url: string, body: object = {}) => wrap(http().put(`/api/v1${url}`)).send(body),
    delete: (url: string) => wrap(http().delete(`/api/v1${url}`)),
  };
}
