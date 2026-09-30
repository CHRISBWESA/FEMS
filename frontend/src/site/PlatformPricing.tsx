import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, ShieldCheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { CtaBanner, Section, SectionHeading } from './PlatformPages';

interface Plan {
  code: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  interval: string;
  trialDays: number;
  modules: string[];
  limits: Record<string, unknown>;
}

/**
 * The pricing table.
 *
 * Every figure comes from the `saas_plans` table through `/public/site/plans`. Nothing is hardcoded, and nothing is
 * invented: there is no live payment gateway in this system, so the call to action is a request that an
 * administrator sets the plan up — not a checkout button that would go nowhere.
 */
export default function PlatformPricing() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/public/site/plans')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unavailable'))))
      .then((d) => {
        if (!cancelled && Array.isArray(d)) setPlans(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Section className="pb-0">
        <SectionHeading
          eyebrow="Pricing"
          title="Plans"
          body="Your administrator sets the plan when your request is approved, and can change it as the fellowship grows."
        />
      </Section>

      <Section>
        {failed && (
          <div className="mb-8 flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
            <p>The plan list could not be loaded. Ask an administrator what plans are available.</p>
          </div>
        )}

        {!plans && !failed && (
          <p className="text-sm text-slate-500">Loading plans…</p>
        )}

        {plans && plans.length === 0 && (
          <p className="text-sm text-slate-500">No plans have been published yet. Contact an administrator to arrange one.</p>
        )}

        {plans && plans.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.code} className="card flex flex-col p-7">
                <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                {plan.description && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{plan.description}</p>
                )}

                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight text-slate-900">
                    {plan.price === 0 ? 'Free' : plan.price.toLocaleString()}
                  </span>
                  {plan.price > 0 && (
                    <span className="text-sm text-slate-500">
                      {plan.currency} per {plan.interval}
                    </span>
                  )}
                </p>

                {plan.trialDays > 0 && (
                  <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    <CheckIcon className="h-3.5 w-3.5" />
                    {plan.trialDays}-day free trial
                  </p>
                )}

                {plan.modules.length > 0 && (
                  <ul className="mt-6 flex-1 space-y-2 border-t border-border pt-5">
                    {plan.modules.map((m) => (
                      <li key={m} className="flex gap-2 text-sm text-slate-600">
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <span>{humaniseModule(m)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <Link to="/register" className="btn btn-primary mt-7 w-full">
                  Get Started
                </Link>
              </div>
            ))}
          </div>
        )}

        <div className="mx-auto mt-10 flex max-w-3xl items-start gap-3 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <p>
            There is no payment gateway here, and none is implied. “Get Started” sends a request that an
            administrator reviews; billing is arranged directly with the fellowship. Nothing is charged online.
          </p>
        </div>
      </Section>

      <CtaBanner />
    </>
  );
}

/** Plan modules are stored as keys like `youth` or `resources`; the page reads better as words. */
function humaniseModule(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
