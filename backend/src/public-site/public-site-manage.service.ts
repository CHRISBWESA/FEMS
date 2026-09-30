import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService, RequesterLike } from '../shared/tenant/tenant-scope.service';
import { validateText } from '../shared/utils/validation.util';
import { suggestSubdomain, fellowshipHost, slugify, RESERVED_SUBDOMAINS } from '../shared/tenancy/subdomain.util';
import { PUBLIC_PAGES, isPublicPageKey } from './public-site.constants';

/**
 * The content manager's side of a fellowship's public site: everything needed to write, arrange and publish the
 * landing page.
 *
 * Scope is resolved with `TenantScopeService`, exactly as every other module does, so an IT administrator can only
 * ever reach their own fellowship. Two consequences are worth stating plainly:
 *
 *  - A `platform_support` account is read-only at platform level and has no fellowship here, so it cannot reach any
 *    of this. Publishing a tenant's content is not a support action.
 *  - The platform administrator is global and can act on any fellowship here, which is intentional: it is the
 *    escalation path when a fellowship's own content manager has left.
 */
@Injectable()
export class PublicSiteManageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  /** The fellowship this request acts on, or a 403 when the caller has none. */
  private resolveTarget(user: RequesterLike | undefined, queryFellowshipId?: string): string {
    const id = this.tenantScope.resolveFellowshipId(user, queryFellowshipId);
    if (!id) {
      throw new NotFoundException('No fellowship is associated with this account.');
    }
    return id;
  }

  /**
   * Stamps "the site changed" on the fellowship.
   *
   * A single column, written by every content edit, because the sitemap's `lastmod` needs one answer and deriving
   * it from six tables would mean a query per page on every crawl.
   */
  private async markSiteChanged(fellowshipId: string): Promise<void> {
    await this.prisma.fellowship.update({ where: { id: fellowshipId }, data: { site_updated_at: new Date() } });
  }

  // ---------------------------------------------------------------- read

  /**
   * The whole editable state in one call, so the content manager is a single screen rather than sixteen.
   *
   * Every page in the catalogue is returned, whether or not a row exists, so the editor can show a page the
   * fellowship has not written yet instead of pretending it does not exist.
   */
  async overview(user: RequesterLike | undefined, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);

    const fellowship = await this.prisma.fellowship.findUnique({
      where: { id: fellowshipId },
      select: { id: true, name: true, subdomain: true, location: true, public_site_enabled: true, status: true },
    });
    if (!fellowship) throw new NotFoundException('Fellowship not found');

    const [profile, pageRows, posts, enquiryCounts] = await Promise.all([
      this.prisma.publicProfile.findUnique({ where: { fellowship_id: fellowshipId } }),
      this.prisma.publicPage.findMany({ where: { fellowship_id: fellowshipId } }),
      this.prisma.publicPost.findMany({
        where: { fellowship_id: fellowshipId },
        orderBy: [{ kind: 'asc' }, { sort_order: 'desc' }, { created_at: 'desc' }],
      }),
      this.prisma.publicEnquiry.groupBy({
        by: ['kind', 'is_handled'],
        where: { fellowship_id: fellowshipId },
        _count: { _all: true },
      }),
    ]);

    const byKey = new Map(pageRows.map((r) => [r.key, r]));

    return {
      fellowship: {
        ...fellowship,
        host: fellowship.subdomain ? fellowshipHost(fellowship.subdomain) : null,
        // The site cannot resolve until a subdomain exists, so the editor is told which of the two is missing.
        publishable: Boolean(fellowship.subdomain) && fellowship.status === 'active',
      },
      profile,
      pages: PUBLIC_PAGES.map((meta) => {
        const row = byKey.get(meta.key);
        return {
          key: meta.key,
          path: meta.path,
          label: meta.label,
          nav: meta.nav,
          blurb: meta.blurb,
          title: row?.title ?? '',
          subtitle: row?.subtitle ?? '',
          body: row?.body ?? '',
          isVisible: row ? row.is_visible : true,
          // A page that has never been written shows its catalogue default, so the editor is not staring at a
          // blank field with no hint of what belongs there.
          suggestedTitle: meta.title,
          updatedAt: row?.updated_at ?? null,
        };
      }),
      posts,
      enquiries: {
        total: enquiryCounts.reduce((sum, g) => sum + g._count._all, 0),
        outstanding: enquiryCounts
          .filter((g) => !g.is_handled)
          .reduce((sum, g) => sum + g._count._all, 0),
        byKind: enquiryCounts.map((g) => ({ kind: g.kind, isHandled: g.is_handled, count: g._count._all })),
      },
    };
  }

  // ---------------------------------------------------------------- profile + pages

  async updateProfile(user: RequesterLike | undefined, body: any, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required');
    }

    const data = {
      tagline: validateText('tagline', body.tagline, 200),
      story: validateText('story', body.story, 8000),
      mission: validateText('mission', body.mission, 2000),
      vision: validateText('vision', body.vision, 2000),
      email: validateEmail(validateText('email', body.email, 254)),
      phone: validateText('phone', body.phone, 40),
      address: validateText('address', body.address, 300),
      service_times: validateText('service_times', body.service_times, 500),
      facebook_url: validateHttpUrl(validateText('facebook_url', body.facebook_url, 300)),
      youtube_url: validateHttpUrl(validateText('youtube_url', body.youtube_url, 300)),
      whatsapp_url: validateHttpUrl(validateText('whatsapp_url', body.whatsapp_url, 300)),
      updated_by: user?.userId ?? null,
    };

    // Upsert rather than create: the profile row is optional, and two concurrent saves must not collide.
    const profile = await this.prisma.publicProfile.upsert({
      where: { fellowship_id: fellowshipId },
      create: { fellowship_id: fellowshipId, ...data },
      update: data,
    });

    await this.markSiteChanged(fellowshipId);
    await this.auditService.log({
      userId: user?.userId,
      action: 'public_site.profile_update',
      entityType: 'public_profile',
      entityId: fellowshipId,
      fellowshipId,
      comment: 'Public site profile updated',
    });

    return profile;
  }

  async updatePage(user: RequesterLike | undefined, key: string, body: any, queryFellowshipId?: string) {
    if (!isPublicPageKey(key)) throw new NotFoundException('Unknown page');
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required');
    }

    // An empty title is allowed: the public renderer falls back to the catalogue default, so clearing the field
    // removes the custom heading rather than breaking the page.
    const title = validateText('title', body.title, 200) ?? '';
    const subtitle = validateText('subtitle', body.subtitle, 300);
    const copy = validateText('body', body.body, 8000);
    const isVisible = body.isVisible === undefined ? true : body.isVisible === true;

    const row = await this.prisma.publicPage.upsert({
      where: { fellowship_id_key: { fellowship_id: fellowshipId, key } },
      create: { fellowship_id: fellowshipId, key, title, subtitle, body: copy, is_visible: isVisible, updated_by: user?.userId ?? null },
      update: { title, subtitle, body: copy, is_visible: isVisible, updated_by: user?.userId ?? null },
    });

    await this.markSiteChanged(fellowshipId);
    await this.auditService.log({
      userId: user?.userId,
      action: 'public_site.page_update',
      entityType: 'public_page',
      entityId: fellowshipId,
      fellowshipId,
      newValue: { key, title, isVisible },
      comment: `Public site page "${key}" updated`,
    });

    return row;
  }

  // ---------------------------------------------------------------- publication switch

  /**
   * Turns the whole site on or off. This is the single control that decides whether anything a fellowship uploads
   * is reachable on the internet, so it is audited with both the old and the new value.
   */
  async setPublished(user: RequesterLike | undefined, body: any, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    const enabled = body?.enabled === true;

    const fellowship = await this.prisma.fellowship.findUnique({
      where: { id: fellowshipId },
      select: { subdomain: true, public_site_enabled: true, status: true },
    });
    if (!fellowship) throw new NotFoundException('Fellowship not found');

    if (enabled && !fellowship.subdomain) {
      throw new BadRequestException('Set a subdomain for this fellowship before publishing its site.');
    }
    if (enabled && fellowship.status !== 'active') {
      throw new BadRequestException('A suspended fellowship cannot publish a public site.');
    }

    const updated = await this.prisma.fellowship.update({
      where: { id: fellowshipId },
      data: { public_site_enabled: enabled },
      select: { subdomain: true, public_site_enabled: true },
    });

    await this.markSiteChanged(fellowshipId);
    await this.auditService.log({
      userId: user?.userId,
      action: enabled ? 'public_site.publish' : 'public_site.unpublish',
      entityType: 'fellowship',
      entityId: fellowshipId,
      fellowshipId,
      oldValue: { public_site_enabled: fellowship.public_site_enabled },
      newValue: { public_site_enabled: enabled },
      comment: enabled ? 'Public site published' : 'Public site taken offline',
    });

    return updated;
  }

  /**
   * Claims a subdomain for the fellowship. Kept here rather than on the platform screen because it is the first
   * thing a content manager needs, and it is self-service: the label is derived from the fellowship's own name.
   */
  async setSubdomain(user: RequesterLike | undefined, body: any, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);

    const requested = validateText('subdomain', body?.subdomain, 63);
    const fellowship = await this.prisma.fellowship.findUnique({
      where: { id: fellowshipId },
      select: { name: true, subdomain: true },
    });
    if (!fellowship) throw new NotFoundException('Fellowship not found');

    // An empty submission means "pick one for me". Either way the value is folded to a safe DNS label, so a
    // hand-typed "My Fellowship!" becomes "my-fellowship" instead of reaching DNS.
    const label = requested
      ? slugify(requested)
      : await suggestSubdomain(fellowship.name, (candidate) =>
          this.prisma.fellowship.count({ where: { subdomain: candidate } }).then((n) => n > 0),
        );

    if (!label) throw new BadRequestException('That subdomain does not contain any letters or digits to use.');

    // A fellowship must not be able to claim a label the platform itself serves on. The unique index below stops
    // one fellowship taking another's label, but it cannot stop a fellowship taking `www` or `admin` - which would
    // shadow the platform's own hosts. RESERVED_SUBDOMAINS is the list the suggester already avoids.
    if (RESERVED_SUBDOMAINS.has(label)) {
      throw new BadRequestException(`"${label}" is reserved for the platform. Choose another address.`);
    }

    const clash = await this.prisma.fellowship.findUnique({ where: { subdomain: label }, select: { id: true } });
    if (clash && clash.id !== fellowshipId) {
      throw new BadRequestException(`"${label}" is already in use. Choose another.`);
    }

    const updated = await this.prisma.fellowship.update({
      where: { id: fellowshipId },
      data: { subdomain: label },
      select: { subdomain: true },
    });

    await this.markSiteChanged(fellowshipId);
    await this.auditService.log({
      userId: user?.userId,
      action: 'public_site.subdomain_set',
      entityType: 'fellowship',
      entityId: fellowshipId,
      fellowshipId,
      oldValue: { subdomain: fellowship.subdomain },
      newValue: { subdomain: label },
      comment: `Public site subdomain set to ${label}`,
    });

    return { subdomain: updated.subdomain, host: fellowshipHost(label) };
  }

  // ---------------------------------------------------------------- posts

  async createPost(user: RequesterLike | undefined, body: any, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required');
    }
    const kind = parsePostKind(body.kind);
    if (!user?.userId) throw new BadRequestException('A signed-in account is required');

    const post = await this.prisma.publicPost.create({
      data: {
        fellowship_id: fellowshipId,
        kind,
        title: validateText('title', body.title, 200, true)!,
        body: validateText('body', body.body, 8000),
        reference: validateText('reference', body.reference, 200),
        attribution: validateText('attribution', body.attribution, 200),
        media_url: validateHttpUrl(validateText('media_url', body.media_url, 500)),
        happens_at: parseOptionalDate('happens_at', body.happens_at),
        // Publication is opt-in on create, so an accidental publish needs a second, deliberate action.
        is_published: body.isPublished === true,
        sort_order: parseSortOrder(body.sortOrder),
        created_by: user.userId,
      },
    });

    await this.markSiteChanged(fellowshipId);
    await this.auditService.log({
      userId: user.userId,
      action: 'public_site.post_create',
      entityType: 'public_post',
      entityId: post.id,
      fellowshipId,
      newValue: { kind, title: post.title, isPublished: post.is_published },
      comment: `${kind} created`,
    });

    return post;
  }

  async updatePost(user: RequesterLike | undefined, id: string, body: any, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    if (!id || typeof id !== 'string') throw new NotFoundException('Item not found');

    const existing = await this.prisma.publicPost.findUnique({ where: { id }, select: { fellowship_id: true } });
    if (!existing) throw new NotFoundException('Item not found');
    this.tenantScope.assertInScope(user, existing, queryFellowshipId);

    const data: Record<string, any> = {};
    if (body.title !== undefined) data.title = validateText('title', body.title, 200, true)!;
    if (body.body !== undefined) data.body = validateText('body', body.body, 8000);
    if (body.reference !== undefined) data.reference = validateText('reference', body.reference, 200);
    if (body.attribution !== undefined) data.attribution = validateText('attribution', body.attribution, 200);
    if (body.media_url !== undefined) data.media_url = validateHttpUrl(validateText('media_url', body.media_url, 500));
    if (body.happens_at !== undefined) data.happens_at = parseOptionalDate('happens_at', body.happens_at);
    if (body.isPublished !== undefined) data.is_published = body.isPublished === true;
    if (body.sortOrder !== undefined) data.sort_order = parseSortOrder(body.sortOrder);
    if (Object.keys(data).length === 0) throw new BadRequestException('No fields to update');

    const post = await this.prisma.publicPost.update({ where: { id }, data });

    await this.markSiteChanged(fellowshipId);
    await this.auditService.log({
      userId: user?.userId,
      action: data.is_published === true ? 'public_site.post_publish' : data.is_published === false ? 'public_site.post_unpublish' : 'public_site.post_update',
      entityType: 'public_post',
      entityId: id,
      fellowshipId,
      newValue: { ...data, title: post.title },
      comment: `${post.kind} updated`,
    });

    return post;
  }

  /**
   * Removes an item. Soft rather than hard: a published item that gets deleted by mistake should be recoverable,
   * and the recycle bin already carries the audit trail for hard deletes.
   */
  async deletePost(user: RequesterLike | undefined, id: string, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);

    const existing = await this.prisma.publicPost.findUnique({
      where: { id },
      select: { fellowship_id: true, title: true, kind: true, is_published: true },
    });
    if (!existing) throw new NotFoundException('Item not found');
    this.tenantScope.assertInScope(user, existing, queryFellowshipId);

    // Unpublish and keep the row. Deleting something that is currently on the public site would leave a
    // published link dead, which is worse than an unpublished item sitting in the editor.
    const post = await this.prisma.publicPost.update({
      where: { id },
      data: { is_published: false },
    });

    await this.markSiteChanged(fellowshipId);
    await this.auditService.log({
      userId: user?.userId,
      action: 'public_site.post_remove',
      entityType: 'public_post',
      entityId: id,
      fellowshipId,
      oldValue: { title: existing.title, kind: existing.kind, isPublished: existing.is_published },
      comment: `${existing.kind} removed from the public site`,
    });

    return post;
  }

  // ---------------------------------------------------------------- enquiries

  /**
   * Everything visitors have sent. The message body and contact details are the point of this screen, so unlike
   * every other read in the public module they are selected in full â€” but only ever inside the caller's own
   * fellowship, and only for a signed-in member of staff.
   */
  async listEnquiries(
    user: RequesterLike | undefined,
    q: { kind?: string; isHandled?: string } = {},
    queryFellowshipId?: string,
  ) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);

    const where: Record<string, any> = { fellowship_id: fellowshipId };
    if (q.kind) where.kind = parseEnquiryKind(q.kind);
    if (q.isHandled !== undefined) where.is_handled = q.isHandled === 'true';

    const [data, total] = await Promise.all([
      this.prisma.publicEnquiry.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: 200,
        select: {
          id: true, kind: true, name: true, email: true, phone: true, message: true,
          amount: true, currency: true, is_handled: true,
          handled_at: true, created_at: true,
        },
      }),
      this.prisma.publicEnquiry.count({ where }),
    ]);

    return { data, total };
  }

  async markEnquiryHandled(user: RequesterLike | undefined, id: string, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    if (!user?.userId) throw new BadRequestException('A signed-in account is required');

    const existing = await this.prisma.publicEnquiry.findUnique({
      where: { id },
      select: { fellowship_id: true, is_handled: true },
    });
    if (!existing) throw new NotFoundException('Message not found');
    this.tenantScope.assertInScope(user, existing, queryFellowshipId);

    const enquiry = await this.prisma.publicEnquiry.update({
      where: { id },
      data: { is_handled: true, handled_by: user.userId, handled_at: new Date() },
    });

    await this.auditService.log({
      userId: user.userId,
      action: 'public_site.enquiry_handled',
      entityType: 'public_enquiry',
      entityId: id,
      fellowshipId,
      newValue: { kind: enquiry.kind },
      comment: 'Public message marked as handled',
    });

    return enquiry;
  }
}

// ---------------------------------------------------------------- helpers

function parsePostKind(value: unknown): 'sermon' | 'testimony' | 'project' {
  if (value === 'sermon' || value === 'testimony' || value === 'project') return value;
  throw new BadRequestException('kind must be one of: sermon, testimony, project');
}

function parseEnquiryKind(value: string): 'prayer_request' | 'contact_message' | 'donation_pledge' {
  if (value === 'prayer_request' || value === 'contact_message' || value === 'donation_pledge') return value;
  throw new BadRequestException('kind must be one of: prayer_request, contact_message, donation_pledge');
}

function parseOptionalDate(field: string, value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new BadRequestException(`${field} must be a date`);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return d;
}

function parseSortOrder(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-9999, Math.min(9999, Math.trunc(n)));
}

function validateEmail(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new BadRequestException('email is not a valid address');
  return value;
}

/**
 * Only absolute http(s) URLs are accepted for an image or link. Without this a content manager could store
 * `javascript:alert(1)` and it would be rendered into an href or an img src on a page anyone can load.
 */
function validateHttpUrl(value: string | null): string | null {
  if (value === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException('must be a full http:// or https:// address');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('only http:// and https:// addresses are allowed');
  }
  return value;
}
