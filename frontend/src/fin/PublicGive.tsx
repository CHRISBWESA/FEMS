import { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

const fmt = (v: string | number, c: string) => `${c} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * The public fundraising page (no sign-in). It shows only what the fellowship chose to publish: purpose, target,
 * budget, amount raised and updates - never who gave.
 */
export default function PublicGive() {
  const { slug } = useParams();
  const [d, setD] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    axios.get(`/public/fundraising/${slug}`).then((r) => { setD(r.data); document.title = `${r.data.title} · ${r.data.fellowship}`; }).catch(() => setMissing(true));
  }, [slug]);

  if (missing) {
    return <main className="flex min-h-screen items-center justify-center bg-surface-sunken p-6 text-center"><div><h1 className="text-xl font-semibold text-ink">This fundraising page is not available</h1><p className="mt-2 text-ink-muted">It may have ended or been taken down.</p></div></main>;
  }
  if (!d) return <main className="flex min-h-screen items-center justify-center bg-surface-sunken"><span className="spinner h-6 w-6" aria-label="Loading" /></main>;
  return (
    <main className="min-h-screen bg-surface-sunken px-4 py-8 sm:py-12">
      <article className="mx-auto max-w-2xl space-y-6">
        <header className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">{d.fellowship}</p>
          <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">{d.title}</h1>
          {d.project && <p className="mt-2 text-ink-muted">{d.project.purpose}</p>}
          {d.status !== 'active' && <p className="mt-2 inline-block rounded-full bg-warning-light px-3 py-1 text-sm text-warning">{d.status === 'paused' ? 'Paused' : 'Closed'}</p>}
        </header>

        <section className="rounded-card bg-surface p-5 shadow-sm" aria-label="Progress">
          <div className="flex items-end justify-between gap-4">
            <div><p className="text-sm text-ink-muted">Raised</p><p className="text-2xl font-bold text-ink">{fmt(d.raised, d.currency)}</p></div>
            <div className="text-right"><p className="text-sm text-ink-muted">Target</p><p className="text-lg font-semibold text-ink">{fmt(d.target, d.currency)}</p></div>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={d.progressPercent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-success" style={{ width: `${d.progressPercent}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-sm text-ink-muted"><span>{d.progressPercent}% of the target</span><span>{fmt(d.remaining, d.currency)} to go</span></div>
          <p className="mt-3 text-xs text-ink-subtle">{new Date(d.startDate).toLocaleDateString()}{d.endDate ? ` – ${new Date(d.endDate).toLocaleDateString()}` : ''}{d.location ? ` · ${d.location}` : ''}</p>
        </section>

        {d.description && <section className="rounded-card bg-surface p-5 shadow-sm"><h2 className="mb-2 font-semibold text-ink">About</h2><p className="whitespace-pre-wrap text-ink">{d.description}</p></section>}

        {d.budget.length > 0 && (
          <section className="rounded-card bg-surface p-5 shadow-sm">
            <h2 className="mb-2 font-semibold text-ink">How the money will be used</h2>
            <ul className="divide-y divide-hairline">{d.budget.map((b: any, i: number) => <li key={i} className="flex justify-between py-2 text-sm"><span className="text-ink">{b.item}</span><span className="tabular-nums text-ink-muted">{fmt(b.amount, d.currency)}</span></li>)}</ul>
          </section>
        )}

        {d.updates.length > 0 && (
          <section className="rounded-card bg-surface p-5 shadow-sm">
            <h2 className="mb-2 font-semibold text-ink">Updates</h2>
            <ul className="space-y-3">{d.updates.map((u: any) => <li key={u.id}><p className="font-medium text-ink">{u.title}</p><p className="text-xs text-ink-subtle">{new Date(u.created_at).toLocaleDateString()}</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink">{u.body}</p></li>)}</ul>
          </section>
        )}
        <footer className="text-center text-xs text-ink-subtle">To give, contact {d.fellowship}. Contributions are receipted by the fellowship's Treasurer.</footer>
      </article>
    </main>
  );
}
