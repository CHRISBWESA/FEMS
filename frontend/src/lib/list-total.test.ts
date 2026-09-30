import { totalFromHeaders } from './list-total';

describe('totalFromHeaders', () => {
  it('reads the total the server reports', () => {
    expect(totalFromHeaders({ 'x-total-count': '1500' })).toBe(1500);
    expect(totalFromHeaders({ 'x-total-count': 7 })).toBe(7);
    expect(totalFromHeaders({ 'x-total-count': '0' })).toBe(0);
  });

  it('is null whenever the header is missing or is not a number, so no notice is shown', () => {
    expect(totalFromHeaders(undefined)).toBeNull();
    expect(totalFromHeaders({})).toBeNull();
    for (const bad of ['abc', '', null, undefined, {}, [], 'NaN']) expect(totalFromHeaders({ 'x-total-count': bad })).toBeNull();
  });
});
