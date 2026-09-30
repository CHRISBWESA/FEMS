import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';

export interface CreateFellowshipDto {
  name: string;
  location?: string;
  description?: string;
}

export interface UpdateFellowshipDto {
  name?: string;
  location?: string;
  description?: string;
  is_active?: boolean;
}

@Injectable()
export class FellowshipService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async findAll(filters: { search?: string; isActive?: boolean; page?: number; limit?: number }, requesterUserId: string) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 50));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {};
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { location: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.isActive !== undefined) where.is_active = filters.isActive;

    const [data, total] = await Promise.all([
      this.prisma.fellowship.findMany({ where, orderBy: { created_at: 'desc' }, skip, take: limit }),
      this.prisma.fellowship.count({ where }),
    ]);
    return { data, total };
  }

  async findOne(id: string) {
    const fellowship = await this.prisma.fellowship.findUnique({ where: { id } });
    if (!fellowship) throw new NotFoundException('Fellowship not found');
    return fellowship;
  }

  async create(dto: CreateFellowshipDto, requesterUserId: string) {
    if (dto === null || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('A JSON object is required');
    const name = validateText('name', dto.name, 200, true)!;
    const location = validateText('location', dto.location, 300);
    const description = validateText('description', dto.description, 2000);

    const existing = await this.prisma.fellowship.findUnique({ where: { name } });
    if (existing) throw new BadRequestException('A fellowship with this name already exists');

    const fellowship = await this.prisma.fellowship.create({
      data: {
        name,
        location: location ?? undefined,
        description: description ?? undefined,
        is_active: true,
        created_by: requesterUserId,
      },
    });

    await this.auditService.log({
      userId: requesterUserId,
      action: 'fellowship.create',
      entityType: 'fellowship',
      entityId: fellowship.id,
      fellowshipId: fellowship.id,
      newValue: { name, location },
      comment: `Created fellowship ${name}`,
    });

    return fellowship;
  }

  async update(id: string, dto: UpdateFellowshipDto, requesterUserId: string) {
    if (!isUuid(id)) throw new NotFoundException('Fellowship not found');
    if (dto === null || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('A JSON object is required');
    const fellowship = await this.prisma.fellowship.findUnique({ where: { id } });
    if (!fellowship) throw new NotFoundException('Fellowship not found');

    const changes: Record<string, any> = {};
    const newName = dto.name === undefined ? null : validateText('name', dto.name, 200);
    if (newName && newName !== fellowship.name) {
      const name = newName;
      const existing = await this.prisma.fellowship.findUnique({ where: { name } });
      if (existing && existing.id !== id) throw new BadRequestException('A fellowship with this name already exists');
      changes.name = name;
    }
    if (dto.location !== undefined) changes.location = validateText('location', dto.location, 300);
    if (dto.description !== undefined) changes.description = validateText('description', dto.description, 2000);
    if (dto.is_active !== undefined && typeof dto.is_active !== 'boolean') throw new BadRequestException('is_active must be true or false');
    if (dto.is_active !== undefined && dto.is_active !== fellowship.is_active) {
      // Keep the lifecycle status in step, otherwise switching is_active would not lock the fellowship's users out.
      changes.is_active = dto.is_active;
      changes.status = dto.is_active ? 'active' : 'suspended';
      changes.suspended_at = dto.is_active ? null : new Date();
      changes.suspended_by = dto.is_active ? null : requesterUserId;
      changes.suspension_reason = dto.is_active ? null : 'Deactivated from the fellowships screen';
    }

    if (Object.keys(changes).length === 0) throw new BadRequestException('No fields to update');

    const oldValue: Record<string, any> = {};
    for (const key of Object.keys(changes)) oldValue[key] = (fellowship as any)[key];

    const updated = await this.prisma.fellowship.update({ where: { id }, data: changes });

    await this.auditService.log({
      userId: requesterUserId,
      action: 'fellowship.update',
      entityType: 'fellowship',
      entityId: id,
      fellowshipId: id,
      oldValue,
      newValue: changes,
      comment: 'Fellowship updated',
    });

    return updated;
  }

  async remove(id: string, requesterUserId: string) {
    const fellowship = await this.prisma.fellowship.findUnique({ where: { id } });
    if (!fellowship) throw new NotFoundException('Fellowship not found');

    const linkedUsers = await this.prisma.user.count({ where: { fellowship_id: id, deleted_at: null } });
    if (linkedUsers > 0) {
      throw new ForbiddenException(
        `Cannot delete a fellowship with ${linkedUsers} active user(s). Reassign or deactivate them first.`,
      );
    }

    await this.prisma.fellowship.update({ where: { id }, data: { is_active: false, status: 'suspended', suspended_at: new Date(), suspended_by: requesterUserId, suspension_reason: 'Deactivated from the fellowships screen' } });

    await this.auditService.log({
      userId: requesterUserId,
      action: 'fellowship.deactivate',
      entityType: 'fellowship',
      entityId: id,
      fellowshipId: id,
      comment: 'Fellowship deactivated',
    });

    return { message: 'Fellowship deactivated' };
  }
}
