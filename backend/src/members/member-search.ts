import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid, parseDateBoundary, parseIntParam, parseTagList } from './member.util';

export interface AdvancedMemberFilters {
  skills?: string;
  interests?: string;
  serviceInterests?: string;
  joinedFrom?: string;
  joinedTo?: string;
  groupId?: string;
  attendedWithinDays?: string | number;
  notAttendedWithinDays?: string | number;
}

const DEPARTMENT_LEADER_ROLES = ['department_secretary', 'department_chairperson'];

// Builds the extra (AND-composed) clauses for GET /members. Design rules:
//  - every restricted filter needs its own permission, and using one WITHOUT it is a 403 - it is
//    never silently ignored, otherwise a caller could probe hidden data through the result set;
//  - clauses are returned for `where.AND` so they can't clobber the existing `where.OR` text search
//    or the department / gender scoping applied by the caller;
//  - the free-text `search` is deliberately NOT extended to profile fields.
export function buildAdvancedMemberFilters(
  filters: AdvancedMemberFilters,
  currentUser: any,
): { and: Prisma.MemberWhereInput[]; includeProfile: boolean } {
  const permissions: string[] = currentUser?.permissions || [];
  const roles: string[] = currentUser?.roles || [];
  const can = (p: string) => permissions.includes(p);
  const scoped = DEPARTMENT_LEADER_ROLES.some((r) => roles.includes(r));

  const skills = parseTagList('skills', filters.skills);
  const interests = parseTagList('interests', filters.interests);
  const serviceInterests = parseTagList('serviceInterests', filters.serviceInterests);
  const joinedFrom = parseDateBoundary('joinedFrom', filters.joinedFrom, 'start');
  const joinedTo = parseDateBoundary('joinedTo', filters.joinedTo, 'end');
  const attendedDays = parseIntParam('attendedWithinDays', filters.attendedWithinDays, { min: 1, max: 730 });
  const notAttendedDays = parseIntParam('notAttendedWithinDays', filters.notAttendedWithinDays, { min: 1, max: 730 });

  const usesProfile =
    skills.length > 0 || interests.length > 0 || serviceInterests.length > 0 || !!joinedFrom || !!joinedTo;
  const usesGroup = filters.groupId !== undefined && filters.groupId !== '';
  const usesEngagement = attendedDays !== undefined || notAttendedDays !== undefined;

  if (usesProfile && !can(PERMISSIONS.MEMBER_PROFILE_VIEW)) {
    throw new ForbiddenException('You do not have permission to filter by profile fields.');
  }
  if (usesGroup && !can(PERMISSIONS.MEMBER_GROUPS_VIEW)) {
    throw new ForbiddenException('You do not have permission to filter by group.');
  }
  if (usesEngagement && !can(PERMISSIONS.MEMBER_ENGAGEMENT_VIEW)) {
    throw new ForbiddenException('You do not have permission to filter by engagement.');
  }

  const and: Prisma.MemberWhereInput[] = [];

  if (skills.length) and.push({ profile: { is: { skills: { hasSome: skills } } } });
  if (interests.length) and.push({ profile: { is: { interests: { hasSome: interests } } } });
  if (serviceInterests.length) and.push({ profile: { is: { service_interests: { hasSome: serviceInterests } } } });

  if (joinedFrom || joinedTo) {
    // "Membership start" = profile.membership_date when recorded, otherwise the registration date.
    const range: Prisma.DateTimeFilter = {};
    if (joinedFrom) range.gte = joinedFrom;
    if (joinedTo) range.lte = joinedTo;
    and.push({
      OR: [
        { profile: { is: { membership_date: range } } },
        {
          AND: [
            { OR: [{ profile: { is: null } }, { profile: { is: { membership_date: null } } }] },
            { created_at: range },
          ],
        },
      ],
    });
  }

  if (usesGroup) {
    if (!isUuid(filters.groupId)) {
      throw new BadRequestException('groupId must be a valid id');
    }
    and.push({ groupMemberships: { some: { group_id: filters.groupId } } });
  }

  // Department leaders only ever filter on attendance at their own department's activities, the
  // same restriction that applies to the per-member engagement view.
  const activityScope = scoped ? { activity: { department_id: currentUser.departmentId } } : {};
  if (attendedDays !== undefined) {
    const since = new Date(Date.now() - attendedDays * 24 * 60 * 60 * 1000);
    and.push({ attendances: { some: { recorded_at: { gte: since }, ...activityScope } } });
  }
  if (notAttendedDays !== undefined) {
    const since = new Date(Date.now() - notAttendedDays * 24 * 60 * 60 * 1000);
    and.push({ attendances: { none: { recorded_at: { gte: since }, ...activityScope } } });
  }

  return { and, includeProfile: can(PERMISSIONS.MEMBER_PROFILE_VIEW) };
}
