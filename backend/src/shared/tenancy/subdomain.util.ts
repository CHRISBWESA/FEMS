/**
 * Fellowship subdomains.
 *
 * Every fellowship will be reachable at `<subdomain>.<base domain>` once the public sites are built, so the
 * subdomain is derived from the fellowship name in exactly one place and reused by onboarding (to mint the
 * default role e-mail addresses), by the public host resolver, and by the admin UI.
 *
 * The subdomain is a DNS label, so the character set is deliberately narrow: lowercase ASCII letters, digits and
 * single hyphens, no leading or trailing hyphen, never longer than 63 characters (the DNS limit). Anything else is
 * folded away rather than rejected, because these labels are generated for the operator, who can always correct
 * one afterwards.
 */

/** `FEMS_BASE_DOMAIN` is the apex the public sites are served from. */
export function baseDomain(): string {
  const configured = (process.env.FEMS_BASE_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  // `example.com` is reserved by RFC 2606 and can never receive mail. It is the default so that a fresh install
  // mints unreachable placeholder addresses rather than accidentally sending anything to a real domain.
  return configured || 'example.com';
}

const MAX_LABEL = 63;

/** Folds arbitrary text into a DNS-safe subdomain label. Returns `''` if nothing usable survives. */
export function slugify(value: string): string {
  const folded = value
    .normalize('NFKD')
    // Strip combining marks so "Caf\u00e9" becomes "cafe" rather than losing the letters entirely.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LABEL)
    .replace(/-+$/g, '');
  return folded;
}

/** Reserved subdomains that must never be handed to a fellowship, because the platform itself uses them. */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'auth', 'mail', 'smtp', 'imap', 'pop', 'cdn', 'assets', 'static',
  'docs', 'status', 'support', 'help', 'blog', 'shop', 'billing', 'pay', 'test', 'staging', 'dev', 'localhost',
]);

/**
 * Picks a free subdomain for a fellowship. `taken` must report which labels are already in use; it is a function
 * so the caller can reuse its own Prisma query rather than this module taking a database dependency.
 */
export function suggestSubdomain(
  name: string,
  taken: (candidate: string) => Promise<boolean> | boolean,
): Promise<string> {
  const base = slugify(name);
  if (!base) throw new Error('The fellowship name does not contain any letters or digits to form a subdomain.');
  return (async () => {
    if (!RESERVED_SUBDOMAINS.has(base) && !(await taken(base))) return base;
    // Two fellowships can easily normalise to the same label ("St. Mary's" and "Saint Marys"), so fall back to a
    // short random suffix rather than rejecting the second one.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const suffix = Math.random().toString(36).slice(2, 6);
      const candidate = `${base.slice(0, MAX_LABEL - suffix.length - 1)}-${suffix}`;
      if (RESERVED_SUBDOMAINS.has(candidate)) continue;
      if (!(await taken(candidate))) return candidate;
    }
    throw new Error('Could not derive a free subdomain. Set one explicitly.');
  })();
}

/** The full public host for a fellowship, e.g. `casfeta.example.com`. */
export function fellowshipHost(subdomain: string): string {
  return `${slugify(subdomain)}.${baseDomain()}`;
}

/** The default placeholder address for a role, e.g. `treasurer@casfeta.example.com`. Unique per fellowship. */
export function defaultRoleEmail(subdomain: string, roleSlug: string): string {
  return `${roleSlug}@${fellowshipHost(subdomain)}`;
}
