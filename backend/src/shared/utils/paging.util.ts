// Bounded lists. Every list a fellowship can grow without limit (activities, youth, reports) returns at most one page,
// newest/first in its usual order, and tells the client how many there are in all in the X-Total-Count header. The body
// stays a plain array, so existing clients keep working; they get the first DEFAULT_LIST_LIMIT rows unless they ask for
// more with ?limit= (at most MAX_LIST_LIMIT) or another page with ?page=. Measured before this: 1,500 youth records were
// one 524 KB response taking 0.5 s; an unbounded list is also an easy way to make the server do a lot of work.
export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 1000;
const MAX_PAGE = 1_000_000;

export interface ListWindow {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

const whole = (v: unknown): number => {
  const n = typeof v === 'string' || typeof v === 'number' ? Math.floor(Number(v)) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

export function listWindow(page?: unknown, limit?: unknown): ListWindow {
  const l = whole(limit);
  const p = whole(page);
  const take = l >= 1 ? Math.min(l, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
  const pageNo = p >= 1 ? Math.min(p, MAX_PAGE) : 1;
  return { page: pageNo, limit: take, skip: (pageNo - 1) * take, take };
}

// The total is only counted when the page might not hold everything (a short first page IS everything).
export async function pageResult<T>(rows: T[], w: ListWindow, count: () => Promise<number>): Promise<{ data: T[]; total: number }> {
  const total = w.page === 1 && rows.length < w.take ? rows.length : await count();
  return { data: rows, total };
}

export function withTotalHeader<T>(res: { setHeader(name: string, value: string): unknown }, result: { data: T[]; total: number }): T[] {
  res.setHeader('X-Total-Count', String(result.total));
  return result.data;
}
