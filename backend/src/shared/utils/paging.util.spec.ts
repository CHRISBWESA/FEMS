import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, listWindow, pageResult, withTotalHeader } from './paging.util';

describe('listWindow', () => {
  it('defaults to the first page of DEFAULT_LIST_LIMIT rows', () => {
    expect(listWindow()).toEqual({ page: 1, limit: DEFAULT_LIST_LIMIT, skip: 0, take: DEFAULT_LIST_LIMIT });
  });

  it('honours a sensible page and limit', () => {
    expect(listWindow('3', '20')).toEqual({ page: 3, limit: 20, skip: 40, take: 20 });
    expect(listWindow(2, 50)).toEqual({ page: 2, limit: 50, skip: 50, take: 50 });
  });

  it('caps the limit and ignores nonsense instead of failing or scanning the table', () => {
    expect(listWindow('1', '999999').take).toBe(MAX_LIST_LIMIT);
    for (const bad of ['abc', '-5', '0', '', 'NaN', 'Infinity', null, undefined, {}, [], ['5'], true]) {
      expect(listWindow(bad, bad)).toEqual({ page: 1, limit: DEFAULT_LIST_LIMIT, skip: 0, take: DEFAULT_LIST_LIMIT });
    }
    expect(listWindow('99999999999', '1000').skip).toBeLessThan(2 ** 31); // fits a database integer
    expect(listWindow('2.9', '10.7')).toEqual({ page: 2, limit: 10, skip: 10, take: 10 });
  });
});

describe('pageResult', () => {
  it('does not count when a short first page already is everything', async () => {
    const count = jest.fn();
    const out = await pageResult([1, 2, 3], listWindow(), count);
    expect(out).toEqual({ data: [1, 2, 3], total: 3 });
    expect(count).not.toHaveBeenCalled();
  });

  it('counts when the page is full or is not the first', async () => {
    const count = jest.fn().mockResolvedValue(42);
    expect(await pageResult([1, 2], listWindow('1', '2'), count)).toEqual({ data: [1, 2], total: 42 });
    expect(await pageResult([9], listWindow('3', '20'), count)).toEqual({ data: [9], total: 42 });
    expect(count).toHaveBeenCalledTimes(2);
  });
});

describe('withTotalHeader', () => {
  it('puts the total in X-Total-Count and returns the plain array', () => {
    const headers: Record<string, string> = {};
    const out = withTotalHeader({ setHeader: (n, v) => { headers[n] = v; } }, { data: ['a'], total: 7 });
    expect(out).toEqual(['a']);
    expect(headers).toEqual({ 'X-Total-Count': '7' });
  });
});
