import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Member } from '../shared/schemas/members-departments.schema';
import { Department } from '../shared/schemas/members-departments.schema';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { Permission } from '../shared/authorization/permissions';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';

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

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(Member.name) private memberModel: Model<Member>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private approvalEngine: ApprovalEngineService,
  ) {}

  // Generate a unique member code
  private async generateMemberCode(): Promise<string> {
    const year = new Date().getFullYear().toString().slice(-2);
    const count = await this.memberModel.countDocuments().exec();
    const code = `MEM${year}${String(count + 1).padStart(4, '0')}`;
    return code;
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
  }, currentUser: any): Promise<{ data: any[]; total: number }> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 50));
    const skip = (page - 1) * limit;

    const query: any = {};

    // Department leaders only see their own department
    const roles: string[] = currentUser.roles || [];
    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      if (currentUser.departmentId) {
        query['departments.department_id'] = new Types.ObjectId(currentUser.departmentId);
      }
    }

    if (filters.departmentId) {
      if (!roles.includes('secretary') && !roles.includes('admin') &&
          !roles.includes('assistant_secretary') && !roles.includes('chairperson') &&
          !roles.includes('assistant_chairperson')) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
      query['departments.department_id'] = new Types.ObjectId(filters.departmentId);
    }

    if (filters.status) {
      query.membership_status = filters.status;
    }

    if (filters.search) {
      query.$or = [
        { full_name: { $regex: filters.search, $options: 'i' } },
        { email: { $regex: filters.search, $options: 'i' } },
        { member_code: { $regex: filters.search, $options: 'i' } },
      ];
    }

    // Gender leaders only see their gender members
    if (roles.includes('gender_leader')) {
      query.gender = currentUser.gender;
    }

    const [data, total] = await Promise.all([
      this.memberModel.find(query).skip(skip).limit(limit).sort({ created_at: -1 }).exec(),
      this.memberModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async findOne(id: string, currentUser: any): Promise<Member> {
    const member = await this.memberModel.findById(id).exec();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    // Department leaders can only see their own department members
    const roles: string[] = currentUser.roles || [];
    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      const deptId = currentUser.departmentId;
      if (!member.departments?.some((d) => d.department_id.toString() === deptId)) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    return member;
  }

  async bulkCreate(file: Express.Multer.File, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary');
    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('CSV file is required');
    }

    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      throw new BadRequestException('CSV must contain a header row and at least one data row');
    }

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
        const existing = await this.memberModel.findOne({ email }).exec();
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
      const member = new this.memberModel({
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
        created_by: new Types.ObjectId(currentUser.userId),
      });

      try {
        await member.save();
        createdCodes.push(memberCode);
      } catch (err: any) {
        failures.push({ row: rowNumber, reason: err?.message || 'Failed to save member' });
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

  async create(data: CreateMemberDto, currentUser: any): Promise<Member> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary');
    const isGenderLeader = roles.includes('gender_leader');

    if (!isSecretary && !isGenderLeader) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    // Gender leaders can only register members of their gender
    if (isGenderLeader && !isSecretary && data.gender !== currentUser.gender) {
      throw new ForbiddenException('You can only register members of your gender.');
    }

    const memberCode = await this.generateMemberCode();
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    const member = new this.memberModel({
      ...this.toMemberFields(data),
      member_code: memberCode,
      created_by: new Types.ObjectId(currentUser.userId),
    });

    await member.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.register',
      entityType: 'member',
      entityId: member._id.toString(),
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

  async update(id: string, data: UpdateMemberDto, currentUser: any): Promise<Member> {
    const roles: string[] = currentUser.roles || [];
    const isMainSecretary = roles.includes('secretary');

    // Only Main Secretary can edit official member records
    if (!isMainSecretary) {
      throw new ForbiddenException('Only the Main Secretary can edit member records.');
    }

    const member = await this.memberModel.findById(id).exec();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const oldValues = (member as any).toObject();
    Object.assign(member, this.toMemberFields(data));
    await member.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.edit',
      entityType: 'member',
      entityId: id,
      oldValue: oldValues,
      newValue: (member as any).toObject(),
    });

    return member;
  }

  async changeStatus(id: string, status: string, currentUser: any): Promise<Member> {
    const roles: string[] = currentUser.roles || [];
    const isMainSecretary = roles.includes('secretary');

    if (!isMainSecretary) {
      throw new ForbiddenException('Only the Main Secretary can change member status.');
    }

    const member = await this.memberModel.findById(id).exec();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const oldStatus = member.membership_status;
    if (oldStatus === 'graduated') {
      throw new ForbiddenException('Cannot change status of graduated member.');
    }

    member.membership_status = status;
    member.status_changed_by = new Types.ObjectId(currentUser.userId);
    member.status_changed_at = new Date();
    await member.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.status_change',
      entityType: 'member',
      entityId: id,
      oldValue: { membership_status: oldStatus },
      newValue: { membership_status: status },
    });

    await this.notificationEngine.create({
      recipientUserId: member.user_id?.toString() || '',
      eventType: 'member_change',
      title: 'Membership Status Changed',
      message: `Your membership status has been changed from ${oldStatus} to ${status}.`,
    });

    return member;
  }

  async updateGraduation(id: string, year: number, month: number, currentUser: any): Promise<Member> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary')) {
      throw new ForbiddenException('Only the Secretary can edit graduation dates.');
    }

    const member = await this.memberModel.findById(id).exec();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    member.expected_graduation_year = year;
    member.expected_graduation_month = month;
    await member.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.graduation_edit',
      entityType: 'member',
      entityId: id,
      oldValue: { year: member.expected_graduation_year, month: member.expected_graduation_month },
      newValue: { year, month },
    });

    return member;
  }

  async checkGraduation(): Promise<void> {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    const graduatedMembers = await this.memberModel.find({
      membership_status: 'active',
      $or: [
        { expected_graduation_year: { $lt: currentYear } },
        {
          expected_graduation_year: currentYear,
          expected_graduation_month: { $lt: currentMonth },
        },
      ],
    }).exec();

    for (const member of graduatedMembers) {
      member.membership_status = 'graduated';
      await member.save();

      await this.auditService.log({
        action: 'member.status_change',
        entityType: 'member',
        entityId: member._id.toString(),
        oldValue: { membership_status: 'active' },
        newValue: { membership_status: 'graduated' },
        comment: 'Auto-set to graduated based on graduation date',
      });

      await this.notificationEngine.create({
        recipientUserId: member.user_id?.toString() || '',
        eventType: 'member_change',
        title: 'Membership Status Changed',
        message: 'Your membership status has been automatically changed to Graduated.',
      });
    }
  }

  async addToDepartment(memberId: string, departmentId: string, currentUser: any): Promise<Member> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('assistant_secretary');

    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const member = await this.memberModel.findById(memberId).exec();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const deptExists = await this.departmentModel.findById(departmentId).exec();
    if (!deptExists) {
      throw new NotFoundException('Department not found');
    }

    const alreadyMember = member.departments?.some(
      (d) => d.department_id.toString() === departmentId
    );
    if (alreadyMember) {
      throw new BadRequestException('Member is already in this department');
    }

    member.departments.push({
      department_id: new Types.ObjectId(departmentId),
      joined_at: new Date(),
      removed: false,
    });
    await member.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.member_add',
      entityType: 'member',
      entityId: memberId,
      newValue: { departmentId, addedTo: 'department_members' },
    });

    await this.notificationEngine.create({
      recipientUserId: member.user_id?.toString() || '',
      eventType: 'department_change',
      title: 'Added to Department',
      message: `You have been added to the ${deptExists.name} department.`,
    });

    return member;
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
