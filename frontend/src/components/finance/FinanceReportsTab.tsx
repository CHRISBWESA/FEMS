import { useEffect, useState } from 'react';
import axios from 'axios';
import { Bar, Empty, Spinner, errMsg, isoDay, money } from './common';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function Rows({ rows, label, value }: { rows: any[]; label: (r: any) => string; value: (r: any) => string }) {
  if (!rows?.length) return <p className="text-sm text-slate-500">Nothing recorded in this range.</p>;
  const max = Math.max(...rows.map((r) => Number(value(r))), 1);
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-3 text-sm">
          <span className="w-40 truncate text-slate-700">{label(r)}</span>
          <Bar value={Number(value(r))} max={max} />
          <span className="w-24 text-right font-medium text-slate-900">{money(value(r))}</span>
        </li>
      ))}
    </ul>
  );
}

// Aggregate-only reporting. Department leaders receive a department-scoped variant from the server
// (no contribution or income data); everything shown here is exactly what the API returned.
export default function FinanceReportsTab() {
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(isoDay());
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    axios.get(`/finance/reports/summary?from=${from}&to=${to}`, { withCredentials: true })
      .then((r) => { setData(r.data); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load the report')));
  }, [from, to]);

  if (error) return <Empty text={error} />;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} max={isoDay()} onChange={(e) => setTo(e.target.value)} /></div>
        <p className="pb-2 text-xs text-slate-400">{data.scope === 'department' ? 'Showing your department only.' : 'Fellowship-wide, aggregate figures only.'}</p>
      </div>

      {data.operatingPosition && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            ['Contributions + income', data.operatingPosition.contributionsAndIncome, 'text-emerald-700'],
            ['Approved expenses', data.operatingPosition.approvedExpenses, 'text-rose-700'],
            ['Net', data.operatingPosition.net, Number(data.operatingPosition.net) >= 0 ? 'text-slate-900' : 'text-rose-700'],
          ].map(([label, v, cls]) => (
            <div key={label as string} className="card">
              <p className="text-sm text-slate-500">{label}</p>
              <p className={`text-2xl font-semibold ${cls}`}>{money(v as string)}</p>
            </div>
          ))}
        </div>
      )}
      {data.operatingPosition && (
        <p className="-mt-3 text-xs text-slate-400">Only fully approved expenses count as spending. Money-request releases are shown separately below and are not added to this figure.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {data.contributions && (
          <Card title={`Contributions · ${money(data.contributions.total)} (${data.contributions.count})`}>
            <Rows rows={data.contributions.byType} label={(r) => r.type} value={(r) => r.total} />
          </Card>
        )}
        {data.contributions && (
          <Card title="Contributions by campaign">
            <Rows rows={data.contributions.byCampaign} label={(r) => r.name || 'Unknown'} value={(r) => r.total} />
          </Card>
        )}
        {data.contributions && (
          <Card title="Monthly contributions">
            <Rows rows={data.contributions.monthly} label={(r) => r.month} value={(r) => r.total} />
          </Card>
        )}
        {data.income && (
          <Card title={`Other income · ${money(data.income.total)}`}>
            <Rows rows={data.income.byCategory} label={(r) => r.name || 'Unknown'} value={(r) => r.total} />
          </Card>
        )}
        <Card title={`Approved expenses · ${money(data.expenses.approvedTotal)} · ${data.expenses.pendingApprovalCount} awaiting approval`}>
          <Rows rows={data.expenses.byDepartment} label={(r) => r.name || 'No department'} value={(r) => r.total} />
        </Card>
        <Card title="Budget vs actual">
          {data.budgetVsActual.length === 0 ? <p className="text-sm text-slate-500">No approved budgets.</p> : (
            <ul className="space-y-2 text-sm">
              {data.budgetVsActual.map((b: any, i: number) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="text-slate-700">{b.fiscalYear} · {b.departmentName || 'Fellowship'}</span>
                  <span className={Number(b.remaining) < 0 ? 'font-medium text-rose-700' : 'text-slate-900'}>{money(b.spent)} / {money(b.budgeted)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Money requests">
          <ul className="space-y-1 text-sm">
            {data.moneyRequests.byStatus.map((s: any) => (
              <li key={s.status} className="flex justify-between"><span className="capitalize text-slate-700">{s.status.toLowerCase().replace(/_/g, ' ')}</span><span>{s.count} · {money(s.total)}</span></li>
            ))}
            <li className="flex justify-between border-t border-border pt-2"><span className="text-slate-700">Released</span><span>{data.moneyRequests.releasedCount} · {money(data.moneyRequests.releasedTotal)}</span></li>
            <li className="flex justify-between"><span className="text-slate-700">Approved, awaiting release</span><span>{data.moneyRequests.awaitingRelease}</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
