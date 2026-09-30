/**
 * One-off data backfill for the public-site launch.
 *
 * Two things the schema migration cannot do, because both depend on application logic:
 *
 *  1. `Fellowship.subdomain` is null for every fellowship that already exists. Without a subdomain a fellowship
 *     has no public host, so each existing one is given a free label derived from its name.
 *
 *  2. `User.permissions` is a stored array, not a view of the role table. Narrowing the `it_admin` role from
 *     "secretary plus content" to "content only" changes the role definition, but every account that already
 *     holds the role still carries the old 77-permission array. This recomputes permissions from each account's
 *     roles, which is the invariant the rest of the system already maintains.
 *
 * Safe to run repeatedly: every step is idempotent and nothing is created if it is already correct.
 *
 *   npx ts-node scripts/backfill-public-site.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { ROLES, ROLE_DEFINITIONS, permissionsForRoles, RoleName } from '../src/shared/authorization/roles';
import { suggestSubdomain } from '../src/shared/tenancy/subdomain.util';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const prisma = new PrismaClient();
  try {
    // ---- 1. Subdomains ---------------------------------------------------------------
    const fellowships = await prisma.fellowship.findMany({ select: { id: true, name: true, subdomain: true } });
    const assigned = new Set(fellowships.map((f) => f.subdomain).filter((s): s is string => Boolean(s)));
    let subdomainWrites = 0;
    for (const fellowship of fellowships) {
      if (fellowship.subdomain) continue;
      const subdomain = await suggestSubdomain(fellowship.name, (candidate) => assigned.has(candidate));
      assigned.add(subdomain);
      subdomainWrites += 1;
      console.log(`  subdomain: "${fellowship.name}" -> ${subdomain}`);
      if (!dryRun) await prisma.fellowship.update({ where: { id: fellowship.id }, data: { subdomain } });
    }
    console.log(`subdomains: ${subdomainWrites} fellowship(s) ${dryRun ? 'would be' : ''} given a label.`);

    // ---- 2. Recomputed permissions ----------------------------------------------------
    // Every role an account holds contributes its permissions, so an account with several roles keeps the union -
    // this is exactly what `assignRoles` writes, and reapplying it can only bring a stale row back in line.
    const expectedFor = (roles: string[]): string[] => permissionsForRoles(roles as RoleName[]).slice().sort();
    const users = await prisma.user.findMany({ select: { id: true, email: true, roles: true, permissions: true } });
    const permissionWrites: string[] = [];
    for (const user of users) {
      const expected = expectedFor(user.roles);
      const current = (user.permissions ?? []).slice().sort();
      if (JSON.stringify(current) === JSON.stringify(expected)) continue;
      const dropped = current.filter((p) => !expected.includes(p));
      const gained = expected.filter((p) => !current.includes(p));
      console.log(`  permissions: ${user.email} (${user.roles.join(', ') || 'no role'})`
        + `${dropped.length ? ` -${dropped.length}` : ''}${gained.length ? ` +${gained.length}` : ''}`);
      permissionWrites.push(user.email);
      if (!dryRun) {
        await prisma.user.update({ where: { id: user.id }, data: { permissions: expected } });
      }
    }
    console.log(`permissions: ${permissionWrites.length} account(s) ${dryRun ? 'would be' : ''} recomputed.`);

    // ---- 3. Report --------------------------------------------------------------------
    const itAdmin = ROLE_DEFINITIONS.find((r) => r.name === ROLES.IT_ADMIN);
    const holders = await prisma.user.findMany({ where: { roles: { has: ROLES.IT_ADMIN }, deleted_at: null }, select: { email: true, roles: true, permissions: true } });
    // Judged against the account's WHOLE role set, not just `it_admin`: someone who is both Secretary and IT
    // legitimately holds the union, and comparing them against the three content permissions alone would report
    // every healthy account as broken.
    const staleHolders = holders.filter((u) => JSON.stringify((u.permissions ?? []).slice().sort()) !== JSON.stringify(expectedFor(u.roles)));
    console.log(`\nit_admin is defined with ${itAdmin?.permissions.length ?? 0} permission(s); `
      + `${holders.length} live account(s) hold it, ${staleHolders.length} still stale.`);

    // A fellowship with no Secretary cannot approve support access and is flagged by the platform health check.
    const live = await prisma.user.findMany({ where: { deleted_at: null, is_active: true, fellowship_id: { not: null } }, select: { email: true, roles: true, fellowship_id: true } });
    const byFellowship = new Map<string, typeof live>();
    for (const u of live) byFellowship.set(u.fellowship_id!, [...(byFellowship.get(u.fellowship_id!) ?? []), u]);
    const withoutSecretary = [...byFellowship.values()].filter((us) => !us.some((u) => u.roles.includes(ROLES.SECRETARY)));
    console.log(`fellowships with live tenant accounts: ${byFellowship.size}; of those, ${withoutSecretary.length} have no Secretary.`);
    if (dryRun) console.log('\n--dry-run: nothing was written.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
