const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prisma throws (surfacing as HTTP 500) when a malformed value is used for a @db.Uuid column, so
// ids taken from URLs, query strings or bodies must be validated before they reach a query.
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
