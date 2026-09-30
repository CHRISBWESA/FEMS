import { baseDomain, fellowshipHost } from '../shared/tenancy/subdomain.util';

/**
 * Search-engine surfaces for the public sites.
 *
 * A landing page exists to be found, so it needs a sitemap and a robots file. Both are generated here rather than
 * served as static files, because the set of URLs is data: a fellowship's pages come from the catalogue and a page
 * the fellowship has hidden must not appear in its sitemap.
 *
 * Everything is escaped on the way out. The inputs are a fellowship name and page copy that a content manager typed,
 * and an unescaped `&` in a name is enough to produce a document a parser reads differently from what was intended.
 */

/** XML text escape. `&` first, because escaping the others introduces it. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SitemapEntry {
  loc: string;
  changefreq: string;
  priority: string;
  lastmod?: Date;
}

/**
 * A sitemap document.
 *
 * `changefreq` and `priority` are static per page kind rather than invented per page: a landing page changes often,
 * a list of sermons changes when the preacher says so. Claiming otherwise would be telling a crawler something the
 * code has no way to know.
 */
export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}` +
        `\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** The platform's own robots file. The app is closed; the marketing site is open. */
export function platformRobots(): string {
  return [
    'User-agent: *',
    // The signed-in application is never useful in a search result, and indexing it invites credential-shaped
    // URLs into a search engine's cache.
    'Disallow: /dashboard',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /attendance/',
    'Disallow: /f/',
    'Allow: /site',
    `Sitemap: https://${baseDomain()}/site/sitemap.xml`,
    '',
  ].join('\n');
}

/** A published fellowship's robots file. Everything is welcome: the whole point is to be found. */
export function fellowshipRobots(subdomain: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    // The inbox is not a page; a crawler has no business reading a fellowship's private messages, and the route
    // would 401 it anyway.
    'Disallow: /it-content',
    `Sitemap: https://${fellowshipHost(subdomain)}/sitemap.xml`,
    '',
  ].join('\n');
}
