import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { validateText, validateOptionalUuid } from '../shared/utils/validation.util';

export interface CreateProgrammeDto {
  name: string;
  description?: string;
  fellowshipId?: string;
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
export class ProgrammesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
  ) {}

  async findAll(currentUser: any, queryFellowshipId?: string): Promise<any[]> {
    const where = this.tenantScope.scopeWhere(currentUser, {}, queryFellowshipId);
    return this.prisma.programme.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(dto: CreateProgrammeDto, currentUser: any): Promise<any> {
    const requesterUserId = currentUser.userId;
    const name = validateText('Programme name', dto.name, 200, true)!;
    const description = validateText('description', dto.description, 2000);
    const bodyFellowshipId = validateOptionalUuid('fellowshipId', dto.fellowshipId) ?? undefined;

    // Per fellowship, not global: another congregation's "Worship" programme is not a conflict.
    const existing = await this.prisma.programme.findFirst({ where: { fellowship_id: bodyFellowshipId ?? null, name } });
    if (existing) {
      throw new BadRequestException('This fellowship already has a programme with that name');
    }

    const programme = await this.prisma.programme.create({
      data: {
        name,
        description: description || undefined,
        created_by: requesterUserId,
        fellowship_id: this.tenantScope.resolveFellowshipId(currentUser, bodyFellowshipId),
      },
    });

    await this.auditService.log({
      userId: requesterUserId,
      action: 'programme.create',
      entityType: 'programme',
      entityId: programme.id,
      newValue: { name },
      comment: `Created programme: ${name}`,
    });

    return programme;
  }

  async bulkCreate(file: Express.Multer.File, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const requesterUserId = currentUser.userId;
    // Resolved once for the whole file: the CSV carries no fellowship column, so every row lands in the
    // Secretary's own fellowship and the name check is scoped to it.
    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser);

    if (!file || !file.buffer) {
      throw new BadRequestException('CSV file is required');
    }

    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      throw new BadRequestException('CSV must contain a header row and at least one data row');
    }

    const header = parsed[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const failures: { row: number; reason: string }[] = [];
    let created = 0;
    const batchNames = new Set<string>();

    for (let i = 1; i < parsed.length; i++) {
      const values = parsed[i];
      if (values.every((v) => !v.trim())) continue; // skip blank rows
      const record: Record<string, string> = {};
      header.forEach((h, idx) => { record[h] = (values[idx] || '').trim(); });

      const rowNumber = i + 1;
      const name = record['name'] || record['course'] || record['course_name'] || record['programme'];
      if (!name) {
        failures.push({ row: rowNumber, reason: 'name is required' });
        continue;
      }
      const trimmedName = name.trim();
      if (batchNames.has(trimmedName.toLowerCase())) {
        failures.push({ row: rowNumber, reason: `duplicate "${trimmedName}" in file` });
        continue;
      }

      const existing = await this.prisma.programme.findFirst({ where: { fellowship_id: fellowshipId ?? null, name: trimmedName } });
      if (existing) {
        failures.push({ row: rowNumber, reason: `this fellowship already has a programme "${trimmedName}"` });
        continue;
      }

      try {
        const programme = await this.prisma.programme.create({
          data: {
            name: trimmedName,
            description: record['description']?.trim() || undefined,
            created_by: requesterUserId,
            fellowship_id: this.tenantScope.resolveFellowshipId(currentUser),
          },
        });
        batchNames.add(trimmedName.toLowerCase());
        created++;
        await this.auditService.log({
          userId: requesterUserId,
          action: 'programme.bulk_import',
          entityType: 'programme',
          entityId: programme.id,
          newValue: { name: trimmedName },
          comment: `Bulk imported programme: ${trimmedName}`,
        });
      } catch {
        failures.push({ row: rowNumber, reason: 'Failed to create programme' });
      }
    }

    return { created, failed: failures.length, failures };
  }

  async update(id: string, dto: CreateProgrammeDto, currentUser: any): Promise<any> {
    const requesterUserId = currentUser.userId;
    const programme = await this.prisma.programme.findUnique({ where: { id } });
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }
    this.tenantScope.assertInScope(currentUser, programme);

    const name = dto.name?.trim();
    if (name && name !== programme.name) {
      const existing = await this.prisma.programme.findFirst({ where: { name, NOT: { id } } });
      if (existing) {
        throw new BadRequestException('A programme with this name already exists');
      }
    }

    const oldValue = { name: programme.name, description: programme.description };

    const changes: Record<string, any> = {};
    if (name) changes.name = name;
    if (dto.description !== undefined) changes.description = dto.description?.trim() || undefined;

    const updated = await this.prisma.programme.update({ where: { id }, data: changes });

    await this.auditService.log({
      userId: requesterUserId,
      action: 'programme.update',
      entityType: 'programme',
      entityId: id,
      oldValue,
      newValue: { name: updated.name, description: updated.description },
      comment: `Updated programme: ${updated.name}`,
    });

    return updated;
  }

  async remove(id: string, currentUser: any): Promise<void> {
    const requesterUserId = currentUser.userId;
    const programme = await this.prisma.programme.findUnique({ where: { id } });
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }
    this.tenantScope.assertInScope(currentUser, programme);

    await this.prisma.programme.delete({ where: { id } });

    await this.auditService.log({
      userId: requesterUserId,
      action: 'programme.delete',
      entityType: 'programme',
      entityId: id,
      oldValue: { name: programme.name },
      comment: `Deleted programme: ${programme.name}`,
    });
  }
}
