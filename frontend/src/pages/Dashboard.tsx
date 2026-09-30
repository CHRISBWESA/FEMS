import { useState, useEffect } from 'react';
import { useAuth } from '../App';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  UsersIcon, BuildingOfficeIcon, CalendarIcon, ChartBarIcon,
  BellIcon, DocumentTextIcon,   CurrencyDollarIcon, ArrowRightIcon, ServerIcon,
} from '@heroicons/react/24/outline';

export default function Dashboard() {
  const { user, hasRole } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, profileRes] = await Promise.all([
        axios.get('/dashboard', { withCredentials: true }),
        axios.get('/profile', { withCredentials: true }).catch(() => null),
      ]);
      setStats(statsRes.data);
      setProfile(profileRes?.data || null);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const name = profile?.firstName
    ? `${profile.firstName} ${profile.lastName || ''}`.trim()
    : user?.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : user?.email || 'there';

  const statCards = [
    { name: 'Total Members', value: stats?.totalMembers, icon: UsersIcon, color: 'bg-indigo-50 text-indigo-600', href: '/members', show: !hasRole('admin') },
    { name: 'Departments', value: stats?.totalDepartments, icon: BuildingOfficeIcon, color: 'bg-emerald-50 text-emerald-600', href: '/departments', show: !hasRole('admin') },
    { name: 'Activities', value: stats?.totalActivities, icon: CalendarIcon, color: 'bg-amber-50 text-amber-600', href: '/activities', show: !hasRole('admin') },
  ].filter((s) => s.show);

  const quickLinks = [
    { name: 'Users', icon: UsersIcon, href: '/users', show: hasRole('admin') || hasRole('secretary') },
    { name: 'Members', icon: UsersIcon, href: '/members', show: (hasRole('secretary') || hasRole('assistant_secretary')) && !hasRole('admin') },
    { name: 'Departments', icon: BuildingOfficeIcon, href: '/departments', show: (hasRole('secretary') || hasRole('assistant_secretary')) && !hasRole('admin') },
    { name: 'Activities', icon: CalendarIcon, href: '/activities', show: !hasRole('admin') },
    { name: 'Reports', icon: ChartBarIcon, href: '/reports', show: (hasRole('secretary') || hasRole('chairperson') || hasRole('department_secretary')) && !hasRole('admin') },
    { name: 'Finance', icon: CurrencyDollarIcon, href: '/finance', show: (hasRole('treasurer') || hasRole('secretary') || hasRole('chairperson')) && !hasRole('admin') },
    { name: 'Notifications', icon: BellIcon, href: '/notifications', show: true },
    { name: 'Audit', icon: DocumentTextIcon, href: '/audit', show: hasRole('admin') || hasRole('secretary') || hasRole('chairperson') },
    { name: 'Backups', icon: ServerIcon, href: '/backups', show: hasRole('admin') },
    { name: 'Platform', icon: BuildingOfficeIcon, href: '/platform', show: hasRole('admin') || hasRole('platform_support') },
  ].filter((l) => l.show);

  return (
    <div className="mx-auto max-w-7xl">
      {/* Welcome */}
      <div className="mb-8 overflow-hidden rounded-2xl bg-slate-900 p-8 text-white">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-indigo-600/30 blur-3xl" />
        <p className="text-sm text-slate-400">Welcome back</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {user?.roles?.map((role) => (
            <span key={role} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium capitalize text-slate-200">
              {role.replace('_', ' ')}
            </span>
          ))}
          <Link to="/profile" className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-white/20">
            View profile <ArrowRightIcon className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="spinner" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {statCards.map((card) => (
              <Link
                key={card.name}
                to={card.href}
                className="card card-hover flex items-center gap-4"
              >
                <div className={`stat-icon ${card.color}`}>
                  <card.icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">{card.name}</p>
                  <p className="text-2xl font-semibold text-slate-900">{card.value ?? 0}</p>
                </div>
              </Link>
            ))}
          </div>

          {/* Quick links */}
          <div className="mt-8">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Quick access</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {quickLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.href}
                  className="group card card-hover flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <link.icon className="h-5 w-5 text-slate-400 transition-colors group-hover:text-primary" />
                    <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">
                      {link.name}
                    </span>
                  </div>
                  <ArrowRightIcon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>

          {/* Recent activity */}
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
              <Link to="/audit" className="text-sm font-medium text-primary hover:text-primary-dark">
                View audit trail
              </Link>
            </div>
            <div className="card">
              {stats?.recentActions?.length ? (
                <ul className="divide-y divide-border">
                  {stats.recentActions.map((a: any) => (
                    <li key={a.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <span className="font-mono text-xs text-slate-700">{a.action}</span>
                        {a.detail && <span className="ml-2 text-slate-500">{a.detail}</span>}
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                        {new Date(a.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-sm text-slate-500">No recent activity recorded yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
