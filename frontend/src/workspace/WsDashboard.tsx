import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { UsersIcon, CalendarDaysIcon, BanknotesIcon, DocumentTextIcon, UserPlusIcon, PlusIcon, ClockIcon } from '@heroicons/react/24/outline';
import { Card, ErrorState, PageLoader, StatCard, StatGrid } from '../components/ui';
import { useI18n } from '../context/I18nContext';
import { StatusBadge, errMsg, fmtDate, fmtDateTime, fmtMoney, useWorkspace } from './shared';

function Section({ title, to, children, empty }: { title: string; to?: string; children: React.ReactNode; empty: boolean }) {
  return (
    <Card className="card-pad">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {to && <Link to={to} className="text-sm font-medium text-primary hover:underline">View all →</Link>}
      </div>
      {empty ? <p className="text-sm text-ink-muted">Nothing here yet.</p> : <ul className="divide-y divide-hairline">{children}</ul>}
    </Card>
  );
}

export default function WsDashboard() {
  const { base, path, department } = useWorkspace();
  const { t } = useI18n();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    axios.get(`${base}/dashboard`, { withCredentials: true }).then((r) => setD(r.data)).catch((e) => setError(errMsg(e, 'Could not load the dashboard.')));
  };
  useEffect(load, [base]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <PageLoader rows={3} />;

  const leader = (l: any) => (l ? <><span className="font-medium text-ink">{l.fullName}</span> <span className="text-xs text-ink-subtle">since {fmtDate(l.startDate)}</span></> : <span className="text-ink-subtle">{t('ws.vacant')}</span>);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{t('ws.workspace')}</p>
          <h1 className="page-title">{d.department.name}</h1>
          <p className="page-desc">{d.department.description || 'No description yet.'}</p>
        </div>
      </div>

      <StatGrid>
        <StatCard label={t('ws.totalMembers')} value={d.stats.total} icon={<UsersIcon className="h-5 w-5" />} tone="primary" to={path('members')} />
        <StatCard label={t('ws.male')} value={d.stats.male} />
        <StatCard label={t('ws.female')} value={d.stats.female} hint={d.stats.otherOrUnknown ? `${d.stats.otherOrUnknown} other or not recorded` : undefined} />
        <StatCard label={t('ws.pendingApprovals')} value={d.pendingActivityCount} icon={<ClockIcon className="h-5 w-5" />} tone={d.pendingActivityCount ? 'warning' : 'neutral'} to={path('activities')} />
      </StatGrid>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="card-pad">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{t('ws.department_chairperson')}</p>
          <p className="mt-1 text-sm">{leader(d.chairperson)}</p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{t('ws.department_secretary')}</p>
          <p className="mt-1 text-sm">{leader(d.secretary)}</p>
        </Card>
      </div>

      <Card className="card-pad">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('ws.quickActions')}</h2>
        <div className="flex flex-wrap gap-2">
          <Link to={path('activities?new=1')} className="btn btn-primary btn-sm"><PlusIcon className="h-4 w-4" /> {t('ws.newActivity')}</Link>
          <Link to={path('reports?new=1')} className="btn btn-secondary btn-sm"><DocumentTextIcon className="h-4 w-4" /> {t('ws.newReport')}</Link>
          <Link to={path('finance?new=1')} className="btn btn-secondary btn-sm"><BanknotesIcon className="h-4 w-4" /> {t('ws.newRequest')}</Link>
          <Link to={path('members?add=1')} className="btn btn-secondary btn-sm"><UserPlusIcon className="h-4 w-4" /> {t('ws.addMembers')}</Link>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('ws.upcoming')} to={path('activities')} empty={!d.upcomingActivities.length}>
          {d.upcomingActivities.map((a: any) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2"><CalendarDaysIcon className="h-4 w-4 shrink-0 text-ink-subtle" /><span className="truncate text-ink">{a.title}</span></span>
              <span className="shrink-0 text-ink-muted">{fmtDateTime(a.date)}</span>
            </li>
          ))}
        </Section>
        <Section title={t('ws.pendingApprovals')} to={path('activities')} empty={!d.pendingActivities.length}>
          {d.pendingActivities.map((a: any) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate text-ink">{a.title}</span>
              <StatusBadge status={a.status} label={a.statusLabel} />
            </li>
          ))}
        </Section>
        <Section title={t('ws.recent')} to={path('activities')} empty={!d.recentActivities.length}>
          {d.recentActivities.map((a: any) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate text-ink">{a.title}</span>
              <span className="shrink-0 text-ink-muted">{fmtDate(a.date)}</span>
            </li>
          ))}
        </Section>
        <Section title={t('ws.pendingRequests')} to={path('finance')} empty={!d.pendingFinancialRequests.length}>
          {d.pendingFinancialRequests.map((r: any) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate text-ink">{r.title} <span className="text-ink-muted">· {fmtMoney(r.amount)}</span></span>
              <StatusBadge status={r.status} label={r.statusLabel} />
            </li>
          ))}
        </Section>
        <Section title={t('ws.recentReports')} to={path('reports')} empty={!d.recentReports.length}>
          {d.recentReports.map((r: any) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate text-ink">{r.activityTitle}</span>
              <StatusBadge status={r.status} label={r.statusLabel} />
            </li>
          ))}
        </Section>
        <Section title={t('ws.recentAnnouncements')} to={path('announcements')} empty={!d.recentAnnouncements.length}>
          {d.recentAnnouncements.map((a: any) => (
            <li key={a.id} className="py-2 text-sm">
              <p className="truncate font-medium text-ink">{a.title}</p>
              <p className="text-xs text-ink-subtle">{fmtDate(a.publishedAt)}</p>
            </li>
          ))}
        </Section>
      </div>
      <p className="text-xs text-ink-subtle">Showing {department.name}. All figures are taken from the fellowship's records.</p>
    </div>
  );
}
