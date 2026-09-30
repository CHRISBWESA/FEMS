/**
 * Copy for the platform's own public site.
 *
 * This is copy, not data, so it lives here rather than in the database. The two exceptions are called out where they
 * appear: the plan list on Pricing is read from the database, and the counters on Home come from
 * `/public/site/stats`. Nothing here is a placeholder standing in for a feature that does not exist — every feature
 * named in the copy is one the application actually has.
 */

export interface SiteNavItem {
  label: string;
  to: string;
}

/**
 * The eight pages, with the description a link preview shows.
 *
 * Declared here rather than in each page component, so the metadata and the navigation cannot drift apart and a
 * page cannot end up sharing a link preview with its neighbour.
 */
export const PLATFORM_PAGES: { path: string; title: string; description: string }[] = [
  {
    path: '/site',
    title: 'Fellowship Manager',
    description: 'Administration for fellowships: members, departments, activities, finance, youth and resources, with each fellowship kept to its own data.',
  },
  {
    path: '/site/about',
    title: 'About',
    description: 'One system, many fellowships, no shared data. A fellowship is a tenant, and that is what everything else is built on.',
  },
  {
    path: '/site/features',
    title: 'Features',
    description: 'Members, departments, activities, finance, youth, resources, volunteering, approvals, audit and a public site for every fellowship.',
  },
  {
    path: '/site/solutions',
    title: 'Solutions',
    description: 'Built for a small fellowship fixing its records, a growing set of congregations, and one going public.',
  },
  {
    path: '/site/pricing',
    title: 'Pricing',
    description: 'Plans for fellowships of every size. No online payment: an administrator arranges billing with you directly.',
  },
  {
    path: '/site/resources',
    title: 'Resources',
    description: 'How the system works: getting started, the account procedure, roles, running your public site, data and backups, and security.',
  },
  {
    path: '/site/faq',
    title: 'Frequently asked questions',
    description: 'How fellowships get access, who manages accounts, what a platform administrator can see, and what there is no payment gateway.',
  },
  {
    path: '/site/contact',
    title: 'Contact',
    description: 'Ask for access, or write to us with a question.',
  },
];

/** The eight pages of the platform site, in the order the header shows them. */
export const PLATFORM_NAV: SiteNavItem[] = [
  { label: 'Home', to: '/site' },
  { label: 'About', to: '/site/about' },
  { label: 'Features', to: '/site/features' },
  { label: 'Solutions', to: '/site/solutions' },
  { label: 'Pricing', to: '/site/pricing' },
  { label: 'Resources', to: '/site/resources' },
  { label: 'FAQ', to: '/site/faq' },
  { label: 'Contact', to: '/site/contact' },
];

export const HERO = {
  eyebrow: 'Fellowship Management System',
  title: 'Run your fellowship’s administration in one place.',
  body:
    'Members, departments, activities, finance, youth and resources — with every fellowship kept strictly to its own data, and a public site for each one.',
  primaryCta: { label: 'Get Started', to: '/register' },
  secondaryCta: { label: 'Sign In', to: '/login' },
};

export interface FeatureItem {
  title: string;
  body: string;
  icon: string;
}

/** Named after modules that exist in the application, not after aspirations. */
export const FEATURES: FeatureItem[] = [
  {
    title: 'Members',
    body: 'A full member register with membership status, profiles, groups and history, kept per fellowship.',
    icon: 'users',
  },
  {
    title: 'Departments & programmes',
    body: 'Departments belong to the fellowship, not the platform, so two congregations can each have their own Choir.',
    icon: 'grid',
  },
  {
    title: 'Activities & attendance',
    body: 'Plan activities, record attendance online or offline, and publish an attendance link for visitors.',
    icon: 'calendar',
  },
  {
    title: 'Finance',
    body: 'Contributions, expenses, budgets, pledges and money requests, with approval steps and closed periods.',
    icon: 'banknotes',
  },
  {
    title: 'Youth & children',
    body: 'Age groups, guardian records, attendance and safeguarding reports.',
    icon: 'academic',
  },
  {
    title: 'Resources & assets',
    body: 'An asset register with loans, maintenance, documents and assignment to members.',
    icon: 'cube',
  },
  {
    title: 'Volunteering',
    body: 'Service opportunities, shifts and sign-ups, so serving can be organised without a spreadsheet.',
    icon: 'hand',
  },
  {
    title: 'Public site',
    body: 'Each fellowship gets its own subdomain with its own landing page, which its content manager runs.',
    icon: 'globe',
  },
  {
    title: 'Approvals & audit',
    body: 'Submitted content is approved before it is published, and every administrative change is logged.',
    icon: 'shield',
  },
  {
    title: 'Backups',
    body: 'Scheduled and manual backups, with a recorded restore path.',
    icon: 'archive',
  },
  {
    title: 'Reports',
    body: 'Membership, finance, youth and activity reporting, scoped to the fellowship that asked for it.',
    icon: 'chart',
  },
  {
    title: 'Notifications',
    body: 'In-app notifications for approvals, assignments and activity changes.',
    icon: 'bell',
  },
];

