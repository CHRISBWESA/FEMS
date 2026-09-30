import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { currentRequestContext } from '../shared/middleware/request-context.store';
import { BillingSubscriptionsService } from '../billing/billing-subscriptions.service';
import { PlatformOnboardingService } from './platform-onboarding.service';
import { email, parsePaging, requirePermission, requireUuid, text } from './platform.util';

// A prospective fellowship owner asks to join, and a platform administrator decides. The request is the only
// place a stranger's details exist: it grants nothing on its own, and approval runs the same onboarding service
// the platform screen uses, so a signup can never bypass the tenant/security boundary.
@Injectable()
export class FellowshipRegistrationService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private onboarding: PlatformOnboardingService,
    private subscriptions: BillingSubscriptionsService,
  ) {}

  /** Plans read without a permission check, for the public form and for matching a requested plan code. */
  private async allPlans() {
    return this.prisma.saasPlan.findMany({
      where: { is_active: true },
      orderBy: [{ price_amount: 'asc' }, { name: 'asc' }],
      take: 200,
      select: { id: true, code: true, name: true, description: true, trial_days: true },
    });
  }

  // ---------- public ----------

  /**
   * Submit a request. Public and unauthenticated, so it is deliberately unhelpful about what already exists:
   * a duplicate pending request for the same address answers exactly like a fresh one, so this cannot be used
   * to discover who is already on the platform. Rate limiting and the conditional insert do the rest.
   */
  async submit(dto: any) {
    const fellowshipName = text('fellowshipName', dto?.fellowshipName, { min: 2, max: 120, required: true }) as string;
    const location = text('location', dto?.location, { max: 200 });
    const description = text('description', dto?.description, { max: 1000 });
    const contactFirstName = text('contactFirstName', dto?.contactFirstName, { min: 1, max: 80, required: true }) as string;
    const contactLastName = text('contactLastName', dto?.contactLastName, { min: 1, max: 80, required: true }) as string;
    const address = email('email', dto?.email);
    const phone = text('phone', dto?.phone, { max: 40 });
    const reason = text('reason', dto?.reason, { max: 1000 });

    // A plan code is optional. Keep the applicant's answer even if the plan has since been retired, so the
    // review screen can still show what was asked for - but never fail the request over it.
    let requestedPlanCode: string | null = null;
    if (dto?.requestedPlanCode !== undefined && dto?.requestedPlanCode !== null && dto?.requestedPlanCode !== '') {
      requestedPlanCode = text('requestedPlanCode', dto.requestedPlanCode, { max: 60 }) as string;
    }

    const existing = await this.prisma.fellowshipRegistration.findFirst({
      where: { email: address, status: 'pending' },
      select: { id: true },
    });
    if (!existing) {
      const created = await this.prisma.fellowshipRegistration.create({
        data: {
          fellowship_name: fellowshipName, location, description,
          contact_first_name: contactFirstName, contact_last_name: contactLastName,
          email: address, phone, requested_plan_code: requestedPlanCode, reason,
          submitted_ip: currentRequestContext()?.ip ?? null,
        },
      });
      await this.auditService.log({
        userId: null, action: 'platform.registration_submit', entityType: 'fellowship_registration', entityId: created.id,
        fellowshipId: null, newValue: { fellowshipName, requestedPlanCode },
      });
    }
    // One answer either way: the applicant is not told whether the address was already on file.
    return {
      received: true,
      message: 'Thank you. A platform administrator will review your request and contact you with the outcome.',
    };
  }

  /** Plan codes the public form may offer. Public, read-only, active plans only. */
  async publicPlans() {
    return (await this.allPlans()).map((p) => ({
      code: p.code, name: p.name, description: p.description, trialDays: p.trial_days,
    }));
  }

  // ---------- platform side ----------

  async list(user: any, q: Record<string, string> = {}) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_VIEW);
    const { take, skip } = parsePaging(q.limit, q.page, 50);
    const where: Prisma.FellowshipRegistrationWhereInput = {};
    if (q.status) {
      if (!['pending', 'approved', 'rejected'].includes(q.status)) throw new BadRequestException('status must be pending, approved or rejected');
      where.status = q.status as any;
    }
    const search = text('search', q.search, { max: 100 });
    if (search) {
      where.OR = [
        { fellowship_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { contact_first_name: { contains: search, mode: 'insensitive' } },
        { contact_last_name: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.fellowshipRegistration.findMany({ where, orderBy: { created_at: 'desc' }, take, skip }),
      this.prisma.fellowshipRegistration.count({ where }),
    ]);
    const counts = await this.prisma.fellowshipRegistration.groupBy({ by: ['status'], _count: { _all: true } });
    return {
      data: rows.map((r) => this.present(r)),
      total,
      counts: {
        pending: counts.find((c) => c.status === 'pending')?._count._all ?? 0,
        approved: counts.find((c) => c.status === 'approved')?._count._all ?? 0,
        rejected: counts.find((c) => c.status === 'rejected')?._count._all ?? 0,
      },
    };
  }

  async get(user: any, id: string) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_VIEW);
    requireUuid('id', id);
    const row = await this.prisma.fellowshipRegistration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Request not found');
    return this.present(row);
  }

  /**
   * Approve: run the normal onboarding service, then mark the request approved and link the two. The status flip
   * is a conditional write, so two administrators cannot both approve the same request, and onboarding's own
   * name/email clash checks still apply.
   */
  async approve(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_ONBOARD);
    requireUuid('id', id);
    // Claim the request BEFORE creating anything. Onboarding runs a name-uniqueness check and then its own
    // transaction, so checking the status afterwards would let two administrators both pass that check and
    // create two fellowships from one request.
    const claim = await this.prisma.fellowshipRegistration.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'approved', reviewed_by: user.userId, reviewed_at: new Date() },
    });
    if (claim.count !== 1) throw new ConflictException('This request has already been decided.');
    const row = await this.prisma.fellowshipRegistration.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Request not found');

    const modules = this.parseModules(dto?.modules);
    const note = text('note', dto?.note, { max: 500 });

    try {
      const result = await this.onboarding.onboard(user, {
        name: row.fellowship_name,
        location: row.location ?? undefined,
        description: row.description ?? undefined,
        modules,
        administrator: { email: row.email, firstName: row.contact_first_name, lastName: row.contact_last_name, phone: row.phone ?? undefined },
      });

      // If the operator asked for a plan, attach it to the new tenant. Done after onboarding so a plan failure
      // cannot leave a half-created fellowship, and reported rather than hidden.
      let subscription: any = null;
      let subscriptionNote: string | undefined;
      const planCode = text('planCode', dto?.planCode, { max: 60 });
      if (planCode) {
        const plan = (await this.allPlans()).find((p) => p.code === planCode);
        if (!plan) throw new BadRequestException('planCode must match an existing plan');
        try {
          subscription = await this.subscriptions.assign(user, result.fellowship.id, { planId: plan.id, startTrial: dto?.startTrial === true });
        } catch (e) {
          subscriptionNote = `The fellowship was created, but the plan could not be assigned: ${(e as any)?.message ?? 'unknown error'}`;
        }
      } else if (row.requested_plan_code) {
        subscriptionNote = `The applicant asked about "${row.requested_plan_code}". No plan was assigned - set one on the fellowship.`;
      }

      await this.prisma.fellowshipRegistration.update({
        where: { id },
        data: { decision_note: note, created_fellowship_id: result.fellowship.id },
      });
      await this.auditService.log({
        userId: user.userId, action: 'platform.registration_approve', entityType: 'fellowship_registration', entityId: id,
        fellowshipId: result.fellowship.id, newValue: { fellowshipName: row.fellowship_name, planCode: planCode ?? null, note: note ?? undefined },
      });

      return {
        registration: { id, status: 'approved', fellowshipId: result.fellowship.id },
        fellowship: result.fellowship,
        administrator: result.administrator,
        // The offices still to fill. Onboarding creates one account - the fellowship administrator - so the
        // reviewer hands out a single temporary password and the fellowship appoints its own officers afterwards.
        officesToFill: result.officesToFill,
        subscription,
        note: result.note,
        ...(subscriptionNote ? { subscriptionNote } : {}),
      };
    } catch (e) {
      // Onboarding failed, so nothing was created. Release the claim and put the request back in the queue
      // rather than leaving a request marked approved that has no fellowship behind it.
      await this.prisma.fellowshipRegistration.updateMany({
        where: { id, created_fellowship_id: null },
        data: { status: 'pending', reviewed_by: null, reviewed_at: null, decision_note: null },
      });
      throw e;
    }
  }

  async reject(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_MANAGE);
    requireUuid('id', id);
    const note = text('note', dto?.note, { min: 5, max: 500, required: true }) as string;
    const flip = await this.prisma.fellowshipRegistration.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', reviewed_by: user.userId, reviewed_at: new Date(), decision_note: note },
    });
    if (flip.count !== 1) throw new ConflictException('This request has already been decided.');
    await this.auditService.log({
      userId: user.userId, action: 'platform.registration_reject', entityType: 'fellowship_registration', entityId: id,
      fellowshipId: null, comment: note, newValue: { fellowshipName: (await this.prisma.fellowshipRegistration.findUnique({ where: { id }, select: { fellowship_name: true } }))?.fellowship_name },
    });
    return { id, status: 'rejected', note };
  }

  private parseModules(input: unknown): Record<string, boolean> {
    if (input === undefined || input === null) return {};
    if (typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('modules must be an object');
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (typeof v !== 'boolean') throw new BadRequestException(`modules.${k} must be true or false`);
      out[k] = v;
    }
    return out;
  }

  private present(r: any) {
    return {
      id: r.id,
      fellowshipName: r.fellowship_name,
      location: r.location,
      description: r.description,
      contactName: `${r.contact_first_name} ${r.contact_last_name}`.trim(),
      email: r.email,
      phone: r.phone,
      requestedPlanCode: r.requested_plan_code,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decision_note,
      createdFellowshipId: r.created_fellowship_id,
      submittedIp: r.submitted_ip,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    };
  }
}
