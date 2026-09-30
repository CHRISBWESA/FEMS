// The API bounds long lists and reports the full size in the X-Total-Count header.
export function totalFromHeaders(headers: Record<string, unknown> | undefined): number | null {
  const raw = headers?.['x-total-count'];
  const n = (typeof raw === 'string' && raw.trim() !== '') || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}
