import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { isUuid } from '../shared/utils/uuid.util';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { EntitlementsService } from '../shared/billing/entitlements.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { randomUUID } from 'crypto';
import { buildHistoryData } from './membership-history.util';
import { buildAdvancedMemberFilters, AdvancedMemberFilters } from './member-search';

const MEMBERSHIP_STATUSES = ['active', 'inactive', 'graduated'];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c === '\r') {
      // ignore carriage returns
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// The frontend expects a `departments` array on the member (the shape the old
// embedded Mongoose subdocument had). Map the normalized `departmentMemberships`
// relation back onto that field so the API contract stays unchanged.
function serializeMember(member: any) {
  if (!member) return member;
  const { departmentMemberships, ...rest } = member;
  return departmentMemberships !== undefined
    ? { ...rest, departments: departmentMemberships }
    : rest;
}

// A UUID that matches no row: used to make a scoped query return nothing.
const NO_MATCH = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private approvalEngine: ApprovalEngineService,
    private tenantScope: TenantScopeService,
    @Optional() private entitlements?: EntitlementsService,
  ) {}

  // Generate a unique member code
  // Random suffix (50 bits) instead of count()+1: the old code raced under concurrent registrations (duplicate
  // codes -> unique violation), scanned the whole table on every call and revealed the platform-wide member count.
  private async generateMemberCode(): Promise<string> {
    const year = new Date().getFullYear().toString().slice(-2);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = require('crypto').randomBytes(10) as Buffer;
    let suffix = '';
    for (let i = 0; i < 10; i++) suffix += alphabet[bytes[i] % alphabet.length];
    return `MEM${year}-${suffix}`;
  }

  private toMemberFields(data: any): Record<string, any> {
    const out: Record<string, any> = {};
    if (data.fullName !== undefined) out.full_name = data.fullName;
    if (data.phone !== undefined) out.phone = data.phone;
    if (data.email !== undefined) out.email = data.email;
    if (data.gender !== undefined) out.gender = data.gender;
    if (data.programme !== undefined) out.programme = data.programme;
    if (data.yearOfStudy !== undefined) out.year_of_study = data.yearOfStudy;
    if (data.university !== undefined) out.university = data.university;
    if (data.expectedGraduationYear !== undefined) out.expected_graduation_year = data.expectedGraduationYear;
    if (data.expectedGraduationMonth !== undefined) out.expected_graduation_month = data.expectedGraduationMonth;
    return out;
  }

  async findAll(filters: {
    departmentId?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  } & AdvancedMemberFilters, currentUser: any): Promise<{ data: any[]; total: number }> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 50));
    const skip = (page - 1) * limit;

    const where: Prisma.MemberWhereInput = {};

    // Phase 14 filters (skills / interests / membership period / group / attendance). Built first so a
    // caller using a filter they aren't permitted to use is rejected before any query runs.
    const { and, includeProfile } = buildAdvancedMemberFilters(filters, currentUser);
    if (and.length > 0) {
      where.AND = and;
    }

    // Department leaders only see their own department
    const roles: string[] = currentUser.roles || [];
    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      // A leader with no department sees NOTHING (this used to fall through to the whole fellowship), and members
      // who were removed from the department are no longer visible.
      where.departmentMemberships = { some: { department_id: currentUser.departmentId ?? NO_MATCH, removed: false } };
    }

    if (filters.departmentId) {
      if (!roles.includes('secretary') && !roles.includes('admin') &&
          !roles.includes('assistant_secretary') && !roles.includes('chairperson') &&
          !roles.includes('assistant_chairperson')) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
      where.departmentMemberships = { some: { department_id: filters.departmentId } };
    }

    if (filters.status) {
      where.membership_status = filters.status as any;
    }

    if (filters.search) {
      where.OR = [
        { full_name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { member_code: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Gender leaders only see their gender members
    if (roles.includes('gender_leader')) {
      // Fail closed: without a known gender a gender leader sees nobody (the value was never on the request user,
      // so this filter used to be 'undefined' and gender leaders saw every member of the fellowship).
      if (currentUser.gender) where.gender = currentUser.gender;
      else where.id = NO_MATCH;
    }

    const [data, total] = await Promise.all([
      this.prisma.member.findMany({
        where: this.tenantScope.scopeWhere(currentUser, where),
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          departmentMemberships: true,
          // Tags only - occupation and emergency contact are never part of list responses.
          ...(includeProfile
            ? { profile: { select: { skills: true, interests: true, service_interests: true, membership_date: true } } }
            : {}),
        },
      }),
      this.prisma.member.count({ where: this.tenantScope.scopeWhere(currentUser, where) }),
    ]);

    return { data: data.map(serializeMember), total };
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    const member = await this.prisma.member.findUnique({
      where: { id },
      include: { departmentMemberships: true },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Department leaders can only see their own department members
    const roles: string[] = currentUser.roles || [];
    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      const deptId = currentUser.departmentId;
      if (!deptId || !member.departmentMemberships?.some((d) => d.department_id === deptId && !d.removed)) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }
    // Gender leaders may only open members of their own gender (this check did not exist for a single member).
    if (roles.includes('gender_leader') && !roles.some((r) => ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'].includes(r))) {
      if (!currentUser.gender || member.gender !== currentUser.gender) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    this.tenantScope.assertInScope(currentUser, member);

    return serializeMember(member);
  }

  async bulkCreate(file: Express.Multer.File, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary');
    const isAdmin = roles.includes('admin');
    if (!isSecretary && !isAdmin) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('CSV file is required');
    }

    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      throw new BadRequestException('CSV must contain a header row and at least one data row');
    }
    // Plan quota: refuse the whole import up front if the data rows alone would exceed it.
    await this.entitlements?.assertWithinLimit(currentUser.fellowshipId, 'max_members', parsed.length - 1);

    const header = parsed[0].map((h) => normalizeHeader(h));
    const expectedHeaders = [
      'full_name', 'gender', 'phone', 'email', 'programme',
      'year_of_study', 'expected_graduation_year', 'expected_graduation_month',
    ];

    const failures: { row: number; reason: string }[] = [];
    const createdCodes: string[] = [];
    const batchEmails = new Set<string>();
    const currentYear = new Date().getFullYear();

    for (let i = 1; i < parsed.length; i++) {
      const values = parsed[i];
      const record: Record<string, string> = {};
      header.forEach((h, idx) => { record[h] = (values[idx] || '').trim(); });

      const rowNumber = i + 1;
      const fullName = record['full_name'];
      if (!fullName) {
        failures.push({ row: rowNumber, reason: 'full_name is required' });
        continue;
      }

      const gender = record['gender'] || 'other';
      if (!['male', 'female', 'other'].includes(gender)) {
        failures.push({ row: rowNumber, reason: `gender must be male, female or other (got "${gender}")` });
        continue;
      }

      const email = record['email'] ? record['email'].toLowerCase() : undefined;
      if (email) {
        const existing = await this.prisma.member.findFirst({ where: { email } });
        if (existing || batchEmails.has(email)) {
          failures.push({ row: rowNumber, reason: `email ${email} already exists` });
          continue;
        }
        batchEmails.add(email);
      }

      const expectedGraduationYear = record['expected_graduation_year']
        ? Number(record['expected_graduation_year'])
        : currentYear + 4;
      const expectedGraduationMonth = record['expected_graduation_month']
        ? Number(record['expected_graduation_month'])
        : 6;

      if (!Number.isInteger(expectedGraduationYear) || expectedGraduationYear < currentYear) {
        failures.push({ row: rowNumber, reason: 'expected_graduation_year must be a valid year' });
        continue;
      }
      if (!Number.isInteger(expectedGraduationMonth) || expectedGraduationMonth < 1 || expectedGraduationMonth > 12) {
        failures.push({ row: rowNumber, reason: 'expected_graduation_month must be between 1 and 12' });
        continue;
      }

      const memberCode = await this.generateMemberCode();

      try {
        const newMemberId = randomUUID();
        const rowFellowshipId = this.tenantScope.resolveFellowshipId(currentUser);
        await this.prisma.$transaction([
          this.prisma.member.create({
            data: {
              id: newMemberId,
              full_name: fullName,
              gender,
              phone: record['phone'] || undefined,
              email,
              programme: record['programme'] || undefined,
              year_of_study: record['year_of_study'] || undefined,
              university: record['university'] || undefined,
              expected_graduation_year: expectedGraduationYear,
              expected_graduation_month: expectedGraduationMonth,
              membership_status: 'active',
              member_code: memberCode,
              created_by: currentUser.userId,
              fellowship_id: rowFellowshipId,
            },
          }),
          this.prisma.membershipHistory.create({
            data: buildHistoryData({
              memberId: newMemberId,
              fellowshipId: rowFellowshipId,
              eventType: 'registered',
              toStatus: 'active',
              recordedBy: currentUser.userId,
              reason: 'Bulk import',
            }),
          }),
        ]);
        createdCodes.push(memberCode);
      } catch {
        failures.push({ row: rowNumber, reason: 'Failed to save member' });
      }
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.bulk_import',
      entityType: 'member',
      newValue: {
        totalRows: parsed.length - 1,
        created: createdCodes.length,
        failed: failures.length,
        headers: expectedHeaders,
      },
      comment: `Bulk import: ${createdCodes.length} created, ${failures.length} failed`,
    });

    if (createdCodes.length > 0) {
      await this.notificationEngine.create({
        recipientUserId: currentUser.userId,
        eventType: 'member_bulk_import',
        title: 'Bulk Import Complete',
        message: `${createdCodes.length} members were imported from CSV.`,
      });
    }

    return {
      total: parsed.length - 1,
      created: createdCodes.length,
      failed: failures.length,
      failures,
      headers: expectedHeaders,
    };
  }

  async create(data: CreateMemberDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary');
    const isGenderLeader = roles.includes('gender_leader');
    const isAdmin = roles.includes('admin');

    if (!isSecretary && !isGenderLeader && !isAdmin) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    // Gender leaders can only register members of their gender
    if (isGenderLeader && !isSecretary && !isAdmin && data.gender !== currentUser.gender) {
      throw new ForbiddenException('You can only register members of your gender.');
    }

    await this.entitlements?.assertWithinLimit(currentUser.fellowshipId, 'max_members', 1);
    const memberCode = await this.generateMemberCode();

    // The id is generated up front so the member row and its 'registered' history event are written
    // together in one transaction.
    const memberId = randomUUID();
    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser, (data as any).fellowshipId);
    const [member] = await this.prisma.$transaction([
      this.prisma.member.create({
        data: {
          id: memberId,
          ...this.toMemberFields(data),
          member_code: memberCode,
          created_by: currentUser.userId,
          fellowship_id: fellowshipId,
        } as Prisma.MemberUncheckedCreateInput,
      }),
      this.prisma.membershipHistory.create({
        data: buildHistoryData({
          memberId,
          fellowshipId,
          eventType: 'registered',
          toStatus: 'active',
          recordedBy: currentUser.userId,
        }),
      }),
    ]);

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.register',
      entityType: 'member',
      entityId: member.id,
      newValue: { fullName: data.fullName, ...data },
      comment: 'Member registered',
    });

    // Notify relevant users
    if (isSecretary) {
      await this.notificationEngine.create({
        recipientUserId: currentUser.userId,
        eventType: 'member_change',
        title: 'New Member Registered',
        message: `${data.fullName} has been registered as a member.`,
      });
    }

    return member;
  }

  async update(id: string, data: UpdateMemberDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isMainSecretary = roles.includes('secretary');

    // Only Main Secretary can edit official member records
    if (!isMainSecretary) {
      throw new ForbiddenException('Only the Main Secretary can edit member records.');
    }

    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    this.tenantScope.assertInScope(currentUser, member);

    const changes = this.toMemberFields(data);
    const updated = await this.prisma.member.update({ where: { id }, data: changes });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.edit',
      entityType: 'member',
      entityId: id,
      oldValue: member,
      newValue: updated,
    });

    return updated;
  }

  async changeStatus(id: string, status: string, currentUser: any, reason?: string): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isMainSecretary = roles.includes('secretary');

    if (!isMainSecretary) {
      throw new ForbiddenException('Only the Main Secretary can change member status.');
    }

    // Validated here because the value is also written to the membership history timeline.
    if (!MEMBERSHIP_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of: ${MEMBERSHIP_STATUSES.join(', ')}`);
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) {
      throw new BadRequestException('reason must be a string of at most 500 characters');
    }

    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    this.tenantScope.assertInScope(currentUser, member);

    const oldStatus = member.membership_status;
    if (oldStatus === 'graduated') {
      throw new ForbiddenException('Cannot change status of graduated member.');
    }

    const statusChange = this.prisma.member.update({
      where: { id },
      data: {
        membership_status: status as any,
        status_changed_by: currentUser.userId,
        status_changed_at: new Date(),
      },
    });
    // A history event is recorded (atomically) only for a real transition.
    const [updated] =
      oldStatus === status
        ? [await statusChange]
        : await this.prisma.$transaction([
            statusChange,
            this.prisma.membershipHistory.create({
              data: buildHistoryData({
                memberId: id,
                fellowshipId: member.fellowship_id,
                eventType: 'status_changed',
                fromStatus: oldStatus,
                toStatus: status as any,
                reason: reason?.trim() || null,
                recordedBy: currentUser.userId,
              }),
            }),
          ]);

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.status_change',
      entityType: 'member',
      entityId: id,
      oldValue: { membership_status: oldStatus },
      newValue: { membership_status: status },
    });

    await this.notificationEngine.create({
      recipientUserId: updated.user_id || '',
      eventType: 'member_change',
      title: 'Membership Status Changed',
      message: `Your membership status has been changed from ${oldStatus} to ${status}.`,
    });

    return updated;
  }

  async updateGraduation(id: string, year: number, month: number, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary')) {
      throw new ForbiddenException('Only the Secretary can edit graduation dates.');
    }

    if (!isUuid(id)) throw new NotFoundException('Member not found');
    if (!Number.isInteger(year) || year < 1990 || year > 2100) throw new BadRequestException('year must be a whole year between 1990 and 2100.');
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('month must be a whole number from 1 to 12.');

    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    this.tenantScope.assertInScope(currentUser, member);

    const updated = await this.prisma.member.update({
      where: { id },
      data: { expected_graduation_year: year, expected_graduation_month: month },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.graduation_edit',
      entityType: 'member',
      entityId: id,
      oldValue: { year: member.expected_graduation_year, month: member.expected_graduation_month },
      newValue: { year, month },
    });

    return updated;
  }

  async checkGraduation(): Promise<void> {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    const graduatedMembers = await this.prisma.member.findMany({
      where: {
        membership_status: 'active',
        OR: [
          { expected_graduation_year: { lt: currentYear } },
          {
            expected_graduation_year: currentYear,
            expected_graduation_month: { lt: currentMonth },
          },
        ],
      },
    });

    for (const member of graduatedMembers) {
      const [updated] = await this.prisma.$transaction([
        this.prisma.member.update({
          where: { id: member.id },
          data: { membership_status: 'graduated' },
        }),
        this.prisma.membershipHistory.create({
          data: buildHistoryData({
            memberId: member.id,
            fellowshipId: member.fellowship_id,
            eventType: 'status_changed',
            fromStatus: 'active',
            toStatus: 'graduated',
            reason: 'Automatically set to graduated based on graduation date',
            recordedBy: null,
          }),
        }),
      ]);

      await this.auditService.log({
        action: 'member.status_change',
        entityType: 'member',
        entityId: member.id,
        oldValue: { membership_status: 'active' },
        newValue: { membership_status: 'graduated' },
        comment: 'Auto-set to graduated based on graduation date',
      });

      await this.notificationEngine.create({
        recipientUserId: updated.user_id || '',
        eventType: 'member_change',
        title: 'Membership Status Changed',
        message: 'Your membership status has been automatically changed to Graduated.',
      });
    }
  }

  async addToDepartment(memberId: string, departmentId: string, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('assistant_secretary');

    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    if (!isUuid(memberId) || !isUuid(departmentId)) throw new NotFoundException('Member or department not found');

    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { departmentMemberships: true },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    this.tenantScope.assertInScope(currentUser, member);

    const deptExists = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true, name: true, fellowship_id: true },
    });
    if (!deptExists || deptExists.fellowship_id !== member.fellowship_id) {
      throw new NotFoundException('Department not found');
    }

    const alreadyMember = member.departmentMemberships?.some(
      (d) => d.department_id === departmentId
    );
    if (alreadyMember) {
      throw new BadRequestException('Member is already in this department');
    }

    await this.prisma.$transaction([
      this.prisma.departmentMember.create({
        data: {
          member_id: memberId,
          department_id: departmentId,
          joined_at: new Date(),
          removed: false,
        },
      }),
      this.prisma.membershipHistory.create({
        data: buildHistoryData({
          memberId,
          fellowshipId: member.fellowship_id,
          eventType: 'department_joined',
          departmentId,
          recordedBy: currentUser.userId,
        }),
      }),
    ]);

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.member_add',
      entityType: 'member',
      entityId: memberId,
      newValue: { departmentId, addedTo: 'department_members' },
    });

    await this.notificationEngine.create({
      recipientUserId: member.user_id,
      eventType: 'department_change',
      title: 'Added to Department',
      message: `You have been added to the ${deptExists.name} department.`,
    });

    return this.findOne(memberId, currentUser);
  }
}

export interface CreateMemberDto {
  fullName: string;
  phone?: string;
  email?: string;
  gender: string;
  programme?: string;
  yearOfStudy?: string;
  university?: string;
  expectedGraduationYear: number;
  expectedGraduationMonth: number;
  departmentId?: string;
  departmentCustomFields?: Record<string, unknown>;
  fellowshipId?: string;
}

export interface UpdateMemberDto {
  fullName?: string;
  phone?: string;
  email?: string;
  gender?: string;
  programme?: string;
  yearOfWork?: string;
  year_of_study?: string;
  university?: string;
  expectedGraduationYear?: number;
  expectedGraduationMonth?: number;
}