export interface SolutionItem {
  audience: string;
  title: string;
  body: string;
  points: string[];
}

export const SOLUTIONS: SolutionItem[] = [
  {
    audience: 'For a growing fellowship',
    title: 'One record instead of five notebooks',
    body:
      'When a fellowship outgrows paper, the usual outcome is a membership book, a finance book and a WhatsApp group that only three people can read. This replaces all of it with one register that every office writes to.',
    points: [
      'Members registered once and visible to the offices that need them',
      'Finance recorded against the person and the department it belongs to',
      'Attendance that works even when the venue has no signal',
    ],
  },
  {
    audience: 'For several fellowships',
    title: 'Separate by default, not by convention',
    body:
      'Each fellowship is a tenant. A secretary sees their own fellowship and cannot read another’s members, finance or reports — that boundary is enforced on the server, not by a setting somebody remembers to tick.',
    points: [
      'Every request is scoped by the fellowship on the signed-in account',
      'Platform staff reach a tenant only through a recorded, expiring support grant',
      'A platform administrator can act as a person, and every such session is logged',
    ],
  },
  {
    audience: 'For a fellowship going public',
    title: 'A site that the fellowship runs itself',
    body:
      'Every fellowship gets a subdomain and a landing page with its own pages for departments, ministries, events, news, sermons and giving. The content manager maintains it without touching members or finance.',
    points: [
      'Nothing is published until it is explicitly approved and switched on',
      'Prayer requests and contact messages arrive in the fellowship’s own inbox',
      'A giving page lists real campaigns and real progress — there is no payment gateway claim',
    ],
  },
];

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQS: FaqItem[] = [
  {
    question: 'How does a fellowship get access?',
    answer:
      'Somebody fills in the request form with the fellowship’s details and an e-mail address. Nothing is created and nothing is granted at that point. A platform administrator reviews it and, on approval, the fellowship is created and its first accounts are issued. The applicant becomes the Secretary.',
  },
  {
    question: 'Do I need a company e-mail address?',
    answer:
      'It is strongly advised, because the account belongs to the fellowship rather than to you. The form warns you when the address looks like a personal mailbox, and the administrator can correct it at approval time. It is not refused — plenty of fellowships genuinely have no domain yet.',
  },
  {
    question: 'Who manages the accounts inside a fellowship?',
    answer:
      'The Secretary. They create and manage the accounts for their own fellowship’s roles, reset passwords and correct e-mail addresses. The platform administrator does not hand out a fellowship’s job titles.',
  },
  {
    question: 'Can the platform administrator see my fellowship’s data?',
    answer:
      'Not by default. A platform administrator runs the platform — tenants, plans, backups — and holds no permission over a fellowship’s members, finance or reports. Where an administrator genuinely needs to help, they act as a named person through an impersonation session that is recorded, scoped and time-limited.',
  },
  {
    question: 'What does “IT” mean here?',
    answer:
      'It is the fellowship’s content manager. That role exists to run the fellowship’s public landing page and nothing else — it cannot see members, finance or accounts. Whoever also administers the fellowship is a Secretary as well; the two roles are complementary.',
  },
  {
    question: 'Is there a payment gateway?',
    answer:
      'No. There is no card or mobile-money integration, and the system does not pretend otherwise. The giving page lists campaigns and the progress recorded against them, and a “give” button records an intention to give that a person then acts on. Taking money is not automated.',
  },
  {
    question: 'What happens to my data if I leave?',
    answer:
      'Your fellowship keeps it. Records are deleted only by a deliberate, audited action, and a fellowship is suspended rather than erased while it still has people attached to it. A recycle bin holds recoverable deletions.',
  },
  {
    question: 'Can I try it first?',
    answer:
      'Some plans include a trial period, which is shown on the pricing page with the number of days. A trial is set up by the administrator when your request is approved.',
  },
];

export interface ResourceItem {
  title: string;
  body: string;
}

export const RESOURCES: ResourceItem[] = [
  {
    title: 'Getting started',
    body: 'What happens between requesting access and being able to sign in, in order.',
  },
  {
    title: 'The account procedure',
    body: 'How accounts and roles are created inside a fellowship, and who may change them.',
  },
  {
    title: 'Roles and permissions',
    body: 'What each office can and cannot do, and why the content manager is deliberately separate.',
  },
  {
    title: 'Running your public site',
    body: 'Turning on the site, writing the pages, and publishing announcements and sermons.',
  },
  {
    title: 'Data and backups',
    body: 'Where records live, how they are scoped, and how a backup is restored.',
  },
  {
    title: 'Security',
    body: 'Authentication, password handling, session limits and what is written to the audit log.',
  },
];
