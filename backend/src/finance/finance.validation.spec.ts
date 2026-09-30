import { BadRequestException } from '@nestjs/common';
import {
  assertPeriodOpen,
  expectedInstallments,
  validateAmount,
  validateDate,
  validateOptionalUuid,
  validateText,
} from './finance.validation';
import { buildEditChanges, validateFiscalYear } from './finance-effects';

describe('validateAmount', () => {
  it('accepts positive amounts with at most two decimals and returns a fixed string', () => {
    expect(validateAmount('a', 100)).toBe('100.00');
    expect(validateAmount('a', '12.5')).toBe('12.50');
    expect(validateAmount('a', 0.07)).toBe('0.07');
    expect(validateAmount('a', 999_999_999.99)).toBe('999999999.99');
  });

  it('rejects zero, negatives, NaN/Infinity, junk, too many decimals and absurd sizes', () => {
    for (const bad of [0, -1, NaN, Infinity, 'abc', '', null, undefined, {}, [], 1.005, 1e12, true]) {
      expect(() => validateAmount('a', bad as any)).toThrow(BadRequestException);
    }
  });

  it('allowZero permits exactly zero but still not negatives', () => {
    expect(validateAmount('a', 0, { allowZero: true })).toBe('0.00');
    expect(() => validateAmount('a', -0.01, { allowZero: true })).toThrow(BadRequestException);
  });
});

describe('validateDate', () => {
  it('accepts a normal date and rejects future/implausible/garbage dates', () => {
    expect(validateDate('d', '2026-01-15')).toBeInstanceOf(Date);
    expect(() => validateDate('d', '2999-01-01')).toThrow(BadRequestException);
    expect(() => validateDate('d', '1999-01-01')).toThrow(BadRequestException);
    expect(() => validateDate('d', 'garbage')).toThrow(BadRequestException);
    expect(() => validateDate('d', 12345 as any)).toThrow(BadRequestException);
  });
  it('required=false returns undefined for empty input, required (default) throws', () => {
    expect(validateDate('d', undefined, { required: false })).toBeUndefined();
    expect(() => validateDate('d', '')).toThrow(BadRequestException);
  });
});

describe('validateText / validateOptionalUuid', () => {
  it('trims, enforces max length and required', () => {
    expect(validateText('t', '  hi  ', 10)).toBe('hi');
    expect(validateText('t', '', 10)).toBeNull();
    expect(() => validateText('t', 'x'.repeat(11), 10)).toThrow(BadRequestException);
    expect(() => validateText('t', '   ', 10, true)).toThrow(BadRequestException);
    expect(() => validateText('t', 5 as any, 10)).toThrow(BadRequestException);
  });
  it('uuids are validated, empty means none', () => {
    expect(validateOptionalUuid('u', undefined)).toBeNull();
    expect(validateOptionalUuid('u', '7d3f6f0e-6b8e-4c5a-9d5e-0a1b2c3d4e5f')).toBe('7d3f6f0e-6b8e-4c5a-9d5e-0a1b2c3d4e5f');
    expect(() => validateOptionalUuid('u', "1' OR '1'='1")).toThrow(BadRequestException);
  });
});

describe('buildEditChanges (edit requests can only touch whitelisted fields)', () => {
  it('maps API names to columns and ignores everything else', () => {
    const changes = buildEditChanges('contribution', {
      amount: 50, contributionType: 'Tithe', fellowship_id: 'evil', approval_status: 'FINAL_APPROVED', member_id: 'x',
    });
    expect(changes).toEqual({ amount: '50.00', contribution_type: 'Tithe' });
  });
  it('rejects an empty change set and invalid values', () => {
    expect(() => buildEditChanges('contribution', { fellowship_id: 'evil' })).toThrow(BadRequestException);
    expect(() => buildEditChanges('expense', { amount: -1 })).toThrow(BadRequestException);
    expect(() => buildEditChanges('budget', { fiscalYear: 'someday' })).toThrow(BadRequestException);
  });
  it('validateFiscalYear accepts 2026 and 2026-27 only', () => {
    expect(validateFiscalYear('2026')).toBe('2026');
    expect(validateFiscalYear('2026-27')).toBe('2026-27');
    expect(() => validateFiscalYear('26')).toThrow(BadRequestException);
  });
});

describe('expectedInstallments', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it('counts monthly / quarterly / yearly / weekly / one-time correctly', () => {
    expect(expectedInstallments('monthly', d('2026-01-15'), d('2026-04-20'))).toBe(4);
    expect(expectedInstallments('monthly', d('2026-01-15'), d('2026-04-10'))).toBe(3); // 4th installment not yet due
    expect(expectedInstallments('quarterly', d('2026-01-01'), d('2026-07-02'))).toBe(3);
    expect(expectedInstallments('yearly', d('2024-03-01'), d('2026-03-02'))).toBe(3);
    expect(expectedInstallments('weekly', d('2026-01-01'), d('2026-01-15'))).toBe(3);
    expect(expectedInstallments('one_time', d('2026-01-01'), d('2026-06-01'))).toBe(1);
  });
  it('is zero before the start and stops at the end date', () => {
    expect(expectedInstallments('monthly', d('2026-05-01'), d('2026-04-01'))).toBe(0);
    expect(expectedInstallments('monthly', d('2026-01-01'), d('2026-12-01'), d('2026-03-15'))).toBe(3);
  });
});

describe('assertPeriodOpen', () => {
  it('throws when the date falls inside a closed period and passes otherwise', async () => {
    const closed = { financialPeriod: { findFirst: jest.fn().mockResolvedValue({ name: 'FY25 Q1' }) } };
    await expect(assertPeriodOpen(closed, 'f1', new Date('2025-02-01'))).rejects.toThrow(BadRequestException);
    const open = { financialPeriod: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(assertPeriodOpen(open, 'f1', new Date('2025-02-01'))).resolves.toBeUndefined();
    await expect(assertPeriodOpen(open, 'f1', undefined)).resolves.toBeUndefined();
    expect(open.financialPeriod.findFirst).toHaveBeenCalledTimes(1); // no lookup without a date
  });
});
