import { useState, useEffect } from 'react';
import { useAuth } from '../App';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  UsersIcon, BuildingOfficeIcon, CalendarIcon, ChartBarIcon,
  BellIcon, DocumentTextIcon, CurrencyDollarIcon, ArrowRightIcon, ServerIcon,
} from '@heroicons/react/24/outline';
import { PageHeader, Card, Skeleton, EmptyState, ErrorState, Badge } from '../components/ui';

export default function Dashboard() {
  const { user, hasRole } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [statsRes, profileRes] = await Promise.all([
        axios.get('/dashboard', { withCredentials: true }),
        axios.get('/profile', { withCredentials: true }).catch(() => null),
      ]);
      setStats(statsRes.data);
      setProfile(profileRes?.data || null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const name = profile?.firstName
    ? `${profile.firstName} ${profile.lastName || ''}`.trim()
    : user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : user?.email || 'there';

  const isAdmin = hasRole('admin');

  const statCards = [
    { name: 'Total members', value: stats?.totalMembers, icon: UsersIcon, tone: 'bg-primary-light text-primary', href: '/members' },
    { name: 'Departments', value: stats?.totalDepartments, icon: BuildingOfficeIcon, tone: 'bg-success-light text-success', href: '/departments' },
    { name: 'Activities', value: stats?.totalActivities, icon: CalendarIcon, tone: 'bg-warning-light text-warning', href: '/activities' },
  ];

  const quickLinks = [
    { name: 'Members', icon: UsersIcon, href: '/members', show: (hasRole('secretary') || hasRole('assistant_secretary')) && !isAdmin },
    { name: 'Departments', icon: BuildingOfficeIcon, href: '/departments', show: (hasRole('secretary') || hasRole('assistant_secretary')) && !isAdmin },
    { name: 'Activities', icon: CalendarIcon, href: '/activities', show: !isAdmin },
    { name: 'Finance', icon: CurrencyDollarIcon, href: '/finance', show: (hasRole('treasurer') || hasRole('secretary') || hasRole('chairperson')) && !isAdmin },
    { name: 'Reports', icon: ChartBarIcon, href: '/reports', show: (hasRole('secretary') || hasRole('chairperson') || hasRole('department_secretary')) && !isAdmin },
    { name: 'Users', icon: UsersIcon, href: '/users', show: hasRole('admin') || hasRole('secretary') },
    { name: 'Notifications', icon: BellIcon, href: '/notifications', show: true },
    { name: 'Audit trail', icon: DocumentTextIcon, href: '/audit', show: hasRole('admin') || hasRole('secretary') || hasRole('chairperson') },
    { name: 'Backups', icon: ServerIcon, href: '/backups', show: hasRole('admin') },
    { name: 'Platform', icon: BuildingOfficeIcon, href: '/platform', show: hasRole('admin') || hasRole('platform_support') },
  ].filter((l) => l.show);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${name}`}
        description="A summary of your fellowship, and the places you are most likely to need next."
        actions={
          <>
            {user?.roles?.slice(0, 3).map((role) => (
              <Badge key={role} tone="neutral">
                {role.replace(/_/g, ' ')}
              </Badge>
            ))}
            <Link to="/profile" className="btn btn-secondary btn-sm">
              View profile
            </Link>
          </>
        }
      />

      {failed ? (
        <Card className="card-pad">
          <ErrorState title="Could not load your dashboard" onRetry={load} />
        </Card>
      ) : (
        <>
          {/* Skeletons hold the layout so nothing jumps when the numbers arrive. */}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card card-pad">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-11 w-11 rounded-control" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-7 w-16" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !isAdmin && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {statCards.map((card) => (
                  <Link key={card.name} to={card.href} className="card card-interactive card-pad flex items-center gap-4">
                    <div className={`stat-icon ${card.tone}`}>
                      <card.icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-ink-muted">{card.name}</p>
                      <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">
                        {card.value ?? 0}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}

          {!loading && quickLinks.length > 0 && (
            <section className="mt-8">
              <h2 className="section-title">Quick access</h2>
              <p className="mt-1 text-sm text-ink-muted">The areas you use most.</p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {quickLinks.map((link) => (
                  <Link key={link.name} to={link.href} className="card card-interactive flex items-center gap-3 px-4 py-3.5">
                    <link.icon className="h-5 w-5 shrink-0 text-ink-subtle" />
                    <span className="flex-1 truncate text-sm font-medium text-ink">{link.name}</span>
                    <ArrowRightIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="mt-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Recent activity</h2>
                <p className="mt-1 text-sm text-ink-muted">What has changed in your fellowship recently.</p>
              </div>
              <Link to="/audit" className="btn btn-quiet btn-sm">
                View audit trail
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>

            <Card>
              {loading ? (
                <div className="space-y-3 p-5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  ))}
                </div>
              ) : stats?.recentActions?.length ? (
                <ul className="divide-y divide-hairline">
                  {stats.recentActions.map((a: any) => (
                    <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-medium text-primary">{a.action}</span>
                        {a.detail && <span className="ml-2 text-sm text-ink-muted">{a.detail}</span>}
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-xs text-ink-subtle">
                        {new Date(a.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={<ChartBarIcon className="h-8 w-8" />}
                  title="No activity recorded yet"
                  description="Once your fellowship starts managing members, activities and finance, the most recent changes will appear here."
                  action={
                    <Link to="/activities" className="btn btn-secondary btn-sm">
                      Plan an activity
                    </Link>
                  }
                />
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}