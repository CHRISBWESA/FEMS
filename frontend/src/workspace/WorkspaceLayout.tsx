import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  HomeIcon, UsersIcon, CalendarDaysIcon, MegaphoneIcon, DocumentTextIcon, BanknotesIcon, WalletIcon, CubeIcon, IdentificationIcon,
  Cog6ToothIcon, Bars3Icon, XMarkIcon, ArrowRightOnRectangleIcon, BellIcon, SunIcon, MoonIcon, BuildingOfficeIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { Avatar, Button, EmptyState, ErrorState, PageLoader } from '../components/ui';
import { WorkspaceContext, WorkspaceDepartment, errMsg } from './shared';

function useLeaderDepartments() {
  const [departments, setDepartments] = useState<WorkspaceDepartment[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    axios.get('/department-workspace/me', { withCredentials: true })
      .then((r) => setDepartments(r.data.departments || []))
      .catch((e) => setError(errMsg(e, 'Could not load your departments.')));
  };
  useEffect(load, []);
  return { departments, error, reload: load };
}

/** /workspace: straight into the only department, or a choice when the leader leads several. */
export function WorkspaceRoot() {
  const { departments, error, reload } = useLeaderDepartments();
  const { t } = useI18n();
  const { logout } = useAuth();
  if (error) return <div className="mx-auto max-w-lg p-6"><ErrorState message={error} onRetry={reload} /></div>;
  if (!departments) return <PageLoader />;
  if (departments.length === 1) return <Navigate to={`/workspace/${departments[0].departmentId}`} replace />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="card card-pad w-full max-w-lg">
        <h1 className="text-lg font-semibold text-ink">{t('ws.workspace')}</h1>
        {departments.length === 0 ? (
          <EmptyState icon={<BuildingOfficeIcon className="h-8 w-8" />} title={t('ws.noDepartments')} action={<Button onClick={() => logout()}>{t('ws.logout')}</Button>} />
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-muted">{t('ws.chooseDepartment')}</p>
            <ul className="mt-4 space-y-2">
              {departments.map((d) => (
                <li key={d.departmentId}>
                  <Link to={`/workspace/${d.departmentId}`} className="card card-interactive flex items-center justify-between px-4 py-3">
                    <span className="font-medium text-ink">{d.name}</span>
                    <span className="text-xs text-ink-muted">{t(`ws.${d.role}`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

const NAV = [
  { key: 'ws.dashboard', path: '', icon: HomeIcon, end: true },
  { key: 'ws.members', path: 'members', icon: UsersIcon },
  { key: 'ws.activities', path: 'activities', icon: CalendarDaysIcon },
  { key: 'ws.announcements', path: 'announcements', icon: MegaphoneIcon },
  { key: 'ws.reports', path: 'reports', icon: DocumentTextIcon },
  { key: 'ws.money', path: 'money', icon: WalletIcon },
  { key: 'ws.resources', path: 'resources', icon: CubeIcon },
  { key: 'ws.finance', path: 'finance', icon: BanknotesIcon },
  { key: 'ws.leadership', path: 'leadership', icon: IdentificationIcon },
  { key: 'ws.account', path: 'account', icon: Cog6ToothIcon },
];

/** The department leader's workspace, separate from the fellowship administration screens. */
export default function WorkspaceLayout() {
  const { deptId = '' } = useParams();
  const { user, logout } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t, language, setLanguage } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { departments, error, reload } = useLeaderDepartments();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    axios.get('/notifications/unread-count', { withCredentials: true }).then((r) => setUnread(r.data?.count ?? 0)).catch(() => {});
  }, [location.pathname]);

  const department = departments?.find((d) => d.departmentId === deptId) ?? null;
  const ctx = useMemo(() => department && departments ? {
    department,
    departments,
    base: `/department-workspace/${department.departmentId}`,
    path: (p = '') => `/workspace/${department.departmentId}${p ? `/${p}` : ''}`,
  } : null, [department, departments]);

  if (error) return <div className="mx-auto max-w-lg p-6"><ErrorState message={error} onRetry={reload} /></div>;
  if (!departments) return <PageLoader />;
  // Not (or no longer) a leader of this department: back to the choice, which explains if there is none.
  if (!department || !ctx) return <Navigate to="/workspace" replace />;

  const signOut = async () => { await logout(); navigate('/login'); };
  const current = NAV.find((n) => (n.path ? location.pathname.startsWith(ctx.path(n.path)) : location.pathname === ctx.path()));

  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Department workspace">
      {departments.length > 1 && (
        <label className="mb-4 block px-1">
          <span className="sr-only">{t('ws.chooseDepartment')}</span>
          <select className="select w-full" value={department.departmentId} onChange={(e) => navigate(`/workspace/${e.target.value}`)}>
            {departments.map((d) => <option key={d.departmentId} value={d.departmentId}>{d.name}</option>)}
          </select>
        </label>
      )}
      <div className="space-y-0.5">
        {NAV.map((n) => (
          <NavLink
            key={n.key}
            to={ctx.path(n.path)}
            end={n.end}
            className={({ isActive }) => `group flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors duration-150 ${isActive ? 'bg-primary text-white shadow-card' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'}`}
          >
            <n.icon className="h-5 w-5 shrink-0" />
            <span className="flex-1 truncate">{t(n.key)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );

  const brand = (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold tracking-tight text-ink">{department.name}</p>
      <p className="truncate text-xxs text-ink-subtle">{t(`ws.${department.role}`)}</p>
    </div>
  );

  return (
    <WorkspaceContext.Provider value={ctx}>
      <a href="#ws-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 z-50 btn btn-primary">Skip to main content</a>
      <div className="flex h-dvh bg-canvas print:block print:h-auto">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-hairline bg-surface lg:flex print:hidden">
          <Link to={ctx.path()} className="flex items-center gap-2.5 border-b border-hairline px-5 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-control bg-primary text-base font-bold text-white">{department.name.slice(0, 1).toUpperCase()}</div>
            {brand}
          </Link>
          {nav}
          <div className="border-t border-hairline p-3">
            <div className="flex items-center gap-3 rounded-control px-2 py-1.5">
              <Avatar name={`${user?.firstName || ''} ${user?.lastName || ''}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{user?.firstName} {user?.lastName}</p>
                <p className="truncate text-xxs text-ink-subtle">{user?.email}</p>
              </div>
              <button onClick={signOut} title={t('ws.logout')} aria-label={t('ws.logout')} className="btn btn-ghost btn-sm px-2"><ArrowRightOnRectangleIcon className="h-5 w-5" /></button>
            </div>
          </div>
        </aside>

        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <div className="fixed inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
            <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-overlay">
              <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
                {brand}
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="btn btn-ghost btn-sm px-2"><XMarkIcon className="h-5 w-5" /></button>
              </div>
              {nav}
              <div className="border-t border-hairline p-4">
                <button onClick={signOut} className="btn btn-secondary btn-block"><ArrowRightOnRectangleIcon className="h-5 w-5" /> {t('ws.logout')}</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-hairline bg-surface/90 px-4 backdrop-blur sm:px-6 print:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="btn btn-ghost btn-sm px-2 lg:hidden"><Bars3Icon className="h-5 w-5" /></button>
              <h1 className="truncate text-sm font-semibold text-ink">{current ? t(current.key) : t('ws.workspace')}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => navigate(ctx.path('notifications'))} aria-label={unread ? `${t('ws.notifications')}, ${unread}` : t('ws.notifications')} className="btn btn-ghost btn-sm relative px-2">
                <BellIcon className="h-5 w-5" />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xxs font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
              </button>
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} className="btn btn-ghost btn-sm p-2">
                {resolvedTheme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
              </button>
              <button onClick={() => setLanguage(language === 'sw' ? 'en' : 'sw')} aria-label={language === 'sw' ? 'Switch to English' : 'Badilisha lugha hadi Kiswahili'} className="btn btn-ghost btn-sm px-2 py-1.5">
                {language === 'sw' ? 'EN' : 'SW'}
              </button>
            </div>
          </header>
          <main id="ws-main" className="flex-1 overflow-y-auto print:overflow-visible p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
