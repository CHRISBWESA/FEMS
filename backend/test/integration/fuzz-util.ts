import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Helpers shared by the request-fuzzing suites.

const SRC = path.join(__dirname, '..', '..', 'src');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [path.join(dir, e.name)] : []));

// Field names the handlers actually read, harvested from the source so that new fields are fuzzed automatically.
export function harvestKeys() {
  const body = new Set<string>();
  const query = new Set<string>();
  for (const file of walk(SRC)) {
    const s = fs.readFileSync(file, 'utf8');
    for (const m of s.matchAll(/\b(?:data|body|dto|input|payload|b)\??\.([a-zA-Z_]\w*)/g)) body.add(m[1]);
    for (const m of s.matchAll(/const\s*\{([^}]+)\}\s*=\s*(?:data|body|dto|input|payload)\b/g)) {
      for (const k of m[1].split(',')) {
        const n = k.trim().split(':')[0].split('=')[0].trim();
        if (/^[a-zA-Z_]\w*$/.test(n)) body.add(n);
      }
    }
    for (const m of s.matchAll(/@Query\(\s*'(\w+)'/g)) query.add(m[1]);
    for (const m of s.matchAll(/\b(?:query|filters|q)\??\.([a-zA-Z_]\w*)/g)) query.add(m[1]);
  }
  for (const k of ['length', 'map', 'filter', 'push', 'some', 'every', 'trim', 'toString', 'includes', 'forEach', 'find', 'slice', 'join']) {
    body.delete(k);
    query.delete(k);
  }
  return { body: [...body], query: [...query] };
}

// Which kind of seeded entity a field named "<stem>Id" refers to.
export const ID_LABEL: Record<string, string> = {
  department: 'department', owningDepartment: 'department', fromDepartment: 'department', toDepartment: 'department', relatedDepartment: 'department',
  member: 'member', coordinatorMember: 'member', custodianMember: 'member', toCustodianMember: 'member', guardianMember: 'member', custodian: 'member',
  activity: 'activity', user: 'user', targetUser: 'user', recipientUser: 'user', actor: 'user', campaign: 'campaign', category: 'finance-category',
  location: 'asset-location', fromLocation: 'asset-location', toLocation: 'asset-location', asset: 'asset', document: 'document', receiptDocument: 'document',
  group: 'member-group', ageGroup: 'age-group', role: 'service-role', period: 'financial-period', fellowship: 'fellowship', entity: 'member',
};

// A value for `key` that is plausible enough to get past the first validation, so the request reaches real code.
// `idOf(label)` supplies the ids: real ones, foreign ones, or random ones.
export function semiValid(key: string, idOf: (label: string) => string): any {
  const stem = key.replace(/(_id|Id)$/, '');
  if (/(Ids)$/.test(key)) return [idOf(ID_LABEL[key.replace(/Ids$/, '')] ?? 'member')];
  if (/(_id|Id)$/.test(key)) return idOf(ID_LABEL[stem] ?? ID_LABEL[stem.replace(/_(\w)/g, (_m, c) => c.toUpperCase())] ?? 'member');
  if (/^(ops|attachments)$/.test(key)) return [];
  if (/^(skills|interests|serviceInterests|preferredChannels|requiredSkills|required_skills|scopes|roles|modules|tags)$/.test(key)) return ['a'];
  if (/^(isActive|is_active|enabled|deactivated|immediately|isPrimary|isConsumable|isWebsiteContent|startTrial|graduated|reactivated|deptScoped|matched|registered|administrator)$/.test(key)) return true;
  if (/(date|Date|At|occurredAt)$|^(from|to|asOf|dueDate)$/.test(key)) return '2026-06-01T10:00:00.000Z';
  if (/^(year|fiscalYear|fiscal_year|expectedGraduationYear|yearOfWork)$/.test(key)) return 2026;
  if (/^(month|expectedGraduationMonth)$/.test(key)) return 6;
  if (/(amount|cost|price|quantity|capacity|delta|count|limit|page|Age|age|duration|trial|reorder|target|order|Days|days|months|yearOfStudy|Interval)/i.test(key)) return 5;
  if (/email/i.test(key)) return 'fuzz@test.local';
  if (key === 'gender') return 'female';
  return 'abc';
}

export const randomIds = (_label: string) => randomUUID();

export interface RouteInfo {
  method: string;
  path: string;
}

// Every registered route of the app (method + express path such as /api/v1/members/:id).
export function listRoutes(app: any): RouteInfo[] {
  const server: any = app.getHttpAdapter().getInstance();
  const stack: any[] = (server.router ?? server._router).stack;
  const out: RouteInfo[] = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route || typeof route.path !== 'string') continue;
    for (const m of Object.keys(route.methods)) if (route.methods[m]) out.push({ method: m.toUpperCase(), path: route.path });
  }
  return out;
}

// Handled by their own tests: sign-in/refresh/password routes would lock or re-key the personas, the webhook needs a
// signature, and the health probe is public by design.
export const OWN_TESTS = ['/api/v1/auth', '/api/v1/billing/webhooks', '/api/v1/health'];
export const fuzzableRoutes = (app: any) => listRoutes(app).filter((r) => !OWN_TESTS.some((p) => r.path.startsWith(p)) && ['GET', 'POST', 'PUT'].includes(r.method));

export const paramNames = (p: string) => [...p.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);

// Leak detector for response bodies.
export const LEAK = /PrismaClient|Invalid `prisma|node_modules|password_hash|\n\s+at\s+\S+/;
