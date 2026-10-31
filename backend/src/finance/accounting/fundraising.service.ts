import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS } from '../../shared/authorization/permissions';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateText } from '../finance.validation';
import { D, money, ZERO } from './ledger';
import { FinanceScopeService } from './finance-scope.service';
import { Prisma } from '@prisma/client';

/**
 * Public fundraising pages. Only an active campaign linked to an approved (or active) project can be published, at
 * an unguessable address. The public page shows the purpose, target, budget, amount raised and approved updates -
 * never a contributor's name, phone number or any individual payment.
 */
@Injectable()
export class FundraisingService {
  constructor(private prisma: PrismaService, private scope: FinanceScopeService) {}

  private async manage(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Campaign not found');
    const c = await this.prisma.contributionCampaign.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!c) throw new NotFoundException('Campaign not found');
    const central = ((user?.permissions as string[]) || []).includes(PERMISSIONS.FINANCE_CAMPAIGN_MANAGE);
    if (!central && !(c.department_id && (await this.scope.leaderRole(user, c.department_id)) === 'department_chairperson')) {
      throw new ForbiddenException('You do not have permission to manage this campaign.');
    }
    return c;
  }

  publicUrl(slug: string) {
    const origin = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return `${origin}/give/${slug}`;
  }

  async publish(user: any, id: string) {
    const c = await this.manage(user, id);
    if (c.status !== 'active') throw new ConflictException('Only an active campaign can be published.');
    if (!c.target_amount) throw new BadRequestException('Set a fundraising target before publishing.');
    const project = c.project_id ? await this.prisma.project.findUnique({ where: { id: c.project_id }, select: { status: true } }) : null;
    if (!project || !['APPROVED', 'ACTIVE'].includes(project.status)) {
      throw new ConflictException('Only a campaign for an approved project can be published.');
    }
    const slug = c.public_slug ?? randomBytes(16).toString('base64url');
    await this.prisma.contributionCampaign.update({ where: { id }, data: { public_slug: slug, is_public: true, published_at: new Date() } });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.campaign_publish', entity_type: 'campaign', entity_id: id, fellowship_id: c.fellowship_id } });
    return { id, isPublic: true, slug, url: this.publicUrl(slug) };
  }

  async unpublish(user: any, id: string) {
    const c = await this.manage(user, id);
    await this.prisma.contributionCampaign.update({ where: { id }, data: { is_public: false } });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.campaign_unpublish', entity_type: 'campaign', entity_id: id, fellowship_id: c.fellowship_id } });
    return { id, isPublic: false };
  }

  async qr(user: any, id: string): Promise<string> {
    const c = await this.manage(user, id);
    if (!c.public_slug || !c.is_public) throw new ConflictException('Publish the campaign first.');
    return QRCode.toString(this.publicUrl(c.public_slug), { type: 'svg', margin: 1, width: 320 });
  }

  async addUpdate(user: any, id: string, body: any) {
    const c = await this.manage(user, id);
    const title = validateText('title', body?.title, 150, true) as string;
    const text = validateText('body', body?.body, 3000, true) as string;
    const u = await this.prisma.campaignUpdate.create({ data: { campaign_id: id, fellowship_id: c.fellowship_id, title, body: text, is_published: body?.isPublished !== false, created_by: user.userId } });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.campaign_update_posted', entity_type: 'campaign', entity_id: id, fellowship_id: c.fellowship_id } });
    return u;
  }

  async updates(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Campaign not found');
    const c = await this.prisma.contributionCampaign.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!c) throw new NotFoundException('Campaign not found');
    await this.scope.requireView(user, c.department_id);
    return this.prisma.campaignUpdate.findMany({ where: { campaign_id: id }, orderBy: { created_at: 'desc' } });
  }

  async setUpdateVisibility(user: any, id: string, updateId: string, body: any) {
    await this.manage(user, id);
    if (!isUuid(updateId)) throw new NotFoundException('Update not found');
    const done = await this.prisma.campaignUpdate.updateMany({ where: { id: updateId, campaign_id: id }, data: { is_published: body?.isPublished === true } });
    if (!done.count) throw new NotFoundException('Update not found');
    return this.prisma.campaignUpdate.findUnique({ where: { id: updateId } });
  }

  /** The public page: aggregates only. A wrong or unpublished address is a plain 404. */
  async publicPage(slug: string) {
    if (typeof slug !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(slug)) throw new NotFoundException('Campaign not found');
    const c = await this.prisma.contributionCampaign.findUnique({ where: { public_slug: slug } });
    if (!c || !c.is_public || !['active', 'paused', 'closed'].includes(c.status)) throw new NotFoundException('Campaign not found');
    const [fellowship, project, contrib, income, updates] = await Promise.all([
      c.fellowship_id ? this.prisma.fellowship.findUnique({ where: { id: c.fellowship_id }, select: { name: true, location: true, status: true } }) : null,
      c.project_id ? this.prisma.project.findUnique({ where: { id: c.project_id }, select: { name: true, purpose: true, location: true, start_date: true, end_date: true } }) : null,
      this.prisma.contribution.aggregate({ where: { campaign_id: c.id, status: 'active' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.incomeRecord.aggregate({ where: { campaign_id: c.id, status: 'active' }, _sum: { amount: true } }),
      this.prisma.campaignUpdate.findMany({ where: { campaign_id: c.id, is_published: true }, orderBy: { created_at: 'desc' }, take: 20, select: { id: true, title: true, body: true, created_at: true } }),
    ]);
    if (!fellowship || fellowship.status !== 'active') throw new NotFoundException('Campaign not found');
    const settings = await this.prisma.financeSettings.findUnique({ where: { fellowship_id: c.fellowship_id! }, select: { currency: true } });
    const raised = D(contrib._sum.amount).plus(income._sum.amount ?? 0);
    const target = D(c.target_amount);
    return {
      fellowship: fellowship.name, location: fellowship.location, currency: settings?.currency ?? 'TZS',
      title: c.name, description: c.description, status: c.status,
      project: project ? { name: project.name, purpose: project.purpose, location: project.location, startDate: project.start_date, endDate: project.end_date } : null,
      startDate: c.start_date, endDate: c.end_date,
      target: target.toFixed(2), raised: raised.toFixed(2), remaining: Prisma.Decimal.max(target.minus(raised), ZERO).toFixed(2),
      progressPercent: target.isZero() ? 0 : Math.min(100, Math.round(raised.div(target).times(100).toNumber())),
      contributionCount: contrib._count._all,
      budget: ((c.budget_breakdown as any[]) || []).map((b) => ({ item: b.item, amount: money(b.amount) })),
      updates,
    };
  }
}
