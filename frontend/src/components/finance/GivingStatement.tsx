import { useEffect, useState } from 'react';
import axios from 'axios';
import { Empty, Spinner, errMsg, money } from './common';

// Renders a giving statement returned by /finance/members/:id/statement (finance viewers) or
// /finance/my-contributions (a member's own view). The server decides who may see what.
export default function GivingStatement({ url }: { url: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    axios.get(url, { withCredentials: true })
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.status === 404
        ? 'No giving record is available.'
        : errMsg(e, 'Could not load the statement.')));
  }, [url]);

  if (error) return <Empty text={error} />;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="card"><p className="text-sm text-ink-muted">Total given</p><p className="text-2xl font-semibold text-ink">{money(data.total)}</p></div>
        <div className="card"><p className="text-sm text-ink-muted">Contributions</p><p className="text-2xl font-semibold text-ink">{data.count}</p></div>
      </div>

      {data.byType.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.byType.map((t: any) => (
            <span key={t.type} className="rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium capitalize text-ink">{t.type}: {money(t.total)}</span>
          ))}
        </div>
      )}

      {data.contributions.length === 0 ? <Empty text="No contributions recorded" /> : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Campaign</th></tr></thead>
            <tbody>
              {data.contributions.map((c: any) => (
                <tr key={c.id}>
                  <td>{new Date(c.date).toLocaleDateString()}</td>
                  <td className="capitalize">{c.contribution_type}</td>
                  <td className="font-medium text-ink">{money(c.amount)}</td>
                  <td>{c.campaign?.name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.truncated && <p className="text-xs text-ink-subtle">Showing the most recent 1,000 contributions.</p>}

      {data.pledges.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Pledges</h3>
          <ul className="divide-y divide-hairline">
            {data.pledges.map((p: any) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-slate-800">{money(p.amount)} <span className="text-ink-muted">{p.frequency.replace('_', ' ')}{p.campaign ? ` · ${p.campaign.name}` : ''}</span></span>
                <span className={Number(p.fulfillment.balance) > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                  {money(p.fulfillment.receivedAmount)} of {money(p.fulfillment.expectedAmount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
