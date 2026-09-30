// Optional modules a platform administrator can switch on or off per fellowship. Core features (members,
// departments, activities, approvals, users, notifications) are always available and are not listed.
export const MODULE_KEYS = ['finance', 'youth', 'resources', 'volunteers', 'analytics', 'member_engagement'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  finance: 'Finance & contributions',
  youth: 'Youth & children',
  resources: 'Resources & assets',
  volunteers: 'Volunteers & service',
  analytics: 'Analytics',
  member_engagement: 'Member engagement (profiles, groups, insights)',
};

export const isModuleKey = (v: unknown): v is ModuleKey => typeof v === 'string' && (MODULE_KEYS as readonly string[]).includes(v);
