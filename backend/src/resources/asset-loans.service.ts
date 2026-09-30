import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { validateDate, validateRequiredUuid, validateText } from '../shared/utils/validation.util';
import { ResourcesAccessService } from './resources-access.service';
import { CONDITIONS } from './assets.service';

@Injectable()
export class AssetLoansService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private access: ResourcesAccessService,
  ) {}

  // Fellowship-wide holders of resources.checkout, or a department leader for assets OWNED BY their department.
  private assertCanLoan(user: any, asset: any): void {
    if (this.access.hasPermission(user, PERMISSIONS.RESOURCES_CHECKOUT)) return;
    if (
      this.access.hasPermission(user, PERMISSIONS.RESOURCES_DEPARTMENT_VIEW) &&
      this.access.isDepartmentLeader(user) &&
      user.departmentId &&
      asset.owning_department_id === user.departmentId
    ) return;
    throw new ForbiddenException('You do not have permission to perform this action.');
  }

  async checkOut(id: string, dto: any, user: any): Promise<any> {
    const asset = await this.access.loadAsset(id, user);
    this.assertCanLoan(user, asset);
    if (asset.is_consumable) throw new BadRequestException('Consumable stock is counted, not checked out.');

    const memberId = validateRequiredUuid('memberId', dto?.memberId);
    const member = await this.access.assertMember(memberId, asset.fellowship_id);
    if (!this.access.hasPermission(user, PERMISSIONS.RESOURCES_CHECKOUT)) {
      // Department leaders may only lend to members actively in their own department.
      const inDept = await this.prisma.departmentMember.findFirst({ where: { member_id: memberId, department_id: user.departmentId, removed: false }, select: { id: true } });
      if (!inDept) throw new ForbiddenException('You can only lend to members of your own department.');
    }
    const due = validateDate('dueDate', dto?.dueDate, { required: false, maxFutureDays: 730 }) ?? null;
    if (due && due.getTime() < Date.now() - 24 * 60 * 60 * 1000) throw new BadRequestException('dueDate cannot be in the past');
    const notes = validateText('notes', dto?.notes, 500);
    const conditionOut = dto?.conditionOut === undefined ? asset.condition : dto.conditionOut;
    if (!CONDITIONS.includes(conditionOut)) throw new BadRequestException(`conditionOut must be one of: ${CONDITIONS.join(', ')}`);

    const loan = await this.prisma.$transaction(async (tx) => {
      // The status flip available -> checked_out IS the lock: only one concurrent caller can win it.
      const flip = await tx.asset.updateMany({ where: { id, status: 'available', is_consumable: false }, data: { status: 'checked_out' } });
      if (flip.count !== 1) {
        const now = await tx.asset.findUnique({ where: { id }, select: { status: true } });
        throw new ConflictException(`This asset is not available (${(now?.status ?? 'unknown').replace(/_/g, ' ')}).`);
      }
      const created = await tx.assetLoan.create({
        data: { fellowship_id: asset.fellowship_id, asset_id: id, member_id: memberId, due_date: due, condition_out: conditionOut, checked_out_by: user.userId, notes },
      });
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'checked_out', actorId: user.userId, memberId, fromValue: 'available', toValue: 'checked_out', note: notes }) });
      return created;
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.asset_check_out', entityType: 'asset', entityId: id, newValue: { loanId: loan.id } });
    await this.access.notifyMember(member, 'Item checked out', 'An item has been checked out to you.', id, asset.fellowship_id);
    return loan;
  }

  async checkIn(id: string, dto: any, user: any): Promise<any> {
    const asset = await this.access.loadAsset(id, user);
    this.assertCanLoan(user, asset);
    const notes = validateText('notes', dto?.notes, 500);
    const conditionIn = dto?.condition === undefined ? null : dto.condition;
    if (conditionIn !== null && !CONDITIONS.includes(conditionIn)) throw new BadRequestException(`condition must be one of: ${CONDITIONS.join(', ')}`);

    const result = await this.prisma.$transaction(async (tx) => {
      const open = await tx.assetLoan.findFirst({ where: { asset_id: id, checked_in_at: null }, select: { id: true, member_id: true } });
      if (!open) throw new ConflictException('This asset is not currently checked out.');
      const closed = await tx.assetLoan.updateMany({
        where: { id: open.id, checked_in_at: null },
        data: { checked_in_at: new Date(), condition_in: conditionIn ?? asset.condition, checked_in_by: user.userId },
      });
      if (closed.count !== 1) throw new ConflictException('This asset was already checked in.');
      const back = await tx.asset.updateMany({
        where: { id, status: 'checked_out' },
        data: { status: 'available', ...(conditionIn ? { condition: conditionIn } : {}) },
      });
      if (back.count !== 1) throw new ConflictException('The asset is not in a checked-out state.');
      await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'checked_in', actorId: user.userId, memberId: open.member_id, fromValue: 'checked_out', toValue: 'available', note: notes }) });
      if (conditionIn && conditionIn !== asset.condition) {
        await tx.assetHistory.create({ data: this.access.historyData({ fellowshipId: asset.fellowship_id, assetId: id, eventType: 'condition_changed', actorId: user.userId, fromValue: asset.condition, toValue: conditionIn }) });
      }
      return tx.assetLoan.findUniqueOrThrow({ where: { id: open.id } });
    });
    await this.auditService.log({ userId: user.userId, action: 'resources.asset_check_in', entityType: 'asset', entityId: id, newValue: { loanId: result.id } });
    return result;
  }

  async listForAsset(id: string, user: any) {
    await this.access.loadAsset(id, user);
    return this.prisma.assetLoan.findMany({
      where: { asset_id: id },
      orderBy: { checked_out_at: 'desc' },
      take: 200,
      include: { member: { select: { id: true, full_name: true } } },
    });
  }

  // Self-service: only the member record linked to the signed-in account, and only its own loans.
  async myLoans(user: any) {
    const member = await this.prisma.member.findFirst({ where: { user_id: user.userId }, select: { id: true } });
    if (!member) throw new NotFoundException('No member profile is linked to your account.');
    const loans = await this.prisma.assetLoan.findMany({
      where: { member_id: member.id },
      orderBy: { checked_out_at: 'desc' },
      take: 100,
      select: { id: true, checked_out_at: true, due_date: true, checked_in_at: true, asset: { select: { id: true, asset_tag: true, name: true } } },
    });
    return loans.map((l) => ({ ...l, overdue: !l.checked_in_at && !!l.due_date && l.due_date < new Date() }));
  }
}
