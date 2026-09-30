import { Injectable, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BackupsService {
  constructor(private prisma: PrismaService) {}

  async findAll(currentUser: any): Promise<any[]> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.prisma.backup.findMany({
      orderBy: { created_at: 'desc' },
      omit: { file_path: true },
    });
  }

  async createManual(currentUser: any): Promise<never> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    throw new ConflictException({
      code: 'OPERATION_UNAVAILABLE',
      message: 'FEMS does not create database backups. Use the documented pg_dump procedure or the hosting platform backup service.',
    });
  }

  async restore(backupId: string, currentUser: any, _options: { confirmSafetyBackup: boolean; reason?: string }): Promise<never> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    throw new ConflictException({
      code: 'OPERATION_UNAVAILABLE',
      message: 'FEMS does not restore databases. Restore a verified dump into a new database using BACKUP_RESTORE_GUIDE.md before switching traffic.',
    });
  }

  async getStats() {
    const [total, recent] = await Promise.all([
      this.prisma.backup.count(),
      this.prisma.backup.findMany({ orderBy: { created_at: 'desc' }, take: 5, omit: { file_path: true } }),
    ]);
    return {
      total,
      recent,
      applicationBackup: false,
      scheduledBackup: false,
      verifiedRestore: false,
      externalProcedure: 'BACKUP_RESTORE_GUIDE.md',
    };
  }
}
