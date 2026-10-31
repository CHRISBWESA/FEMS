import { BadRequestException } from '@nestjs/common';
import { activityStatusFor } from '../shared/approval-engine/approval-engine.service';
import { dateRange, genderOf, isLeaderRole, splitName, toCsv, validateAttachments, STANDARD_DEPARTMENTS } from './department.util';

describe('department.util', () => {
  it('accepts only files uploaded to Cloudinary as attachments', () => {
    const ok = validateAttachments('files', [{ url: 'https://res.cloudinary.com/demo/image/upload/a.jpg', name: 'a.jpg', type: 'image/jpeg' }]);
    expect(ok).toEqual([{ url: 'https://res.cloudinary.com/demo/image/upload/a.jpg', name: 'a.jpg', type: 'image/jpeg' }]);
    for (const bad of [
      [{ url: 'http://res.cloudinary.com/demo/a.jpg', name: 'x' }],
      [{ url: 'https://evil.example/a.jpg', name: 'x' }],
      [{ url: 'javascript:alert(1)', name: 'x' }],
      'nope',
      Array.from({ length: 11 }, () => ({ url: 'https://res.cloudinary.com/demo/a.jpg', name: 'x' })),
    ]) {
      expect(() => validateAttachments('files', bad)).toThrow(BadRequestException);
    }
    expect(validateAttachments('files', undefined)).toEqual([]);
  });

  it('writes CSV that Excel opens safely', () => {
    const csv = toCsv(['Name', 'Note'], [['Amani, Juma', '=HYPERLINK("x")'], ['Rehema "R"', '+1'], [null, 5]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Amani, Juma"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`); // formula neutralised
    expect(csv).toContain(`"Rehema ""R"""`);
    expect(csv).toContain(`'+1`);
    expect(csv.split('\r\n')).toHaveLength(4);
  });

  it('builds inclusive date ranges and rejects reversed ones', () => {
    expect(dateRange()).toBeUndefined();
    const r = dateRange('2026-01-01', '2026-01-31')!;
    expect(r.gte!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r.lte!.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    expect(() => dateRange('2026-02-01', '2026-01-01')).toThrow(BadRequestException);
    expect(() => dateRange('soon')).toThrow(BadRequestException);
  });

  it('reads gender, roles and names without guessing', () => {
    expect(genderOf(' Female ')).toBe('female');
    expect(genderOf('other')).toBeNull();
    expect(isLeaderRole('department_secretary')).toBe(true);
    expect(isLeaderRole('secretary')).toBe(false);
    expect(splitName('Amani Juma Mwinyi')).toEqual({ first: 'Amani Juma', last: 'Mwinyi' });
    expect(splitName('Rehema')).toEqual({ first: 'Rehema', last: '' });
  });

  it('lists the ten standard departments', () => {
    expect(STANDARD_DEPARTMENTS).toEqual(['Praise', 'Choir', 'Evangelism', 'Prayers', 'Events', 'Word', 'Deacon', 'IT', 'Music', 'Decoration']);
  });

  it('maps approval states to activity statuses', () => {
    expect(activityStatusFor('SUBMITTED', 0)).toBe('PENDING_SECRETARY');
    expect(activityStatusFor('APPROVED', 1)).toBe('PENDING_CHAIRPERSON');
    expect(activityStatusFor('RESUBMITTED', 0)).toBe('PENDING_SECRETARY');
    expect(activityStatusFor('FINAL_APPROVED', 1)).toBe('APPROVED');
    expect(activityStatusFor('RETURNED', 0)).toBe('RETURNED');
    expect(activityStatusFor('REJECTED', 1)).toBe('REJECTED');
  });
});
