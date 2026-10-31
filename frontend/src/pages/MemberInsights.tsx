import { useEffect, useState } from 'react';
import axios from 'axios';
import { UsersIcon, UserPlusIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { PageLoader } from '../components/ui';

function Bar({ value, max, className = 'bg-primary' }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 flex-1 rounded-full bg-surface-sunken">
      <div className={`h-2 rounded-full ${className}`} style={{ width: value > 0 ? `${pct}%` : 0 }} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">{title}</h2>
      {children}
    </div>
  );
}

function TagList({ rows }: { rows: { tag: string; count: number }[] }) {
  if (!rows.length) return <p className="text-sm text-ink-muted">Nothing recorded yet.</p>;
  const max = rows[0].count;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.tag} className="flex items-center gap-3 text-sm">
          <span className="w-32 truncate text-ink">{r.tag}</span>
          <Bar value={r.count} max={max} />
          <span className="w-8 text-right font-medium text-ink">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export default function MemberInsights() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    axios.get(`/members/reports/summary?months=${months}`, { withCredentials: true })
      .then((res) => { setData(res.data); setError(''); })
      .catch((err) => setError(err.response?.status === 403
        ? "You don't have permission to view member insights."
        : 'Could not load member insights.'));
  }, [months]);

  if (error) return <div className="empty-state"><p className="empty-title">{error}</p></div>;
  if (!data) return <PageLoader rows={2} />;

  const growthMax = Math.max(1, ...data.membershipGrowth.map((g: any) => Math.max(g.registered, g.deactivated + g.graduated)));
  const deptMax = Math.max(1, ...data.departmentDistribution.departments.map((d: any) => d.count));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Member Insights</h1>
          <p className="page-desc">
            Aggregate membership figures{data.scope === 'department' ? ' for your department' : ''}. No individual is identified.
          </p>
        </div>
        <div className="flex gap-2">
          <select className="select w-36" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[6, 12, 24].map((m) => <option key={m} value={m}>Last {m} months</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Members', value: data.totals.total, icon: UsersIcon, color: 'bg-primary-light text-primary' },
          { label: 'Active', value: data.totals.active, icon: UserPlusIcon, color: 'bg-emerald-50 text-success' },
          { label: 'Inactive', value: data.totals.inactive, icon: ChartBarIcon, color: 'bg-amber-50 text-amber-600' },
          { label: 'Graduated', value: data.totals.graduated, icon: ChartBarIcon, color: 'bg-surface-sunken text-ink-muted' },
        ].map((c) => (
          <div key={c.label} className="card flex items-center gap-4">
            <div className={`stat-icon ${c.color}`}><c.icon className="h-6 w-6" /></div>
            <div>
              <p className="text-sm text-ink-muted">{c.label}</p>
              <p className="text-2xl font-semibold text-ink">{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Membership growth">
          <ul className="space-y-2">
            {data.membershipGrowth.map((g: any) => (
              <li key={g.month} className="flex items-center gap-3 text-xs">
                <span className="w-16 text-ink-muted">{g.month}</span>
                <Bar value={g.registered} max={growthMax} className="bg-emerald-500" />
                <span className="w-8 text-right text-emerald-700">+{g.registered}</span>
                <Bar value={g.deactivated + g.graduated} max={growthMax} className="bg-rose-400" />
                <span className="w-8 text-right text-rose-600">−{g.deactivated + g.graduated}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-subtle">
            Green: newly registered. Red: became inactive or graduated. Figures come from the membership history; members that existed
            before history tracking began are placed at their registration date.
          </p>
        </Card>

        <Card title="Department distribution">
          {data.departmentDistribution.departments.length === 0 ? (
            <p className="text-sm text-ink-muted">No department memberships yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.departmentDistribution.departments.map((d: any) => (
                <li key={d.departmentId} className="flex items-center gap-3 text-sm">
                  <span className="w-40 truncate text-ink">{d.name || d.departmentId}</span>
                  <Bar value={d.count} max={deptMax} />
                  <span className="w-8 text-right font-medium text-ink">{d.count}</span>
                </li>
              ))}
            </ul>
          )}
          {data.scope !== 'department' && (
            <p className="mt-3 text-xs text-ink-subtle">{data.departmentDistribution.noDepartment} member(s) are not in any department.</p>
          )}
        </Card>

        {data.topTags && (
          <>
            <Card title="Top skills"><TagList rows={data.topTags.skills} /></Card>
            <Card title="Top service interests"><TagList rows={data.topTags.serviceInterests} /></Card>
          </>
        )}
      </div>
    </div>
  );
}
