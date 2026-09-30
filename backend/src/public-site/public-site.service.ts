import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validateText, validateAmount } from '../shared/utils/validation.util';
import { isUuid } from '../shared/utils/uuid.util';
import { readStoredFile } from '../shared/utils/file-storage.util';
import { renderSitemap, fellowshipRobots } from './public-site.seo';
import { slugify, fellowshipHost } from '../shared/tenancy/subdomain.util';
import {
  PUBLIC_PAGES,
  PUBLIC_LEADERSHIP_ROLES,
  PUBLICLY_PUBLISHED_APPROVAL_STATUSES,
  isPublicPageKey,
} from './public-site.constants';

/** How many items each public list returns. Deliberately small: this is a landing page, not a data export. */
const LIST_LIMIT = 50;

export type EnquiryKindInput = 'prayer_request' | 'contact_message' | 'donation_pledge';

/**
 * The unauthenticated side of a fellowship's public site.
 *
 * Two rules govern everything here.
 *
 * 1. **Nothing is public until it is published.** Content is read through the approval states in
 *    `PUBLICLY_PUBLISHED_APPROVAL_STATUSES`, and a fellowship must additionally have `public_site_enabled` set
 *    before its subdomain resolves at all.
 * 2. **The public surface is narrower than the internal one.** This service selects named columns rather than
 *    spreading rows, so a member's e-mail address or a document's stored filename cannot leak into a page by
 *    accident when the schema changes. Leadership is published as a name and an office, never a contact detail.
 */
