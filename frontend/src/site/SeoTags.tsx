import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The metadata a link-preview and a search engine read, applied by writing the document head.
 *
 * A small component rather than a library: this is the only page in the application that needs Open Graph tags,
 * and pulling in a helmet would add a dependency and a rendering model to three pages' worth of need.
 *
 * The tags are written directly to `document.head` rather than through React, because they must survive a
 * client-side navigation (a visitor clicking from the events page to the about page should get the about page's
 * description, not the first page they landed on).
 */
export default function SeoTags({
  title,
  description,
  url,
  image,
  type = 'website',
  noIndex = false,
}: {
  title: string;
  description: string;
  url: string;
  /** Absolute URL. Omitted entirely when absent - see the note in the call site. */
  image?: string | null;
  type?: string;
  /** Set for a page that must not be indexed. */
  noIndex?: boolean;
}) {
  const location = useLocation();

  useEffect(() => {
    // `undefined` removes a tag that a previous page set, so nothing stale is left behind.
    const set = (selector: string, attr: 'name' | 'property', key: string, content: string | undefined) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!content) {
        el?.remove();
        return;
      }
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    document.title = title;

    set('meta[name="description"]', 'name', 'description', description);

    // Open Graph: what Facebook, WhatsApp and Slack show when the link is pasted.
    set('meta[property="og:title"]', 'property', 'og:title', title);
    set('meta[property="og:description"]', 'property', 'og:description', description);
    set('meta[property="og:url"]', 'property', 'og:url', url);
    set('meta[property="og:type"]', 'property', 'og:type', type);
    set('meta[property="og:site_name"]', 'property', 'og:site_name', title.split('|').pop()?.trim());
    set('meta[property="og:image"]', 'property', 'og:image', image ?? undefined);

    // Twitter/X reads its own tags, and falls back to Open Graph when they are absent; being explicit is cheaper
    // than relying on that.
    set('meta[name="twitter:card"]', 'name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    set('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    set('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    set('meta[name="twitter:image"]', 'name', 'twitter:image', image ?? undefined);

    // The canonical URL, so two addresses for the same page (with and without a trailing slash) do not compete.
    set('link[rel="canonical"]', 'name', '', undefined);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;

    set('meta[name="robots"]', 'name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow');
  }, [title, description, url, image, type, noIndex, location.pathname]);

  return null;
}
