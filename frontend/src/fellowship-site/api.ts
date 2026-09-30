import { useCallback, useEffect, useState } from 'react';

/**
 * The data layer for a fellowship's public site.
 *
 * Every read is unauthenticated and every URL carries the subdomain, so nothing on this page can accidentally show
 * one fellowship's content to a visitor who came for another. The two shapes returned here mirror what
 * `public-site.service.ts` selects on the server, which is deliberately a narrow projection — a leadership entry has
 * a name and an office and nothing else, because that is all the server will hand out.
 */

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

export interface PublicPage {
  key: string;
  path: string;
  label: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  isVisible: boolean;
}

export interface PublicProfile {
  tagline: string | null;
  story: string | null;
  mission: string | null;
  vision: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  service_times: string | null;
  facebook_url: string | null;
  youtube_url: string | null;
  whatsapp_url: string | null;
}

export interface FellowshipSite {
  fellowship: { name: string; subdomain: string; host: string; location: string | null };
  profile: PublicProfile | null;
  pages: PublicPage[];
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    // A 404 here means the site does not exist or is not published. Both are the same thing to a visitor, and the
    // message is the same for each, so this surfaces one error rather than probing.
    throw new Error(res.status === 404 ? 'not-found' : `request-failed-${res.status}`);
  }
  return res.json();
}

/** Loads the site's identity and page copy. Every list below hangs off the same subdomain. */
export function useFellowshipSite(subdomain: string | undefined) {
  const [site, setSite] = useState<FellowshipSite | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subdomain) return;
    let cancelled = false;
    setSite(null);
    setError(null);
    get<FellowshipSite>(`${BASE}/public/fellowships/${encodeURIComponent(subdomain)}`)
      .then((d) => {
        if (!cancelled) setSite(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subdomain]);

  return { site, error };
}

export interface ListState<T> {
  data: T | null;
  loading: boolean;
  failed: boolean;
  /** Re-fetches the list. Exposed so a page can refresh after an action without remounting. */
  reload: () => void;
}

/**
 * Fetches one list for the current page.
 *
 * `path` is the segment after the subdomain (`departments`, `sermons`, ...). The guard on `subdomain` matters: a
 * render can happen before the route param is known, and a request to `/public/fellowships/undefined` would come
 * back as a confusing 404 instead of "loading".
 */
export function useFellowshipList<T>(subdomain: string | undefined, path: string): ListState<T> {
  const [state, setState] = useState<Omit<ListState<T>, 'reload'>>({ data: null, loading: true, failed: false });

  const reload = useCallback(() => {
    if (!subdomain) return;
    setState({ data: null, loading: true, failed: false });
    get<T>(`${BASE}/public/fellowships/${encodeURIComponent(subdomain)}/${path}`)
      .then((d) => setState({ data: d, loading: false, failed: false }))
      .catch(() => setState({ data: null, loading: false, failed: true }));
  }, [subdomain, path]);

  useEffect(reload, [reload]);

  return { ...state, reload };}

/** Posts one of the three public forms and reports what the server said. */
export async function submitEnquiry(
  subdomain: string,
  kind: 'prayer-requests' | 'contact' | 'donations',
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${BASE}/public/fellowships/${encodeURIComponent(subdomain)}/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as any)?.message;
    throw new Error(Array.isArray(message) ? message.join(' ') : message || 'Could not send. Please try again.');
  }
  return (data as any)?.message || 'Received.';
}
