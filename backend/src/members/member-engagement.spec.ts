import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  isUuid,
  lastMonthKeys,
  normalizeTags,
  parseDateBoundary,
  parseIntParam,
  parseTagList,
} from './member.util';
import { buildAdvancedMemberFilters } from './member-search';
import { buildHistoryData } from './membership-history.util';
import { MembersService } from './members.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';

const user = (permissions: string[], roles: string[] = ['secretary'], extra: any = {}) => ({
  userId: 'u1',
  roles,
  permissions,
  fellowshipId: 'f1',
  ...extra,
});

describe('member.util', () => {
  it('isUuid accepts UUIDs only', () => {
    expect(isUuid('7d3f6f0e-6b8e-4c5a-9d5e-0a1b2c3d4e5f')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("' OR 1=1 --")).toBe(false);
  });

  it('normalizeTags trims, lower-cases, de-duplicates and enforces limits', () => {
    expect(normalizeTags('skills', ['  Guitar ', 'GUITAR', 'Media  Team', ''])).toEqual(['guitar', 'media team']);
    expect(() => normalizeTags('skills', 'x')).toThrow(BadRequestException);
    expect(() => normalizeTags('skills', [1 as any])).toThrow(BadRequestException);
    expect(() => normalizeTags('skills', ['x'.repeat(51)])).toThrow(BadRequestException);
    expect(() => normalizeTags('skills', Array.from({ length: 31 }, (_, i) => `t${i}`))).toThrow(BadRequestException);
  });

  it('parseTagList handles query-string lists', () => {
    expect(parseTagList('skills', 'A, b ,a')).toEqual(['a', 'b']);
    expect(parseTagList('skills', undefined)).toEqual([]);
    expect(parseTagList('skills', '')).toEqual([]);
  });

  it('parseIntParam is strict', () => {
    expect(parseIntParam('d', undefined, { min: 1, max: 9, fallback: 5 })).toBe(5);
    expect(parseIntParam('d', '3', { min: 1, max: 9 })).toBe(3);
    for (const bad of ['0', '10', 'abc', '1.5']) {
      expect(() => parseIntParam('d', bad, { min: 1, max: 9 })).toThrow(BadRequestException);
    }
  });

  it('parseDateBoundary makes an upper date-only bound inclusive of the whole day', () => {
    expect(parseDateBoundary('to', '2026-01-31', 'end')?.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    expect(parseDateBoundary('from', '2026-01-31', 'start')?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(() => parseDateBoundary('from', 'garbage', 'start')).toThrow(BadRequestException);
    expect(parseDateBoundary('from', undefined, 'start')).toBeUndefined();
  });

  it('lastMonthKeys returns the requested number of months ending with the current one', () => {
    expect(lastMonthKeys(3, new Date(Date.UTC(2026, 0, 15)))).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('buildAdvancedMemberFilters', () => {
  it('returns no clauses when no advanced filter is used (existing behaviour untouched)', () => {
    const r = buildAdvancedMemberFilters({}, user([]));
    expect(r.and).toEqual([]);
    expect(r.includeProfile).toBe(false);
  });

  it('403 when a filter is used without its permission (never silently ignored)', () => {
    expect(() => buildAdvancedMemberFilters({ skills: 'a' }, user([]))).toThrow(ForbiddenException);
    expect(() => buildAdvancedMemberFilters({ joinedFrom: '2020-01-01' }, user([]))).toThrow(ForbiddenException);
    expect(() => buildAdvancedMemberFilters({ groupId: '7d3f6f0e-6b8e-4c5a-9d5e-0a1b2c3d4e5f' }, user([]))).toThrow(
      ForbiddenException,
    );
    expect(() => buildAdvancedMemberFilters({ attendedWithinDays: 30 }, user([]))).toThrow(ForbiddenException);
  });

  it('builds AND clauses and normalizes tags when permitted', () => {
    const r = buildAdvancedMemberFilters(
      { skills: 'Guitar', interests: 'Chess', serviceInterests: 'Media' },
      user([PERMISSIONS.MEMBER_PROFILE_VIEW]),
    );
    expect(r.and).toHaveLength(3);
    expect(r.and[0]).toEqual({ profile: { is: { skills: { hasSome: ['guitar'] } } } });
    expect(r.includeProfile).toBe(true);
  });

  it('rejects malformed ids and windows with 400', () => {
    const p = user([PERMISSIONS.MEMBER_GROUPS_VIEW, PERMISSIONS.MEMBER_ENGAGEMENT_VIEW]);
    expect(() => buildAdvancedMemberFilters({ groupId: 'nope' }, p)).toThrow(BadRequestException);
    expect(() => buildAdvancedMemberFilters({ attendedWithinDays: 'abc' }, p)).toThrow(BadRequestException);
  });

  it('limits a department leader\'s attendance filter to their own department\'s activities', () => {
    const leader = user([PERMISSIONS.MEMBER_ENGAGEMENT_VIEW], ['department_secretary'], { departmentId: 'dept-1' });
    const r = buildAdvancedMemberFilters({ attendedWithinDays: 30 }, leader);
    const clause: any = r.and[0];
    expect(clause.attendances.some.activity).toEqual({ department_id: 'dept-1' });
  });
});

describe('buildHistoryData', () => {
  it('normalizes optional values to null and marks system events', () => {
    const row = buildHistoryData({ memberId: 'm1', eventType: 'registered', toStatus: 'active' });
    expect(row).toMatchObject({
      member_id: 'm1',
      event_type: 'registered',
      from_status: null,
      to_status: 'active',
      recorded_by: null,
      fellowship_id: null,
    });
    expect(row.occurred_at).toBeInstanceOf(Date);
  });
});

describe('MembersService.changeStatus history recording', () => {
  function build(oldStatus: string) {
    const prisma: any = {
      member: {
        findUnique: jest.fn().mockResolvedValue({ id: 'm1', fellowship_id: 'f1', membership_status: oldStatus }),
        update: jest.fn().mockReturnValue('UPDATE_OP'),
      },
      membershipHistory: { create: jest.fn().mockReturnValue('HISTORY_OP') },
      $transaction: jest.fn().mockResolvedValue([{ id: 'm1', user_id: null }]),
    };
    const audit = { log: jest.fn() };
    const notify = { create: jest.fn() };
    const service = new MembersService(prisma, audit as any, notify as any, {} as any, new TenantScopeService());
    return { prisma, service };
  }

  it('writes the member update and the history event in ONE transaction for a real transition', async () => {
    const { prisma, service } = build('active');
    await service.changeStatus('m1', 'inactive', user([]), 'Moved');
    expect(prisma.$transaction).toHaveBeenCalledWith(['UPDATE_OP', 'HISTORY_OP']);
    expect(prisma.membershipHistory.create.mock.calls[0][0].data).toMatchObject({
      member_id: 'm1',
      event_type: 'status_changed',
      from_status: 'active',
      to_status: 'inactive',
      reason: 'Moved',
      recorded_by: 'u1',
    });
  });

  it('records nothing for a no-op status change', async () => {
    const { prisma, service } = build('active');
    prisma.member.update.mockResolvedValue({ id: 'm1', user_id: null });
    await service.changeStatus('m1', 'active', user([]));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.membershipHistory.create).not.toHaveBeenCalled();
  });

  it('rejects invalid statuses before touching the database', async () => {
    const { prisma, service } = build('active');
    await expect(service.changeStatus('m1', 'archived', user([]))).rejects.toThrow(BadRequestException);
    expect(prisma.member.findUnique).not.toHaveBeenCalled();
  });

  it('only the Secretary may change status', async () => {
    const { service } = build('active');
    await expect(service.changeStatus('m1', 'inactive', user([], ['assistant_secretary']))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
