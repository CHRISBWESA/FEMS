import { Controller, Get, Injectable, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../shared/decorators/public.decorator';
import { PUBLIC_THROTTLE } from '../shared/throttle';
import { platformRobots } from './public-site.seo';

/**
 * The handful of numbers the platform's own marketing pages quote.
 *
 * Aggregate counts only, and never a name. "Trusted by 40 fellowships" is the sort of figure a pricing page needs;
 * "here are our 40 fellowships and their secretaries' e-mail addresses" is a data breach, so the projection below
 * cannot express it even if someone edits this file later.
 */
@Injectable()
export class PlatformSiteService {
  constructor(private readonly prisma: PrismaService) {}

  async stats() {
    const [fellowships, publishedSites, members] = await Promise.all([
      this.prisma.fellowship.count({ where: { status: 'active' } }),
      this.prisma.fellowship.count({ where: { status: 'active', public_site_enabled: true } }),
      this.prisma.member.count({ where: { fellowship_id: { not: null } } }),
    ]);
    return { fellowships, publishedSites, members };
  }

  /**
   * The pricing table, read from the same `saas_plans` rows the platform administers.
   *
   * Only ACTIVE plans are returned, so a retired or half-built plan cannot appear on a page a stranger reads. The
   * price is a number here rather than the `Decimal` the column holds, because it goes into JSON for a page that
   * formats it; `limits` comes through as the stored object because the caps are part of what the tier offers and
   * hiding them would make the table dishonest.
   */
  async plans() {
    const rows = await this.prisma.saasPlan.findMany({
      where: { is_active: true },
      select: {
        code: true, name: true, description: true,
        price_amount: true, currency: true, billing_interval: true,
        trial_days: true, modules: true, limits: true,
      },
      orderBy: { price_amount: 'asc' },
    });
    return rows.map((p) => ({
      code: p.code,
      name: p.name,
      description: p.description ?? null,
      price: Number(p.price_amount),
      currency: p.currency,
      interval: p.billing_interval,
      trialDays: p.trial_days,
      modules: p.modules,
      limits: p.limits,
    }));
  }
}

/**
 * The platform's own public site (the apex domain), as opposed to a fellowship's subdomain.
 *
 * Kept to one endpoint on purpose. The marketing copy itself lives in the frontend — it is copy, not data, and
 * putting it in the database would give the content manager four more things to maintain with no benefit. Only the
 * figures and the plan list, which are genuinely read from the database, come from here.
 */
@Controller('public/site')
export class PlatformSiteController {
  constructor(private readonly platformSite: PlatformSiteService) {}

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get('stats')
  stats() {
    return this.platformSite.stats();
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get('plans')
  plans() {
    return this.platformSite.plans();
  }

  /**
   * A crawler hint for the platform's own apex.
   *
   * Lives on THIS controller because it is the one prefixed `public/site`. A sibling route here once carried
   * `@Get('site/robots.txt')`, which the `public/fellowships` prefix turned into a request for a fellowship whose
   * subdomain was the literal string "site" - so the file was simply never served.
   */
  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get('robots.txt')
  robots(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(platformRobots());
  }
}
