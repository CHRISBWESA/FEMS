import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  HomeIcon, UsersIcon, BuildingOfficeIcon, BuildingLibraryIcon, CalendarIcon,
  ChartBarIcon, CurrencyDollarIcon, BellIcon, ShieldCheckIcon,
  TrashIcon, ServerIcon, ComputerDesktopIcon, UserIcon,
  Bars3Icon, XMarkIcon, ArrowRightOnRectangleIcon,
  UserGroupIcon, BookOpenIcon, ClipboardDocumentCheckIcon, FaceSmileIcon,
  ChartPieIcon, RectangleGroupIcon, HeartIcon, CubeIcon, ArchiveBoxIcon, HandRaisedIcon, PresentationChartLineIcon, LifebuoyIcon, CreditCardIcon,
  GlobeAltIcon, IdentificationIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import axios from 'axios';
import { useOfflineSync } from '../offline/hooks';
import { onSignOut } from '../offline/session';
import { pendingCount } from '../offline/outbox';
import ImpersonationBanner, { SupportSessionBanner } from './platform/ImpersonationBanner';

interface NavItem {
  name: string;
  icon: React.ElementType;
  path: string;
  roles: string[];
  module?: string; // optional module a platform administrator can switch off per fellowship
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const ALL_NON_ADMIN_ROLES = [
  'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson',
  'treasurer', 'department_secretary', 'department_chairperson',
  'gender_leader', 'ordinary_member',
];

// Module availability is fetched once per page load rather than per navigation (see the effect below).
let profileLoaded = false;

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ name: 'Dashboard', icon: HomeIcon, path: '/dashboard', roles: [] }],
  },
  {
    title: 'Management',
    items: [
      { name: 'Members', icon: UsersIcon, path: '/members', roles: ['secretary', 'assistant_secretary'] },
      { name: 'Member Insights', icon: ChartPieIcon, path: '/members/insights', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson'], module: 'member_engagement' },
      { name: 'Member Groups', icon: RectangleGroupIcon, path: '/member-groups', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'], module: 'member_engagement' },
      { name: 'Programmes', icon: BookOpenIcon, path: '/programmes', roles: ['secretary'] },
      { name: 'Departments', icon: BuildingOfficeIcon, path: '/departments', roles: ['secretary', 'assistant_secretary'] },
      { name: 'Activities', icon: CalendarIcon, path: '/activities', roles: ALL_NON_ADMIN_ROLES },
      { name: 'Youth & Children', icon: FaceSmileIcon, path: '/youth', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson'], module: 'youth' },
      { name: 'Analytics', icon: PresentationChartLineIcon, path: '/analytics', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer', 'department_secretary', 'department_chairperson'], module: 'analytics' },
      { name: 'Reports', icon: ChartBarIcon, path: '/reports', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson'] },
      { name: 'Finance', icon: CurrencyDollarIcon, path: '/finance', roles: ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson'], module: 'finance' },
      { name: 'Resources', icon: CubeIcon, path: '/resources', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer', 'department_secretary', 'department_chairperson'], module: 'resources' },
      { name: 'Volunteering', icon: HandRaisedIcon, path: '/volunteering', roles: ALL_NON_ADMIN_ROLES, module: 'volunteers' },
      { name: 'IT Content', icon: ComputerDesktopIcon, path: '/it-content', roles: ALL_NON_ADMIN_ROLES },
      { name: 'My Website', icon: GlobeAltIcon, path: '/public-site', roles: ['it_admin', 'secretary', 'assistant_secretary'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { name: 'Approvals', icon: ClipboardDocumentCheckIcon, path: '/approvals', roles: ALL_NON_ADMIN_ROLES },
      // Where the fellowship administrator appoints the people who hold its offices. Separate from Users because
      // the two answer different questions: "who has an account" and "who has been invited to an office".
      { name: 'Appointments', icon: IdentificationIcon, path: '/appointments', roles: ['fellowship_admin', 'secretary'] },
      { name: 'Users', icon: UserGroupIcon, path: '/users', roles: ['admin', 'secretary', 'fellowship_admin'] },
    { name: 'Audit', icon: ShieldCheckIcon, path: '/audit', roles: ['admin', 'secretary', 'chairperson', 'assistant_chairperson'] },
    { name: 'Platform', icon: BuildingLibraryIcon, path: '/platform', roles: ['admin', 'platform_support'] },
      { name: 'Billing & plan', icon: CreditCardIcon, path: '/billing', roles: ['secretary'] },
      { name: 'Support Access', icon: LifebuoyIcon, path: '/support-access', roles: ['secretary'] },
    { name: 'Recycle Bin', icon: TrashIcon, path: '/recycle-bin', roles: ['secretary', 'assistant_secretary'] },
      { name: 'Backups', icon: ServerIcon, path: '/backups', roles: ['admin'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { name: 'My Giving', icon: HeartIcon, path: '/my-giving', roles: ALL_NON_ADMIN_ROLES, module: 'finance' },
      { name: 'Borrowed Items', icon: ArchiveBoxIcon, path: '/my-loans', roles: ALL_NON_ADMIN_ROLES, module: 'resources' },
      { name: 'Notifications', icon: BellIcon, path: '/notifications', roles: [] },
      { name: 'Profile', icon: UserIcon, path: '/profile', roles: [] },
    ],
  },
];

export default function Layout() {
  const { user, hasRole, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [disabledModules, setDisabledModules] = useState<string[]>([]);
  const location = useLocation();
  const offline = useOfflineSync(user?.id);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    // Once per session, not on every navigation: this ran on every route change and on its own was enough
    // traffic to exhaust the API rate limit during ordinary use. Session changes clear the cache.
    if (profileLoaded) return;
    profileLoaded = true;
    axios.get('/profile', { withCredentials: true }).then((res) => { setDisabledModules(res.data?.disabledModules || []); }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    axios
      .get('/notifications/unread-count', { withCredentials: true })
      .then((res) => {
        if (active && res.data?.count !== undefined) setUnreadCount(res.data.count);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.pathname]);

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => (item.roles.length === 0 || item.roles.some((r) => hasRole(r))) && !(item.module && disabledModules.includes(item.module)),
    ),
  })).filter((section) => section.items.length > 0);

  const handleLogout = async () => {
    // Unsynced offline check-ins would be lost: make that a conscious choice. Downloaded member lists are always wiped.
    let discard = false;
    if (user?.id) {
      const waiting = await pendingCount(user.id).catch(() => 0);
      if (waiting > 0) {
        if (!window.confirm(`${waiting} attendance check-in${waiting === 1 ? ' has' : 's have'} not been sent to the server yet. Signing out now will delete ${waiting === 1 ? 'it' : 'them'}. Sign out anyway?`)) return;
        discard = true;
      }
      await onSignOut(user.id, discard).catch(() => undefined);
    }
    await logout();
    navigate('/login');
  };

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';

  const renderNav = () => (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {visibleSections.map((section) => (
        <div key={section.title}>
          <p className="mb-1.5 px-3 text-xxs font-semibold uppercase tracking-wider text-slate-400">
            {section.title}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/members'}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1">{item.name}</span>
                {item.path === '/notifications' && unreadCount > 0 && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-xxs font-semibold text-white">
                    {unreadCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-white lg:flex">
        <Link to="/dashboard" className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-bold text-white">
            F
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Fellowship Manager</p>
            <p className="text-xxs text-slate-400">Church Administration</p>
          </div>
        </Link>
        {renderNav()}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <div className="avatar">{initials}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="truncate text-xxs capitalize text-slate-400">
                {user?.roles?.join(', ') || 'Member'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex h-full w-64 flex-col bg-white shadow-elevated">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-base font-bold text-white">
                  F
                </div>
                <p className="text-sm font-semibold text-slate-900">Fellowship Manager</p>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="p-1.5 text-slate-500 hover:text-slate-900">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {renderNav()}
            <div className="border-t border-border p-4">
              <button
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                <ArrowRightOnRectangleIcon className="h-5 w-5" />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="rounded-md p-2.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            >
              <Bars3Icon className="h-5 w-5" />
            </button>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-slate-900">
                {NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.path === location.pathname)?.name ||
                  (location.pathname.split('/')[1] || 'Dashboard')}
              </p>
              <p className="text-xxs text-slate-400">Fellowship Management System</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/notifications')}
              aria-label="Notifications"
              className="relative rounded-lg p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <BellIcon className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-xxs font-semibold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => navigate('/profile')}
              className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-slate-100"
            >
              <div className="avatar h-8 w-8 text-xs">{initials}</div>
              <div className="hidden text-left md:block">
                <p className="text-sm font-medium leading-tight text-slate-900">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xxs leading-tight text-slate-400">{user?.email}</p>
              </div>
            </button>
          </div>
        </header>

        {/* Admin acting as somebody else, and a client whose account a platform admin is acting as. Both are
          deliberately impossible to miss. */}
      <ImpersonationBanner />
      <SupportSessionBanner />

      {/* Offline / sync status */}
        {(!offline.online || offline.pending > 0) && (
          <div role="status" className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6 ${offline.online ? 'bg-amber-50 text-amber-900' : 'bg-slate-800 text-slate-100'}`}>
            <span>
              {!offline.online ? 'You are offline. ' : ''}
              {offline.pending > 0
                ? `${offline.pending} attendance check-in${offline.pending === 1 ? ' is' : 's are'} saved on this device and will be sent when you are online.`
                : 'Pages that need the server will not load until you reconnect.'}
              {offline.status === 'auth' && ' Your session ended: sign in again to send them.'}
              {offline.status === 'forbidden' && ' You no longer have permission to record attendance; open the activity to review them.'}
            </span>
            {offline.online && offline.pending > 0 && offline.status !== 'auth' && (
              <button className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50" onClick={() => offline.sync()} disabled={offline.syncing}>{offline.syncing ? 'Sending…' : 'Send now'}</button>
            )}
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
