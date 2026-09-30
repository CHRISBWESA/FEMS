import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { MemberAccessService } from './member-access.service';
import { COMM_CHANNELS, normalizeTags } from './member.util';

export interface UpdateMemberProfileDto {
  occupation?: string | null;
  membershipDate?: string | null;
  skills?: string[];
  interests?: string[];
  serviceInterests?: string[];
  preferredChannels?: string[];
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
}

const EMERGENCY_KEYS: (keyof UpdateMemberProfileDto)[] = [
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelationship',
];

const PHONE_RE = /^[0-9+()\-\s]{5,25}$/;

function optionalText(field: string, value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  }
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class MemberProfilesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private access: MemberAccessService,
  ) {}

  private serialize(memberId: string, profile: any, includeEmergency: boolean): any {
    const result: any = {
      memberId,
      occupation: profile?.occupation ?? null,
      membershipDate: profile?.membership_date ?? null,
      skills: profile?.skills ?? [],
      interests: profile?.interests ?? [],
      serviceInterests: profile?.service_interests ?? [],
      preferredChannels: profile?.preferred_channels ?? [],
      updatedAt: profile?.updated_at ?? null,
    };
    if (includeEmergency) {
      result.emergencyContact = {
        name: profile?.emergency_contact_name ?? null,
        phone: profile?.emergency_contact_phone ?? null,
        relationship: profile?.emergency_contact_relationship ?? null,
      };
    }
    return result;
  }

  async get(memberId: string, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_PROFILE_VIEW);
    const member = await this.access.assertAccessible(memberId, currentUser);

    const profile = await this.prisma.memberProfile.findUnique({ where: { member_id: memberId } });
    const includeEmergency = this.access.hasPermission(currentUser, PERMISSIONS.MEMBER_EMERGENCY_VIEW);

    // Reading emergency contact details is an access to sensitive data, so it is audited (only when
    // there is actually something to read; the values themselves are never logged).
    if (
      includeEmergency &&
      (profile?.emergency_contact_name || profile?.emergency_contact_phone || profile?.emergency_contact_relationship)
    ) {
      await this.auditService.log({
        userId: currentUser.userId,
        action: 'member.emergency_view',
        entityType: 'member',
        entityId: member.id,
      });
    }

    return this.serialize(member.id, profile, includeEmergency);
  }

  async update(memberId: string, dto: UpdateMemberProfileDto, currentUser: any): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_PROFILE_EDIT);

    const touchesEmergency = EMERGENCY_KEYS.some((k) => dto[k] !== undefined);
    if (touchesEmergency && !this.access.hasPermission(currentUser, PERMISSIONS.MEMBER_EMERGENCY_EDIT)) {
      // Explicit refusal rather than silently dropping the fields.
      throw new ForbiddenException('You do not have permission to edit emergency contact details.');
    }

    const member = await this.access.assertAccessible(memberId, currentUser);
    const data = this.validate(dto);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No profile fields were provided');
    }

    const profile = await this.prisma.memberProfile.upsert({
      where: { member_id: memberId },
      create: { member_id: memberId, fellowship_id: member.fellowship_id, updated_by: currentUser.userId, ...data },
      update: { updated_by: currentUser.userId, ...data },
    });

    // Audit records *which* fields changed. Emergency-contact values are sensitive and never logged;
    // the remaining fields are low-sensitivity tags/labels and are logged for traceability.
    const changedFields = Object.keys(data);
    const loggedValues: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('emergency_contact_')) loggedValues[key] = value;
    }
    await this.auditService.log({
      userId: currentUser.userId,
      action: 'member.profile_edit',
      entityType: 'member',
      entityId: memberId,
      newValue: { ...loggedValues, emergencyContactChanged: touchesEmergency },
      comment: `Fields changed: ${changedFields.join(', ')}`,
    });

    const includeEmergency = this.access.hasPermission(currentUser, PERMISSIONS.MEMBER_EMERGENCY_VIEW);
    return this.serialize(memberId, profile, includeEmergency);
  }

  // Converts the (camelCase) request into validated column values. Only provided keys are returned,
  // so an omitted field is left unchanged; null / empty string clears an optional scalar.
  private validate(dto: UpdateMemberProfileDto): Record<string, any> {
    const out: Record<string, any> = {};

    if (dto.occupation !== undefined) out.occupation = optionalText('occupation', dto.occupation, 120);

    if (dto.membershipDate !== undefined) {
      if (dto.membershipDate === null || dto.membershipDate === '') {
        out.membership_date = null;
      } else {
        const d = new Date(dto.membershipDate);
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException('membershipDate must be a valid date');
        }
        if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
          throw new BadRequestException('membershipDate cannot be in the future');
        }
        if (d < new Date('1900-01-01')) {
          throw new BadRequestException('membershipDate is not plausible');
        }
        out.membership_date = d;
      }
    }

    if (dto.skills !== undefined) out.skills = normalizeTags('skills', dto.skills);
    if (dto.interests !== undefined) out.interests = normalizeTags('interests', dto.interests);
    if (dto.serviceInterests !== undefined) {
      out.service_interests = normalizeTags('serviceInterests', dto.serviceInterests);
    }

    if (dto.preferredChannels !== undefined) {
      const channels = normalizeTags('preferredChannels', dto.preferredChannels);
      const invalid = channels.filter((c) => !(COMM_CHANNELS as readonly string[]).includes(c));
      if (invalid.length > 0) {
        throw new BadRequestException(`preferredChannels must be one of: ${COMM_CHANNELS.join(', ')}`);
      }
      out.preferred_channels = channels;
    }

    if (dto.emergencyContactName !== undefined) {
      out.emergency_contact_name = optionalText('emergencyContactName', dto.emergencyContactName, 120);
    }
    if (dto.emergencyContactPhone !== undefined) {
      const phone = optionalText('emergencyContactPhone', dto.emergencyContactPhone, 25);
      if (phone !== null && !PHONE_RE.test(phone)) {
        throw new BadRequestException('emergencyContactPhone is not a valid phone number');
      }
      out.emergency_contact_phone = phone;
    }
    if (dto.emergencyContactRelationship !== undefined) {
      out.emergency_contact_relationship = optionalText(
        'emergencyContactRelationship',
        dto.emergencyContactRelationship,
        60,
      );
    }

    return out;
  }
}
