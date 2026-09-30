import type { PublicPageKey } from '@prisma/client';

/**
 * The fellowship landing page, as a single catalogue.
 *
 * The sixteen pages a fellowship's public site is made of are declared once here and used by the API (to seed the
 * default `public_pages` rows and to answer "which pages exist"), by the public renderer (to build the navigation)
 * and by the content manager (to build the edit form). Adding a seventeenth page therefore means adding one entry,
 * not editing five files.
 *
 * `nav` only affects ordering and grouping. Every page is reachable at its `path` whether or not it is in the
 * navigation, so a link that already exists never breaks when a fellowship tidies its menu.
 */
export type PublicPageNav = 'main' | 'more' | 'connect';

export interface PublicPageMeta {
  key: PublicPageKey;
  path: string;
  label: string;
  nav: PublicPageNav;
  /** Used as the default heading, and shown in the content manager when nothing has been written yet. */
  title: string;
  blurb: string;
}

export const PUBLIC_PAGES: PublicPageMeta[] = [
  {
    key: 'home',
    path: '/',
    label: 'Home',
    nav: 'main',
    title: 'Welcome',
    blurb: 'The first thing a visitor reads, and the summary of who this fellowship is.',
  },
  {
    key: 'about',
    path: '/about',
    label: 'About Us',
    nav: 'main',
    title: 'About Us',
    blurb: 'The fellowship’s story, mission and vision.',
  },
  {
    key: 'departments',
    path: '/departments',
    label: 'Departments',
    nav: 'main',
    title: 'Departments',
    blurb: 'The working groups of the fellowship. Managed by the Secretary.',
  },
  {
    key: 'ministries',
    path: '/ministries',
    label: 'Ministries & Programs',
    nav: 'main',
    title: 'Ministries & Programs',
    blurb: 'The ministries and programmes the fellowship runs.',
  },
  {
    key: 'events',
    path: '/events',
    label: 'Events',
    nav: 'main',
    title: 'Events',
    blurb: 'What is coming up, taken from the fellowship’s activity calendar.',
  },
  {
    key: 'news',
    path: '/news',
    label: 'News & Announcements',
    nav: 'main',
    title: 'News & Announcements',
    blurb: 'Announcements that have been approved for publication.',
  },
  {
    key: 'leadership',
    path: '/leadership',
    label: 'Leadership',
    nav: 'more',
    title: 'Our Leadership',
    blurb: 'Who holds office. Names and offices only — never contact details.',
  },
  {
    key: 'publications',
    path: '/publications',
    label: 'Publications',
    nav: 'more',
    title: 'Publications',
    blurb: 'Documents the fellowship has marked as website content.',
  },
  {
    key: 'gallery',
    path: '/gallery',
    label: 'Gallery',
    nav: 'more',
    title: 'Gallery',
    blurb: 'Photographs of the fellowship’s life and work.',
  },
  {
    key: 'sermons',
    path: '/sermons',
    label: 'Sermons & Teachings',
    nav: 'more',
    title: 'Sermons & Teachings',
    blurb: 'Preached messages and Bible teachings.',
  },
  {
    key: 'testimonies',
    path: '/testimonies',
    label: 'Testimonials',
    nav: 'more',
    title: 'Testimonials',
    blurb: 'What members and visitors have said.',
  },
  {
    key: 'projects',
    path: '/projects',
    label: 'Projects & Activities',
    nav: 'more',
    title: 'Projects & Activities',
    blurb: 'Outreach, community work and ongoing projects.',
  },
  {
    key: 'get_involved',
    path: '/get-involved',
    label: 'Get Involved',
    nav: 'connect',
    title: 'Get Involved',
    blurb: 'Open ways to serve. Taken from open service opportunities.',
  },
  {
    key: 'prayer',
    path: '/prayer-request',
    label: 'Prayer Request',
    nav: 'connect',
    title: 'Prayer Request',
    blurb: 'Send a request to the fellowship. No account needed.',
  },
  {
    key: 'give',
    path: '/give',
    label: 'Give / Donations',
    nav: 'connect',
    title: 'Give / Donations',
    blurb: 'How to give, and open contribution campaigns.',
  },
  {
    key: 'contact',
    path: '/contact',
    label: 'Contact Us',
    nav: 'connect',
    title: 'Contact Us',
    blurb: 'Address, phone, e-mail and service times.',
  },
];

export const PUBLIC_PAGE_KEYS: PublicPageKey[] = PUBLIC_PAGES.map((p) => p.key);

/** Approval states that may appear on a public site. DRAFT and anything rejected must never. */
export const PUBLICLY_PUBLISHED_APPROVAL_STATUSES = ['APPROVED', 'FINAL_APPROVED'] as const;

/** The offices shown on the public "Leadership" page, in the order they are listed. */
export const PUBLIC_LEADERSHIP_ROLES = [
  'chairperson',
  'assistant_chairperson',
  'secretary',
  'assistant_secretary',
  'treasurer',
] as const;

export function isPublicPageKey(value: string): value is PublicPageKey {
  return (PUBLIC_PAGE_KEYS as string[]).includes(value);
}
