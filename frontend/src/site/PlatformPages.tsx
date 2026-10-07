import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UsersIcon, Squares2X2Icon, CalendarDaysIcon, BanknotesIcon, AcademicCapIcon, CubeIcon,
  HandRaisedIcon, GlobeAltIcon, ShieldCheckIcon, ArchiveBoxIcon, ChartBarIcon, BellIcon,
} from '@heroicons/react/24/outline';
import { HERO, FEATURES, SOLUTIONS, FAQS, RESOURCES } from './site-copy';
import { Card, StatCard, StatGrid } from '../components/ui';

type IconComponent = typeof UsersIcon;

const ICONS: Record<string, IconComponent> = {
  users: UsersIcon,
  grid: Squares2X2Icon,
  calendar: CalendarDaysIcon,
  banknotes: BanknotesIcon,
  academic: AcademicCapIcon,
  cube: CubeIcon,
  hand: HandRaisedIcon,
  globe: GlobeAltIcon,
  shield: ShieldCheckIcon,
  archive: ArchiveBoxIcon,
  chart: ChartBarIcon,
  bell: BellIcon,
};

/** The shared page furniture, so every marketing page sits on the same grid. */
export function Section({
  children,
  className = '',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`section py-16 sm:py-20 ${className}`}>
      {children}
    </section>
  );
}

export function SectionHeading({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-base leading-relaxed text-ink-muted">{body}</p>}
    </div>
  );
}

/**
 * The real platform counters, from `/public/site/stats`.
 *
 * These are counts, not a claim: they are read from the database at request time. If the API is unreachable the
 * block is simply not rendered, because a marketing page that shows a hardcoded "500+ fellowships" is worse than
 * one that shows nothing.
 */
