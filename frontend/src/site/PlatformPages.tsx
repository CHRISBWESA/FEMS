import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UsersIcon, Squares2X2Icon, CalendarDaysIcon, BanknotesIcon, AcademicCapIcon, CubeIcon,
  HandRaisedIcon, GlobeAltIcon, ShieldCheckIcon, ArchiveBoxIcon, ChartBarIcon, BellIcon,
} from '@heroicons/react/24/outline';
import { HERO, FEATURES, SOLUTIONS, FAQS, RESOURCES } from './site-copy';

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
    <section id={id} className={`mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </section>
  );
}

export function SectionHeading({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
      )}
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-base leading-relaxed text-slate-600">{body}</p>}
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
      <dl className="grid gap-6 rounded-2xl bg-slate-900 p-8 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label}>
            <dd className="text-4xl font-semibold tracking-tight text-white">{t.value.toLocaleString()}</dd>
            <dt className="mt-1 text-sm text-slate-400">{t.label}</dt>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function CtaBanner() {
  return (
    <Section>
      <div className="flex flex-col items-start gap-6 rounded-2xl bg-primary p-8 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Ready to get your fellowship set up?</h2>
          <p className="mt-2 text-sm leading-relaxed text-indigo-100">
            Request access and an administrator will review it. Nothing is created until they approve it.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Link to="/login" className="btn btn-secondary">Sign In</Link>
          <Link to="/register" className="btn bg-white text-primary hover:bg-indigo-50">Get Started</Link>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Home

export function PlatformHome() {
  return (
    <>
      <div className="relative overflow-hidden bg-slate-900">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <Section className="relative py-24 lg:py-32">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-300">{HERO.eyebrow}</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
              {HERO.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">{HERO.body}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to={HERO.primaryCta.to} className="btn btn-primary px-6 py-3">{HERO.primaryCta.label}</Link>
              <Link to={HERO.secondaryCta.to} className="btn btn-secondary px-6 py-3">{HERO.secondaryCta.label}</Link>
            </div>
          </div>
        </Section>
      </div>

      <LiveStats />

      <Section>
        <SectionHeading
          eyebrow="Features"
          title="Everything a fellowship actually runs on"
          body="Each of these is a working part of the system, not a roadmap item."
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon] ?? Squares2X2Icon;
            return (
              <div key={f.title} className="card card-hover p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-light text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Solutions"
          title="Built around how fellowships are actually structured"
          body="Congregations, not companies — so the system models the offices you already have."
        />
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <div key={s.audience} className="card p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">{s.audience}</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{s.body}</p>
              <ul className="mt-4 space-y-2">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-2 text-sm text-slate-600">
                    <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <CtaBanner />
    </>
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
          <div className="card p-8">
            <h3 className="text-lg font-semibold text-slate-900">The problem it solves</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Fellowships outgrow paper by outgrowing the people who remember it. Membership moves to one book,
              finance to another, and communication to a group chat. A secretary spends the week reconciling them.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              This puts the register, the ledger, the calendar and the public face of a congregation in one place,
              and keeps the boundaries between congregations enforced by the server rather than by convention.
            </p>
          </div>
          <div className="card p-8">
            <h3 className="text-lg font-semibold text-slate-900">The offices it models</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
              {[
                ['Secretary', 'runs members, departments, activities and the accounts of the fellowship.'],
                ['Assistant Secretary', 'the same, minus the Secretary-only actions.'],
                ['Chairperson', 'approvals and oversight.'],
                ['Treasurer', 'contributions, expenses, budgets and money requests.'],
                ['IT', 'content manager for the fellowship’s public site — and nothing else.'],
                ['Ordinary member', 'sees only their own details and their fellowship’s shared items.'],
              ].map(([role, body]) => (
                <li key={role}>
                  <span className="font-medium text-slate-900">{role}.</span> {body}
                </li>
              ))}
            </ul>
          </div>
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
              <div key={f.title} className="card p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary-light text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
              </div>
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
            <div key={s.audience} className="card p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">{s.audience}</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">{s.body}</p>
              <ul className="mt-5 grid gap-2.5 sm:grid-cols-3">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                    <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
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
            <div key={r.title} className="card card-hover p-6">
              <h3 className="text-base font-semibold text-slate-900">{r.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{r.body}</p>
            </div>
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
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-900">
            {f.question}
            <span className="shrink-0 text-lg leading-none text-slate-400 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{f.answer}</p>
        </details>
      ))}
    </div>
  );
}
