import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Programme } from './programmes.schema';
import { AuditService } from '../shared/audit/audit.service';

export interface CreateProgrammeDto {
  name: string;
  description?: string;
}

@Injectable()
export class ProgrammesService {
  constructor(
    @InjectModel(Programme.name) private programmeModel: Model<Programme>,
    private auditService: AuditService,
  ) {}

  async findAll(): Promise<Programme[]> {
    return this.programmeModel.find().sort({ name: 1 }).exec();
  }

  async create(dto: CreateProgrammeDto, requesterUserId: string): Promise<Programme> {
    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException('Programme name is required');
    }

    const existing = await this.programmeModel.findOne({ name }).exec();
    if (existing) {
      throw new BadRequestException('A programme with this name already exists');
    }

    const programme = new this.programmeModel({
      name,
      description: dto.description?.trim() || undefined,
      created_by: new Types.ObjectId(requesterUserId),
    });
    await programme.save();

    await this.auditService.log({
      userId: requesterUserId,
      action: 'programme.create',
      entityType: 'programme',
      entityId: programme._id.toString(),
      newValue: { name },
      comment: `Created programme: ${name}`,
    });

    return programme;
  }

  async update(id: string, dto: CreateProgrammeDto, requesterUserId: string): Promise<Programme> {
    const programme = await this.programmeModel.findById(id).exec();
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }

    const name = dto.name?.trim();
    if (name && name !== programme.name) {
      const existing = await this.programmeModel.findOne({ name, _id: { $ne: id } }).exec();
      if (existing) {
        throw new BadRequestException('A programme with this name already exists');
      }
    }

    const oldValue = { name: programme.name, description: programme.description };

    if (name) programme.name = name;
    if (dto.description !== undefined) programme.description = dto.description?.trim() || undefined;
    await programme.save();

    await this.auditService.log({
      userId: requesterUserId,
      action: 'programme.update',
      entityType: 'programme',
      entityId: id,
      oldValue,
      newValue: { name: programme.name, description: programme.description },
      comment: `Updated programme: ${programme.name}`,
    });

    return programme;
  }

  async remove(id: string, requesterUserId: string): Promise<void> {
    const programme = await this.programmeModel.findById(id).exec();
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }

    await programme.deleteOne();

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