export function LiveStats() {
  const [stats, setStats] = useState<{ fellowships: number; publishedSites: number; members: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'}/public/site/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.fellowships === 'number') setStats(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats) return null;

  const tiles = [
    { label: 'Fellowships on the platform', value: stats.fellowships },
    { label: 'Public sites published', value: stats.publishedSites },
    { label: 'Members recorded', value: stats.members },
  ];

  return (
    <Section>
      <StatGrid>
        {tiles.map((t) => (
          <StatCard key={t.label} value={t.value.toLocaleString()} label={t.label} />
        ))}
      </StatGrid>
    </Section>
  );
}

export function CtaBanner() {
  return (
    <Section>
      <div className="flex flex-col items-start gap-8 rounded-card bg-primary p-8 sm:p-12 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Ready to get your fellowship set up?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/75">
            Request access and an administrator will review it. Nothing is created until they approve it.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link to="/login" className="btn btn-secondary">
            Sign in
          </Link>
          <Link to="/register" className="btn btn-lg bg-white text-primary shadow-elevated hover:bg-white/90">
            Request access
          </Link>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Home

export function PlatformHome() {
  return (
    <>
      <div className="relative overflow-hidden bg-ink">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/35 blur-3xl"
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink/60 to-transparent" />
        <Section className="relative py-20 lg:py-28">
          <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="max-w-xl animate-fade-rise">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-bright">{HERO.eyebrow}</p>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-display-md">
                {HERO.title}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-white/70">{HERO.body}</p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link to={HERO.primaryCta.to} className="btn btn-lg bg-accent text-white shadow-elevated hover:brightness-110">
                  {HERO.primaryCta.label}
                </Link>
                <Link
                  to={HERO.secondaryCta.to}
                  className="btn btn-lg border border-white/20 bg-white/5 text-white hover:bg-white/10"
                >
                  {HERO.secondaryCta.label}
                </Link>
              </div>
              <ul className="mt-10 flex flex-wrap gap-x-7 gap-y-2.5 text-sm text-white/60">
                {['No shared data between fellowships', 'Role-based access', 'Audit trail'].map((point) => (
                  <li key={point} className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-4 w-4 shrink-0 text-accent-bright" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="animate-fade-rise [animation-delay:120ms]">
              <ProductPreview />
            </div>
          </div>
        </Section>
      </div>

      <LiveStats />

      <Section>
        <SectionHeading
          eyebrow="Capabilities"
          title="Every part of a fellowship’s administration, working together"
          body="Each of these is a working part of the system, not a roadmap item."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon] ?? Squares2X2Icon;
            return (
              <Card key={f.title} className="card-hover p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-control bg-primary-light text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.body}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      <Section className="border-y border-hairline bg-surface-sunken">
        <SectionHeading
          eyebrow="Why it matters"
          title="Built around how fellowships are actually structured"
          body="Congregations, not companies — so the system models the offices you already have."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <Card key={s.audience} className="p-6">
              <p className="eyebrow">{s.audience}</p>
              <h3 className="mt-2 text-lg font-semibold text-ink">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              <ul className="mt-5 space-y-2.5">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-ink-muted">
                    <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <CtaBanner />
    </>
  );
}

/**
 * A composed view of the application itself, rather than a decorative illustration.
 *
 * It is drawn with the same tokens as the real interface, so it cannot drift from what a customer actually sees, and
 * the figures are labelled as an example because no real fellowship's numbers belong on a marketing page.
 */
function ProductPreview() {
  return (
    <div className="rounded-card border border-white/10 bg-white/[0.04] p-2 shadow-overlay backdrop-blur-sm">
      <div className="overflow-hidden rounded-[0.5rem] bg-canvas">
        <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
          <span className="ml-1 truncate text-[11px] font-medium text-ink-subtle">Fellowship Manager — Dashboard</span>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: 'Members', v: '248' },
              { k: 'Departments', v: '12' },
              { k: 'This month', v: 'TZS 4.1M' },
              { k: 'Pending', v: '7' },
            ].map((s) => (
              <div key={s.k} className="rounded-control border border-hairline bg-surface p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-ink-subtle">{s.k}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{s.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-control border border-hairline bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-ink">Contributions</p>
              <span className="badge badge-success">On track</span>
            </div>
            <div className="mt-4 flex h-20 items-end gap-1.5">
              {[38, 52, 44, 61, 73, 58, 82, 69, 88, 76, 94, 81].map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-primary/15" style={{ height: `${h}%` }}>
                  <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(18, h - 22)}%`, marginTop: 'auto' }} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-ink-subtle">Example figures, shown to illustrate the dashboard.</p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-control border border-hairline bg-surface p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Needs attention</p>
              <ul className="mt-2 space-y-1.5">
                {['3 expense approvals', '2 expiring accounts', '1 unreplied prayer request'].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-[11px] text-ink-muted">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-control border border-hairline bg-surface p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Next activity</p>
              <p className="mt-2 text-xs font-medium text-ink">Midweek prayer meeting</p>
              <p className="mt-1 text-[11px] text-ink-subtle">Wednesday, 18:00 · 42 attending</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- About

export function PlatformAbout() {
  return (
    <>
      <Section className="pb-0">
        <SectionHeading
          eyebrow="About"
          title="One system, many fellowships, no shared data"
          body="A fellowship is a tenant. That single decision is what everything else in this system is built on."
        />
      </Section>

<Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <Card className="p-8">
            <h3 className="text-lg font-semibold text-ink">The problem it solves</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Fellowships outgrow paper by outgrowing the people who remember it. Membership moves to one book,
              finance to another, and communication to a group chat. A secretary spends the week reconciling them.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              This puts the register, the ledger, the calendar and the public face of a congregation in one place,
              and keeps the boundaries between congregations enforced by the server rather than by convention.
            </p>
          </Card>
          <Card className="p-8">
            <h3 className="text-lg font-semibold text-ink">The offices it models</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-muted">
              {[
                ['Secretary', 'runs members, departments, activities and the accounts of the fellowship.'],
                ['Assistant Secretary', 'the same, minus the Secretary-only actions.'],
                ['Chairperson', 'approvals and oversight.'],
                ['Treasurer', 'contributions, expenses, budgets and money requests.'],
                ['IT', 'content manager for the fellowship\'s public site — and nothing else.'],
                ['Ordinary member', 'sees only their own details and their fellowship\'s shared items.'],
              ].map(([role, body]) => (
                <li key={role}>
                  <span className="font-medium text-ink">{role}.</span> {body}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <LiveStats />
      <CtaBanner />
    </>
  );
}

// ---------------------------------------------------------------- Features

export function PlatformFeatures() {
  return (
    <>
      <Section className="pb-0">
        <SectionHeading
          eyebrow="Features"
          title="What the system does"
          body="Named after the modules that exist, so nothing on this page is a promise about a later release."
        />
      </Section>
      <Section>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon] ?? Squares2X2Icon;
            return (
              <Card key={f.title} className="p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-control bg-primary-light text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{f.body}</p>
              </Card>
            );
          })}
        </div>
      </Section>
      <CtaBanner />
    </>
  );
}

// ---------------------------------------------------------------- Solutions

export function PlatformSolutions() {
  return (
    <>
      <Section className="pb-0">
        <SectionHeading
          eyebrow="Solutions"
          title="Three situations this is built for"
          body="A small fellowship fixing its records, a growing set of congregations, and one going public."
        />
      </Section>
      <Section>
        <div className="space-y-6">
          {SOLUTIONS.map((s) => (
            <Card key={s.audience} className="p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">{s.audience}</p>
              <h3 className="mt-2 text-xl font-semibold text-ink">{s.title}</h3>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">{s.body}</p>
              <ul className="mt-5 grid gap-2.5 sm:grid-cols-3">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-2 rounded-lg bg-canvas p-3 text-sm text-ink">
                    <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>
      <CtaBanner />
    </>
  );
}

// ---------------------------------------------------------------- Resources

export function PlatformResources() {
  return (
    <>
      <Section className="pb-0">
        <SectionHeading
          eyebrow="Resources"
          title="How the system works"
          body="Written for the people who have to live with it: the Secretary, the Treasurer, the content manager."
        />
      </Section>
      <Section>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCES.map((r) => (
            <Card key={r.title} className="card-hover p-6">
              <h3 className="text-base font-semibold text-ink">{r.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{r.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="FAQ" title="Questions people actually ask" />
        <div className="mt-8">
          <FaqList />
        </div>
      </Section>
      <CtaBanner />
    </>
  );
}

// ---------------------------------------------------------------- FAQ

export function PlatformFaq() {
  return (
    <>
      <Section className="pb-0">
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently asked questions"
          body="If the answer you need is not here, ask — the contact page goes to a person."
        />
      </Section>
      <Section>
        <FaqList />
      </Section>
      <CtaBanner />
    </>
  );
}

function FaqList() {
  return (
    <div className="mx-auto max-w-3xl divide-y divide-border overflow-hidden rounded-2xl bg-white">
      {FAQS.map((f) => (
        <details key={f.question} className="group px-6 py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-ink">
            {f.question}
            <span className="shrink-0 text-lg leading-none text-ink-subtle transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{f.answer}</p>
        </details>
      ))}
    </div>
  );
}