@Injectable()
export class PublicSiteService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- resolution

  /**
   * Folds whatever the caller sent (a subdomain, or a whole `Host` header) down to a bare DNS label.
   * Returns '' when there is nothing usable, which the caller turns into a 404.
   */
  normaliseSubdomain(raw: string | undefined | null): string {
    if (!raw) return '';
    let value = String(raw).trim().toLowerCase();
    // A Host header is `label.example.com:5173`; a URL path segment may be percent-encoded.
    value = value.split('/')[0].split(':')[0];
    try {
      value = decodeURIComponent(value);
    } catch {
      // A malformed escape sequence is simply not a subdomain.
      return '';
    }
    if (value.includes('.')) {
      // Keep only the leftmost label, so `casfeta.example.com` and `casfeta` both resolve.
      value = value.split('.')[0];
    }
    return slugify(value);
  }

  /**
   * Resolves a subdomain to the fellowship that owns it, but only if that fellowship is published and not
   * suspended. The not-found message is deliberately identical whether the label is unknown, taken by a
   * fellowship, or held by a fellowship that has not switched its site on — otherwise this endpoint would let
   * anyone enumerate which subdomains exist and whether a fellowship has published.
   */
  private async resolvePublishedFellowship(subdomain: string) {
    const label = this.normaliseSubdomain(subdomain);
    if (!label) throw new NotFoundException('This site could not be found.');

    const fellowship = await this.prisma.fellowship.findFirst({
      where: { subdomain: label, public_site_enabled: true, status: 'active' },
      select: { id: true, name: true, subdomain: true, location: true, site_updated_at: true },
    });
    if (!fellowship) throw new NotFoundException('This site could not be found.');
    return { ...fellowship, host: fellowshipHost(fellowship.subdomain as string) };
  }

  // ---------------------------------------------------------------- identity + pages

  /**
   * Everything the shell of a landing page needs: who this is, how to reach them, and the editable copy for each
   * page. Fetched in one call so the header, footer and hero never render against half a page.
   */
  async site(subdomain: string) {
    const fellowship = await this.resolvePublishedFellowship(subdomain);

    const profile = await this.prisma.publicProfile.findUnique({
      where: { fellowship_id: fellowship.id },
      select: {
        tagline: true, story: true, mission: true, vision: true,
        email: true, phone: true, address: true, service_times: true,
        facebook_url: true, youtube_url: true, whatsapp_url: true, updated_at: true,
      },
    });

    const rows = await this.prisma.publicPage.findMany({
      where: { fellowship_id: fellowship.id },
      select: { key: true, title: true, subtitle: true, body: true, is_visible: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));

    return {
      fellowship: {
        name: fellowship.name,
        subdomain: fellowship.subdomain,
        host: fellowship.host,
        location: fellowship.location ?? profile?.address ?? null,
        // When the site was last changed, so the page can render a "as at" line and the sitemap can quote a real
        // `lastmod`. Null is meaningful: nothing has been written yet.
        siteUpdatedAt: fellowship.site_updated_at,
      },
      profile,
      // The catalogue is the source of truth for which pages exist; the row supplies the fellowship's own copy and
      // a page the IT administrator has not written yet still appears, with its default title, rather than 404ing.
      pages: PUBLIC_PAGES.map((meta) => {
        const row = byKey.get(meta.key);
        return {
          key: meta.key,
          path: meta.path,
          label: meta.label,
          title: row?.title || meta.title,
          subtitle: row?.subtitle ?? null,
          body: row?.body ?? null,
          isVisible: row ? row.is_visible : true,
        };
      }),
    };
  }

  /** The introduction copy for one page, or null if the page key is not part of the landing page. */
  async pageCopy(subdomain: string, key: string) {
    if (!isPublicPageKey(key)) return null;
    const fellowship = await this.resolvePublishedFellowship(subdomain);
    const row = await this.prisma.publicPage.findUnique({
      where: { fellowship_id_key: { fellowship_id: fellowship.id, key } },
      select: { key: true, title: true, subtitle: true, body: true, is_visible: true },
    });
    const meta = PUBLIC_PAGES.find((p) => p.key === key)!;
    return {
      key,
      path: meta.path,
      label: meta.label,
      title: row?.title || meta.title,
      subtitle: row?.subtitle ?? null,
      body: row?.body ?? null,
      isVisible: row ? row.is_visible : true,
    };
  }

  /** Resolved once and handed to every list endpoint, so a page can load all of them in parallel. */
  async fellowshipIdFor(subdomain: string): Promise<string> {
    return (await this.resolvePublishedFellowship(subdomain)).id;
  }

  // ---------------------------------------------------------------- lists

  /**
   * Office holders, as name plus office. Built by reading `users.roles` rather than the `Role` table, because
   * that array is the single source of truth the JWT strategy already enforces.
   *
   * Only first and last name are selected. An e-mail address or phone number is deliberately absent from the
   * projection: a leadership page is public information about an office, not a directory of private numbers.
   */
  async leadership(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const users = await this.prisma.user.findMany({
      where: {
        fellowship_id: fellowshipId,
        is_active: true,
        deleted_at: null,
        roles: { hasSome: [...PUBLIC_LEADERSHIP_ROLES] },
      },
      select: { first_name: true, last_name: true, roles: true, department_id: true },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      take: LIST_LIMIT,
    });

    return users
      .map((u) => ({
        name: `${u.first_name} ${u.last_name}`.trim(),
        // Ordered by the canonical precedence in PUBLIC_LEADERSHIP_ROLES, not by whatever order the array
        // happens to be stored in, so the list reads the same every time.
        offices: PUBLIC_LEADERSHIP_ROLES.filter((role) => u.roles.includes(role)),
      }))
      .filter((entry) => entry.offices.length > 0)
      // A placeholder seat is dropped rather than published. Onboarding mints one account per office with the
      // office as the person's name ("Treasurer", no surname) and a placeholder address, because the platform
      // administrator is meant to replace it. Printing that on a public page would tell a visitor that the
      // fellowship's treasurer is called "Treasurer" - a row of dummy entries in place of real leadership. The
      // fellowship's own IT manager can still see the placeholders, and the page names the offices it is missing.
      .filter((entry) => !isPlaceholderIdentity(entry.name));
  }

  async departments(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.department.findMany({
      where: { fellowship_id: fellowshipId, is_active: true },
      select: {
        name: true,
        description: true,
        _count: { select: { members: true, leaders: true } },
      },
      orderBy: { name: 'asc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({
      name: r.name,
      description: r.description ?? null,
      memberCount: r._count.members,
      leaderCount: r._count.leaders,
    }));
  }

  async ministries(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.programme.findMany({
      where: { fellowship_id: fellowshipId },
      select: { name: true, description: true },
      orderBy: { name: 'asc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({ name: r.name, description: r.description ?? null }));
  }

  /**
   * Upcoming activities, soonest first. Past activities are deliberately not shown: a landing page is a "what is
   * happening" surface, and an events archive is an internal reporting concern.
   */
  async events(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.activity.findMany({
      where: { fellowship_id: fellowshipId, date: { gte: new Date() } },
      select: { title: true, description: true, date: true, end_date: true, specific_group: true },
      orderBy: { date: 'asc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({
      title: r.title,
      description: r.description ?? null,
      date: r.date,
      endDate: r.end_date,
      group: r.specific_group ?? null,
    }));
  }

  async news(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.announcement.findMany({
      where: {
        fellowship_id: fellowshipId,
        status: { in: [...PUBLICLY_PUBLISHED_APPROVAL_STATUSES] },
      },
      select: { id: true, title: true, content: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({ id: r.id, title: r.title, content: r.content, publishedAt: r.created_at }));
  }

  /**
   * Approved website documents, as a downloadable list.
   *
   * The bytes are now written on upload, so a `downloadUrl` here is real. It is included in the projection because
   * the alternative is a public page listing files nobody can fetch. `stored_filename` stays out: it is a
   * server-side path fragment and has no business in a public payload.
   */
  async publications(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.documentEntity.findMany({
      where: {
        fellowship_id: fellowshipId,
        is_website_content: true,
        approval_status: { in: [...PUBLICLY_PUBLISHED_APPROVAL_STATUSES] },
      },
      select: { id: true, title: true, mime_type: true, file_size: true, filename: true, uploaded_at: true },
      orderBy: { uploaded_at: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      contentType: r.mime_type,
      sizeBytes: r.file_size,
      fileName: r.filename,
      uploadedAt: r.uploaded_at,
      downloadUrl: `/api/v1/public/fellowships/${subdomain}/documents/${r.id}`,
    }));
  }

  /**
   * Photographs for the gallery, served as real image URLs.
   *
   * The document id is in the URL rather than the stored name, so the path is derived from a database row and can
   * never be a traversal. Only approved, website-flagged image documents of THIS fellowship are reachable.
   */
  async gallery(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.documentEntity.findMany({
      where: {
        fellowship_id: fellowshipId,
        is_website_content: true,
        mime_type: { startsWith: 'image/' },
        approval_status: { in: [...PUBLICLY_PUBLISHED_APPROVAL_STATUSES] },
      },
      select: { id: true, title: true, mime_type: true, uploaded_at: true },
      orderBy: { uploaded_at: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      contentType: r.mime_type,
      uploadedAt: r.uploaded_at,
      imageUrl: `/api/v1/public/fellowships/${subdomain}/documents/${r.id}`,
    }));
  }

  /**
   * The bytes of an approved website document, for a visitor.
   *
   * Three conditions, all required: the document is flagged as website content, it is approved, and it belongs to
   * the fellowship whose subdomain was used to get here. The last is what stops a visitor using a valid document id
   * from another site.
   */
  async publicDocument(subdomain: string, documentId: string) {
    if (!isUuid(documentId)) throw new NotFoundException('File not found');
    const fellowship = await this.resolvePublishedFellowship(subdomain);

    const doc = await this.prisma.documentEntity.findFirst({
      where: {
        id: documentId,
        fellowship_id: fellowship.id,
        is_website_content: true,
        approval_status: { in: [...PUBLICLY_PUBLISHED_APPROVAL_STATUSES] },
      },
      select: { stored_filename: true, filename: true, mime_type: true },
    });
    // One answer for "no such id", "not approved", "another fellowship's" and "not on this site", so the route
    // cannot be used to probe which document ids exist.
    if (!doc) throw new NotFoundException('File not found');

    const bytes = await readStoredFile(doc.stored_filename);
    return { bytes, filename: doc.filename, mimeType: doc.mime_type };
  }

  /** Sermons, testimonies and projects share one table and one projection. */
  private async postsOfKind(subdomain: string, kind: 'sermon' | 'testimony' | 'project') {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.publicPost.findMany({
      where: { fellowship_id: fellowshipId, kind, is_published: true },
      select: {
        id: true, title: true, body: true, reference: true, attribution: true,
        media_url: true, happens_at: true,
      },
      // An explicit sort order first, then newest first, so a fellowship can pin what it wants at the top.
      orderBy: [{ sort_order: 'desc' }, { happens_at: 'desc' }, { created_at: 'desc' }],
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body ?? null,
      reference: r.reference ?? null,
      attribution: r.attribution ?? null,
      mediaUrl: r.media_url ?? null,
      happensAt: r.happens_at,
    }));
  }

  sermons(subdomain: string) {
    return this.postsOfKind(subdomain, 'sermon');
  }

  testimonies(subdomain: string) {
    return this.postsOfKind(subdomain, 'testimony');
  }

  projects(subdomain: string) {
    return this.postsOfKind(subdomain, 'project');
  }

  /**
   * Photographs for the gallery.
   *
   * A picture is a published post that has a `mediaUrl`, whatever its kind — a sermon with a poster and a project
   * with a photo are both gallery images. The `mediaUrl` is a URL rather than an upload, so the gallery is served
   * from wherever the fellowship already keeps its images.
   *
   * `media_url: { not: null }` in the query means an item without one can never reach this list, so a broken
   * `<img>` cannot appear from here.
   */
  async galleryPhotos(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.publicPost.findMany({
      where: { fellowship_id: fellowshipId, is_published: true, media_url: { not: null } },
      select: { id: true, title: true, media_url: true, kind: true, happens_at: true },
      orderBy: [{ sort_order: 'desc' }, { created_at: 'desc' }],
      take: LIST_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      mediaUrl: r.media_url,
      kind: r.kind,
      happensAt: r.happens_at,
    }));
  }

  /** Open service opportunities, for "Get Involved". */
  async getInvolved(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.serviceOpportunity.findMany({
      where: { fellowship_id: fellowshipId, status: 'open' },
      select: { title: true, description: true, location: true, shifts: { select: { starts_at: true } } },
      orderBy: { created_at: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => {
      // The next shift is the only date a prospective volunteer needs; the full roster is internal.
      const upcoming = r.shifts
        .map((s) => s.starts_at)
        .filter((d): d is Date => d instanceof Date && d.getTime() >= Date.now())
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        title: r.title,
        description: r.description ?? null,
        location: r.location ?? null,
        nextShiftAt: upcoming ?? null,
      };
    });
  }

  /** Active contribution campaigns, for "Give". Progress is real, summed from recorded contributions. */
  async giving(subdomain: string) {
    const fellowshipId = await this.fellowshipIdFor(subdomain);
    const rows = await this.prisma.contributionCampaign.findMany({
      where: { fellowship_id: fellowshipId, status: 'active' },
      select: {
        name: true, description: true, target_amount: true, start_date: true, end_date: true,
        contributions: { select: { amount: true } },
      },
      orderBy: { created_at: 'desc' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => {
      // Decimal is summed as a string to stay exact; a float sum of currency is not.
      const raisedCents = r.contributions.reduce(
        (total, c) => total + Math.round(Number(c.amount) * 100),
        0,
      );
      return {
        name: r.name,
        description: r.description ?? null,
        target: r.target_amount === null ? null : Number(r.target_amount),
        raised: raisedCents / 100,
        startsAt: r.start_date,
        endsAt: r.end_date,
      };
    });
  }

  // ---------------------------------------------------------------- machine-readable

  /**
   * The published site's own sitemap.
   *
   * Only VISIBLE pages are listed. A page the fellowship has hidden is absent from the document, not merely from
   * the menu, so "hidden" means hidden from a crawler as well as from a visitor - otherwise the sitemap would undo
   * the hiding. An unpublished fellowship 404s here, like everywhere else.
   */
  async sitemap(subdomain: string): Promise<string> {
    const { fellowship, pages, profile } = await this.site(subdomain);
    const base = `https://${fellowship.host}`;
    // The most recent change to anything on the site, which is what `lastmod` means. Null when the fellowship has
    // never written anything, and then the field is simply omitted rather than guessed at.
    const lastmod = fellowship.siteUpdatedAt ?? profile?.updated_at ?? null;

    // Ranked by how much a visitor is likely to want them, and how often they change. A landing page changes often;
    // a prayer page changes when the fellowship decides it should. Claiming a cadence the code cannot know would be
    // telling a crawler something untrue.
    const weight: Record<string, { freq: string; priority: string }> = {
      home: { freq: 'weekly', priority: '1.0' },
      about: { freq: 'monthly', priority: '0.8' },
      contact: { freq: 'monthly', priority: '0.7' },
      events: { freq: 'weekly', priority: '0.7' },
      news: { freq: 'weekly', priority: '0.7' },
      departments: { freq: 'monthly', priority: '0.6' },
      ministries: { freq: 'monthly', priority: '0.6' },
      sermons: { freq: 'weekly', priority: '0.6' },
      get_involved: { freq: 'weekly', priority: '0.6' },
      gallery: { freq: 'monthly', priority: '0.5' },
      projects: { freq: 'monthly', priority: '0.5' },
      leadership: { freq: 'monthly', priority: '0.5' },
      give: { freq: 'monthly', priority: '0.5' },
      prayer: { freq: 'yearly', priority: '0.4' },
      publications: { freq: 'monthly', priority: '0.4' },
      testimonies: { freq: 'monthly', priority: '0.4' },
    };

    const entries = pages
      .filter((p) => p.isVisible)
      .map((p) => {
        const w = weight[p.key] ?? { freq: 'monthly', priority: '0.4' };
        // `p.path` is '/' for home and '/about' for the rest, so the join needs no special case.
        return { loc: `${base}${p.path}`, changefreq: w.freq, priority: w.priority, lastmod };
      });

    return renderSitemap(entries);
  }

  robots(subdomain: string): string {
    return fellowshipRobots(slugify(subdomain));
  }

  // ---------------------------------------------------------------- writes

  /**
   * Stores something a visitor sent through the public site.
   *
   * The response is a fixed acknowledgement, never the stored row: echoing it back would let an automated client
   * confirm how a record was stored, and there is no reason a prayer request should get a receipt. The submitter's
   * IP is recorded for abuse handling only, and `is_private` defaults to true because a prayer request should not
   * be republished by default.
   */
  async submitEnquiry(
    kind: EnquiryKindInput,
    body: any,
    submittedIp?: string,
  ): Promise<{ message: string }> {
    const fellowship = await this.resolvePublishedFellowship(body?.subdomain);

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required');
    }

    const name = validateText('name', body.name, 120, true)!;
    const message = validateText('message', body.message, 4000, true)!;
    // Contact details are optional: the point of a prayer request is that it can be sent with nothing but a name.
    const email = validateText('email', body.email, 254);
    const phone = validateText('phone', body.phone, 40);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('email is not a valid address');
    }

    // `validateAmount` returns a fixed 2-decimal string, which is exactly what Prisma's Decimal column wants.
    // The honeypot. A real person never sees this field, because it is hidden from the form; a bot fills in every
    // input it finds. A submission with anything in it is dropped SILENTLY - same acknowledgement, no row - so a
    // bot learns nothing from the response and cannot tell the trap from a success.
    if (typeof body.company_website === 'string' && body.company_website.trim() !== '') {
      return { message: acknowledgementFor(kind) };
    }

    // Reported as 429 with the standard shape the throttler itself uses, so a client sees one consistent answer
    // whether the per-IP route limit or this per-fellowship cap refused it.
    class VolumeCapReached extends HttpException {
      constructor() {
        super('This page is receiving too many messages right now. Please try again later.', 429);
      }
    }

    // The per-fellowship volume cap, underneath the per-IP route limit.
    //
    // The route limit is per client address, which a botnet rotates. This one counts everything aimed at ONE
    // fellowship, so it holds however many addresses are used. Counted over a rolling hour and read before the
    // insert, so it also bounds a flood from a single address a little earlier than the route limiter would.
    const cap = numEnv('PUBLIC_ENQUIRY_CAP', 30);
    if (cap > 0) {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await this.prisma.publicEnquiry.count({
        where: { fellowship_id: fellowship.id, created_at: { gte: hourAgo } },
      });
      if (recent >= cap) {
        throw new VolumeCapReached();
      }
    }

    let amount: string | null = null;
    if (kind === 'donation_pledge' && body.amount !== undefined && body.amount !== null && body.amount !== '') {
      amount = validateAmount('amount', body.amount);
    }
    const currency = kind === 'donation_pledge' ? validateText('currency', body.currency, 3)?.toUpperCase() || 'USD' : null;

    await this.prisma.publicEnquiry.create({
      data: {
        fellowship_id: fellowship.id,
        kind,
        name,
        email: email ?? null,
        phone: phone ?? null,
        message,
        amount,
        currency,
        submitted_ip: submittedIp ?? null,
      },
    });

    return { message: acknowledgementFor(kind) };
  }
}

/**
 * Is this a placeholder account rather than a person?
 *
 * Onboarding mints one seat per office so a fellowship has somewhere to put each role before anybody is appointed.
 * Those seats are named after the office ("Treasurer"), carry no surname, and hold a placeholder e-mail. Two
 * independent signals are required, because a real person is perfectly capable of being called "Treasurer" - but a
 * real person called "Treasurer" and nothing else, with a role they genuinely hold, is not what these rows are.
 */
function isPlaceholderIdentity(name: string): boolean {
  const parts = name.split(/\s+/).filter(Boolean);
  // No surname at all: every real account has at least a first and last name.
  if (parts.length < 2) return true;
  // A single word that is exactly an office title.
  return parts.length === 2 && PUBLIC_LEADERSHIP_ROLES.includes(parts[0].toLowerCase() as any);
}

/** An environment value as a number, or the fallback when it is absent or not a number. */
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The fixed reply a visitor gets.
 *
 * One per kind, never reflecting what was stored and never a receipt. A honeypot rejection returns exactly the
 * same string as a real submission, so a bot cannot use the response to detect the trap.
 */
function acknowledgementFor(kind: EnquiryKindInput): string {
  if (kind === 'donation_pledge') {
    return 'Thank you. Your intention to give has been received and the fellowship will contact you.';
  }
  if (kind === 'prayer_request') {
    return 'Your prayer request has been received. The fellowship will be in touch.';
  }
  return 'Your message has been received. The fellowship will reply as soon as it can.';
}
