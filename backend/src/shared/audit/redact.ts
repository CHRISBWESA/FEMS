// Defence in depth for the audit trail: whatever a caller passes, secrets never reach audit_logs. Callers already avoid
// putting passwords, tokens or card data in there; this makes sure a future mistake cannot leak them either.
const SENSITIVE_KEY = /pass(word|wd)|secret|token|authorization|api[_-]?key|card(_?number)?|cvv|hash|signature|otp/i;
// Harmless bookkeeping fields that merely look sensitive.
const SAFE_KEY = /^(must_?change_?password|password_?changed_?at|token_?version|failed_?login_?count|tokenType|has_?password)$/i;
const MAX_STRING = 2000;
const MAX_DEPTH = 8;

export function redactAuditPayload<T>(value: T, depth = 0): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return (value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[truncated]` : value) as unknown as T;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[nested]' as unknown as T;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactAuditPayload(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) && !SAFE_KEY.test(k) ? '[redacted]' : redactAuditPayload(v, depth + 1);
  }
  return out as T;
}
