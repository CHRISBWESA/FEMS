import { contributorKey, contributorLines } from './drives.service';

const m = (id: string, name: string) => ({ member_id: id, contributor_name: null, member: { full_name: name, member_code: `C-${id}` } });
const typed = (name: string) => ({ member_id: null, contributor_name: name, member: null });

describe('contribution drive contributors', () => {
  it('a pledge alone is owed in full; cash alone owes nothing', () => {
    const lines = contributorLines([{ ...m('a', 'Asha'), amount: 500 }], [{ ...m('b', 'Baraka'), amount: 300 }]);
    expect(lines.find((l) => l.name === 'Asha')).toMatchObject({ pledged: '500.00', paid: '0.00', owed: '500.00', pledges: 1, payments: 0 });
    expect(lines.find((l) => l.name === 'Baraka')).toMatchObject({ pledged: '0.00', paid: '300.00', owed: '0.00' });
  });

  it('cash paid reduces what is owed, and paying more than pledged never goes below zero', () => {
    const pledges = [{ ...m('a', 'Asha'), amount: 1000 }, { ...m('a', 'Asha'), amount: 500 }];
    const paid = [{ ...m('a', 'Asha'), amount: 400 }];
    expect(contributorLines(pledges, paid)[0]).toMatchObject({ pledged: '1500.00', paid: '400.00', owed: '1100.00', pledges: 2, payments: 1 });
    expect(contributorLines([{ ...m('a', 'Asha'), amount: 100 }], [{ ...m('a', 'Asha'), amount: 250 }])[0].owed).toBe('0.00');
  });

  it('a typed name groups the same person regardless of case and spacing, separately from members', () => {
    const lines = contributorLines([{ ...typed('John  Doe'), amount: 200 }], [{ ...typed('john doe'), amount: 50 }, { ...m('j', 'John Doe'), amount: 10 }]);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => !l.memberId)).toMatchObject({ pledged: '200.00', paid: '50.00', owed: '150.00' });
    expect(contributorKey(null, '  John   Doe ')).toBe('n:john doe');
    expect(contributorKey('x', 'ignored')).toBe('m:x');
    expect(contributorKey(null, '   ')).toBeNull();
  });

  it('an anonymous payment is shown as Anonymous, never with a name', () => {
    const [line] = contributorLines([], [{ member_id: null, contributor_name: null, contributor_type: 'anonymous', amount: 20, member: null }]);
    expect(line).toMatchObject({ name: 'Anonymous', paid: '20.00' });
  });
});
