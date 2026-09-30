import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../shared/decorators/public.decorator';
import { PUBLIC_THROTTLE } from '../shared/throttle';
import { contentDisposition, SAFE_DOWNLOAD_TYPE } from '../shared/utils/file-storage.util';
import { platformRobots } from './public-site.seo';
import { PublicSiteService } from './public-site.service';

/**
 * Everything on a fellowship's public site, reachable without an account.
 *
 * The whole controller is unauthenticated by design, so it is also the most exposed surface in the system. Three
 * things keep that safe, and all three are enforced in the service rather than trusted to this file:
 *   - a fellowship only resolves once it has switched `public_site_enabled` on and is not suspended;
 *   - every list is read through a published-only filter;
 *   - the projections name their columns, so no account detail can leak in through a later schema change.
 *
 * Reads and writes are throttled separately. The write routes are the ones an attacker scripts against, so they
 * carry the tighter public budget; the reads are a landing page and are allowed to be a little more generous.
 */
@Controller('public/fellowships')
export class PublicSiteController {
  constructor(private readonly publicSite: PublicSiteService) {}

  // ---------------------------------------------------------------- identity

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain')
  site(@Param('subdomain') subdomain: string) {
    return this.publicSite.site(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/pages/:key')
  page(@Param('subdomain') subdomain: string, @Param('key') key: string) {
    return this.publicSite.pageCopy(subdomain, key);
  }

  // ---------------------------------------------------------------- lists

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/leadership')
  leadership(@Param('subdomain') subdomain: string) {
    return this.publicSite.leadership(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/departments')
  departments(@Param('subdomain') subdomain: string) {
    return this.publicSite.departments(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/ministries')
  ministries(@Param('subdomain') subdomain: string) {
    return this.publicSite.ministries(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/events')
  events(@Param('subdomain') subdomain: string) {
    return this.publicSite.events(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/news')
  news(@Param('subdomain') subdomain: string) {
    return this.publicSite.news(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/publications')
  publications(@Param('subdomain') subdomain: string) {
    return this.publicSite.publications(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/gallery')
  gallery(@Param('subdomain') subdomain: string) {
    return this.publicSite.gallery(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/gallery/photos')
  galleryPhotos(@Param('subdomain') subdomain: string) {
    return this.publicSite.galleryPhotos(subdomain);
  }

  /**
   * The bytes of an approved website document.
   *
   * Public, because a publication on a public page has to be fetchable by the reader - but only ever an APPROVED,
   * website-flagged document belonging to the fellowship in the URL. Images are served with their real type so a
   * gallery thumbnail renders; anything else is served as an opaque download with a Content-Disposition, so a file
   * the uploader mislabelled is never interpreted as markup by the visitor's browser.
   */
  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/documents/:id')
  async document(@Param('subdomain') subdomain: string, @Param('id') id: string, @Res() res: Response) {
    const { bytes, filename, mimeType } = await this.publicSite.publicDocument(subdomain, id);

    const isImage = mimeType.startsWith('image/');
    // A FULL @Res(), not `@Res({ passthrough: true })`. With passthrough, returning the Buffer hands it to Nest's
    // serialiser, which JSON-encodes it into `{"type":"Buffer","data":[...]}` - so the download was a file that
    // looked like a Buffer. The response is finished here instead.
    res.setHeader('Content-Type', isImage ? mimeType : SAFE_DOWNLOAD_TYPE);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', contentDisposition(filename));
    // Belt and braces with the download type: a file served as an image must not be sniffable into something else.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A published document is a static artefact; it may be cached, but only for a short while, so a fellowship
    // withdrawing one takes effect rather than lingering in a visitor's browser cache indefinitely.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(bytes);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/sermons')
  sermons(@Param('subdomain') subdomain: string) {
    return this.publicSite.sermons(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/testimonies')
  testimonies(@Param('subdomain') subdomain: string) {
    return this.publicSite.testimonies(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/projects')
  projects(@Param('subdomain') subdomain: string) {
    return this.publicSite.projects(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/get-involved')
  getInvolved(@Param('subdomain') subdomain: string) {
    return this.publicSite.getInvolved(subdomain);
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/giving')
  giving(@Param('subdomain') subdomain: string) {
    return this.publicSite.giving(subdomain);
  }

  // ---------------------------------------------------------------- machine-readable

  /**
   * The published site as XML, for a search engine.
   *
   * Public and unauthenticated, like every other read here, and it carries only what the pages themselves show:
   * a fellowship's own name, the pages it has made visible, and their addresses. An unpublished fellowship is not in
   * this document at all, and a hidden page is not listed, so a sitemap can never reveal a site that is not
   * intended to be found.
   */
  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/sitemap.xml')
  async sitemap(@Param('subdomain') subdomain: string, @Res() res: Response) {
    const xml = await this.publicSite.sitemap(subdomain);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // `res.send`, not `return`: a full @Res() takes the response out of Nest's hands, so a returned value is
    // dropped and the request hangs until the client times out.
    res.send(xml);
  }

  /** Whether this fellowship is published, for a crawler that would rather ask than fetch. */
  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get(':subdomain/robots.txt')
  robots(@Param('subdomain') subdomain: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(this.publicSite.robots(subdomain));
  }

  // The platform's own apex robots.txt is NOT here. This controller is prefixed `public/fellowships`, so a
  // `@Get('site/robots.txt')` on it resolves to `/public/fellowships/site/robots.txt` - the subdomain literally
  // being "site", which is a 404. It lives on PlatformSiteController, which owns the `public/site` prefix.

  // ---------------------------------------------------------------- writes
  //
  // These are the only unauthenticated writes on a fellowship's site, so they get their own budget rather than
  // sharing the read allowance with page views. Two layers, because one is not enough:
  //
  //   - The route limit is small (3/minute) so a single script cannot fill an inbox.
  //   - A SLOWER absolute cap per fellowship (PRAYER_ENQUIRY_CAP, 30/hour) sits underneath, because a botnet's
  //     addresses are all different and the per-IP limit is invisible to it. This one is per fellowship, so it
  //     cannot be evaded by rotating source addresses.
  //
  // 429 rather than 403 on the cap: the request really was refused for volume, and saying so is more honest than
  // pretending the form does not exist.

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post(':subdomain/prayer-requests')
  prayerRequest(@Param('subdomain') subdomain: string, @Body() body: any, @Req() req) {
    return this.publicSite.submitEnquiry('prayer_request', { ...body, subdomain }, clientIp(req));
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post(':subdomain/contact')
  contact(@Param('subdomain') subdomain: string, @Body() body: any, @Req() req) {
    return this.publicSite.submitEnquiry('contact_message', { ...body, subdomain }, clientIp(req));
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post(':subdomain/donations')
  donation(@Param('subdomain') subdomain: string, @Body() body: any, @Req() req) {
    return this.publicSite.submitEnquiry('donation_pledge', { ...body, subdomain }, clientIp(req));
  }
}

/** The connecting socket's address, for abuse handling. `trust proxy` is what makes this the real client IP. */
function clientIp(req: any): string | undefined {
  const ip = req?.ip ?? req?.socket?.remoteAddress;
  return typeof ip === 'string' ? ip : undefined;
}
