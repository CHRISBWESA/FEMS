import { useState, useEffect, Suspense } from 'react';
import PageLoading from './PageLoading';
import { loadProfile } from '../lib/profile';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  HomeIcon,
  UsersIcon,
  BuildingOfficeIcon,
  BuildingLibraryIcon,
  CalendarIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  ReceiptPercentIcon,
  DocumentChartBarIcon,
  Cog6ToothIcon,
  IdentificationIcon,
  BellIcon,
  ShieldCheckIcon,
  TrashIcon,
  ServerIcon,
  ComputerDesktopIcon,
  UserIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowRightOnRectangleIcon,
  UserGroupIcon,
  BookOpenIcon,
  FaceSmileIcon,
  ClipboardDocumentCheckIcon,
  MegaphoneIcon,
  Squares2X2Icon,
  ChartPieIcon,
  RectangleGroupIcon,
  HeartIcon,
  CubeIcon,
  HandRaisedIcon,
  GlobeAltIcon,
  SunIcon,
  MoonIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import axios from 'axios';
import { useOnline } from '../offline/hooks';
import { onSignOut } from '../offline/session';
import ImpersonationBanner, { SupportSessionBanner } from './platform/ImpersonationBanner';
import { Avatar } from './ui';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

interface NavItem {
  name: string;
  icon: React.ElementType;
  path: string;
  roles: string[];
  module?: string; // optional module a platform administrator can switch off per fellowship
  hideFor?: string[]; // roles that never see this item, even if another of their roles would allow it
  group?: keyof typeof NAV_GROUPS; // shown inside this collapsible group (when the person sees more than one of its pages)
}

// Related pages share one collapsible entry in the sidebar. A group that would hold a single visible page is shown
// as that page instead, so nobody gets a dropdown with one item.
const NAV_GROUPS = {
  members: { name: 'Members', icon: UsersIcon },
  departments: { name: 'Departments', icon: BuildingOfficeIcon },
  finance: { name: 'Finance & Resources', icon: CurrencyDollarIcon },
} as const;

// Pages the Secretary does not use. App.tsx blocks the same routes with <HideFor>.
const NOT_SECRETARY = ['secretary'];

interface NavSection {
  title: string;
  items: NavItem[];
}

const ALL_NON_ADMIN_ROLES = [
  'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson',
  'treasurer', 'department_secretary', 'department_chairperson',
  'gender_leader', 'ordinary_member',
];


// The unread badge's last value, kept for the current session only (keyed by its access token).
const UNREAD_REFRESH_MS = 30_000;
let unreadCache: { token: string | null; at: number; count: number } | null = null;
const sessionToken = () => { try { return localStorage.getItem('accessToken'); } catch { return null; } };

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ name: 'Dashboard', icon: HomeIcon, path: '/dashboard', roles: [] }],
  },
  {
    title: 'Management',
    items: [
      { name: 'All Members', icon: UsersIcon, path: '/members', roles: ['secretary', 'assistant_secretary'], group: 'members' },
      { name: 'Member Groups', icon: RectangleGroupIcon, path: '/member-groups', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'], module: 'member_engagement', group: 'members' },
      { name: 'Member Insights', icon: ChartPieIcon, path: '/members/insights', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson'], module: 'member_engagement', group: 'members' },
      { name: 'Programmes', icon: BookOpenIcon, path: '/programmes', roles: ['secretary'] },
      { name: 'All Departments', icon: BuildingOfficeIcon, path: '/departments', roles: ['secretary', 'assistant_secretary'], group: 'departments' },
      { name: 'Department Reviews', icon: ClipboardDocumentCheckIcon, path: '/department-reviews', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer'], group: 'departments' },
      { name: 'Dept. Announcements', icon: MegaphoneIcon, path: '/department-announcements', roles: ['secretary', 'assistant_secretary'], group: 'departments' },
      { name: 'Department Workspace', icon: Squares2X2Icon, path: '/workspace', roles: ['department_chairperson', 'department_secretary'] },
      { name: 'Activities', icon: CalendarIcon, path: '/activities', roles: ALL_NON_ADMIN_ROLES },
      { name: 'Youth & Children', icon: FaceSmileIcon, path: '/youth', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson'], module: 'youth', hideFor: NOT_SECRETARY },
      { name: 'Reports', icon: ChartBarIcon, path: '/reports', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson'] },
      { name: 'Leadership', icon: IdentificationIcon, path: '/leadership', roles: ['fellowship_admin', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer'] },
      { name: 'Dashboard', icon: ChartPieIcon, path: '/finance', roles: ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'], module: 'finance', group: 'finance' },
      { name: 'Contribution Drives', icon: HandRaisedIcon, path: '/finance/contributions', roles: ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'], module: 'finance', group: 'finance' },
      { name: 'Expenses', icon: ReceiptPercentIcon, path: '/finance/expenses', roles: ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'], module: 'finance', group: 'finance' },
      { name: 'Reports', icon: DocumentChartBarIcon, path: '/finance/reports', roles: ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'], module: 'finance', group: 'finance' },
      { name: 'Settings', icon: Cog6ToothIcon, path: '/finance/settings', roles: ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'], module: 'finance', group: 'finance' },
      { name: 'Resources', icon: CubeIcon, path: '/inventory', roles: ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer'], module: 'resources', group: 'finance' },
      { name: 'Volunteering', icon: HandRaisedIcon, path: '/volunteering', roles: ALL_NON_ADMIN_ROLES, module: 'volunteers', hideFor: NOT_SECRETARY },
      { name: 'IT Content', icon: ComputerDesktopIcon, path: '/it-content', roles: ALL_NON_ADMIN_ROLES, hideFor: NOT_SECRETARY },
      { name: 'My Website', icon: GlobeAltIcon, path: '/public-site', roles: ['it_admin', 'secretary', 'assistant_secretary'], hideFor: NOT_SECRETARY },
      { name: 'Recycle Bin', icon: TrashIcon, path: '/recycle-bin', roles: ['secretary', 'assistant_secretary'] },
    ],
  },
  {
    title: 'Administration',
    // Super admin (the platform `admin` role) only.
    items: [
      { name: 'Users', icon: UserGroupIcon, path: '/users', roles: ['admin'] },
      { name: 'Audit', icon: ShieldCheckIcon, path: '/audit', roles: ['admin'] },
      { name: 'Platform', icon: BuildingLibraryIcon, path: '/platform', roles: ['admin'] },
      { name: 'Backups', icon: ServerIcon, path: '/backups', roles: ['admin'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { name: 'My Giving', icon: HeartIcon, path: '/my-giving', roles: ALL_NON_ADMIN_ROLES, module: 'finance' },
      { name: 'Notifications', icon: BellIcon, path: '/notifications', roles: [] },
      { name: 'Profile', icon: UserIcon, path: '/profile', roles: [] },
    ],
  },
];

export default function Layout() {
  const { user, hasRole, logout } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { language, setLanguage, t } = useI18n();
  const { isInstallable, isInstalled, install } = useInstallPrompt();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Groups the person opened or closed themselves; otherwise a group is open while one of its pages is showing.
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('fems.navGroups') || '{}'); } catch { return {}; }
  });
  const toggleGroup = (key: string, open: boolean) => {
    const next = { ...groupOpen, [key]: !open };
    setGroupOpen(next);
    try { localStorage.setItem('fems.navGroups', JSON.stringify(next)); } catch { /* private window: keep it in memory */ }
  };
  const [unreadCount, setUnreadCount] = useState(() => (unreadCache && unreadCache.token === sessionToken() ? unreadCache.count : 0));
  const [disabledModules, setDisabledModules] = useState<string[]>([]);
  const location = useLocation();
  const online = useOnline();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Close mobile drawer on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    // Once per session, not on every navigation, and shared with app start-up (one request, see lib/profile).
    let active = true;
    loadProfile().then((p) => { if (active) setDisabledModules(p?.disabledModules || []); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // The badge is refreshed on navigation, but at most every 30 seconds (it used to cost one request per page
    // change). Opening Notifications always refreshes it, since that is where the count changes.
    const now = Date.now();
    const token = sessionToken();
    const fresh = unreadCache && unreadCache.token === token && now - unreadCache.at < UNREAD_REFRESH_MS;
    if (fresh && !location.pathname.startsWith('/notifications')) return;
    unreadCache = { token, at: now, count: unreadCache?.token === token ? unreadCache.count : 0 };
    let active = true;
    axios
      .get('/notifications/unread-count', { withCredentials: true })
      .then((res) => {
        if (res.data?.count === undefined) return;
        unreadCache = { token, at: Date.now(), count: res.data.count };
        if (active) setUnreadCount(res.data.count);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.pathname]);

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => (item.roles.length === 0 || item.roles.some((r) => hasRole(r))) && !item.hideFor?.some((r) => hasRole(r)) && !(item.module && disabledModules.includes(item.module)),
    ),
  })).filter((section) => section.items.length > 0);

  const handleLogout = async () => {
    // Clears anything a device kept from the old offline check-in feature.
    if (user?.id) await onSignOut(user.id, true).catch(() => undefined);
    await logout();
    navigate('/login');
  };

  // The word for the signed-in person, used by the current-page heading so it never disagrees with the sidebar.
  const currentItem = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.path === location.pathname);

  const navLink = (item: NavItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={item.path === '/members' || item.path === '/finance'}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors duration-150 ${
          isActive
            ? 'bg-primary text-white shadow-card'
            : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
        }`
      }
    >
      <item.icon className="h-5 w-5 shrink-0" />
      <span className="flex-1 truncate">{item.name}</span>
      {item.path === '/notifications' && unreadCount > 0 && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-xxs font-semibold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </NavLink>
  );

  const navList = () => (
    <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-5">
      {visibleSections.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-xxs font-semibold uppercase tracking-wider text-ink-subtle">{section.title}</p>
          <div className="space-y-0.5">
            {section.items.map((item, i) => {
              if (item.group) {
                const members = section.items.filter((x) => x.group === item.group);
                if (members.length > 1) {
                  if (section.items.findIndex((x) => x.group === item.group) !== i) return null; // rendered with its group
                  const g = NAV_GROUPS[item.group];
                  const active = members.some((x) => (x.path === '/members' ? location.pathname === '/members' || /^\/members\/(?!insights)/.test(location.pathname) : location.pathname === x.path || location.pathname.startsWith(`${x.path}/`)));
                  const open = groupOpen[item.group] ?? active;
                  const id = `nav-group-${item.group}`;
                  return (
                    <div key={item.group}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={id}
                        onClick={() => toggleGroup(item.group!, open)}
                        className={`group flex w-full items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors duration-150 ${active ? 'text-primary' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'}`}
                      >
                        <g.icon className="h-5 w-5 shrink-0" />
                        <span className="flex-1 text-left leading-snug">{g.name}</span>
                        <ChevronDownIcon className={`h-4 w-4 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
                      </button>
                      {open && (
                        <div id={id} className="ml-5 mt-0.5 space-y-0.5 border-l border-hairline pl-2">
                          {members.map((child) => navLink(child))}
                        </div>
                      )}
                    </div>
                  );
                }
              }
              return navLink(item);
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 btn btn-primary">Skip to main content</a>
      <div className="flex h-dvh bg-canvas">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-hairline bg-surface lg:flex">
        <Link to="/dashboard" className="flex items-center gap-2.5 border-b border-hairline px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-control bg-primary text-base font-bold text-white">
            F
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-ink">Fellowship Manager</p>
            <p className="truncate text-xxs text-ink-subtle">Church Administration</p>
          </div>
        </Link>
        {navList()}
        <div className="border-t border-hairline p-3">
          <div className="flex items-center gap-3 rounded-control px-2 py-1.5">
            <Avatar name={`${user?.firstName || ''} ${user?.lastName || ''}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="truncate text-xxs capitalize text-ink-subtle">{user?.roles?.join(', ') || 'Member'}</p>
            </div>
            <button onClick={handleLogout} title="Log out" aria-label="Log out" className="btn btn-ghost btn-sm px-2">
              <ArrowRightOnRectangleIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="fixed inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={() => setSidebarOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-overlay" tabIndex={-1} ref={(el) => { if (el) el.focus(); }}>
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-control bg-primary text-sm font-bold text-white">
                  F
                </div>
                <p className="text-sm font-semibold text-ink">Fellowship Manager</p>
              </div>
              <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="btn btn-ghost btn-sm px-2">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {navList()}
            <div className="border-t border-hairline p-4">
              <button onClick={handleLogout} className="btn btn-secondary btn-block">
                <ArrowRightOnRectangleIcon className="h-5 w-5" />
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-hairline bg-surface/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              aria-expanded={sidebarOpen}
              className="btn btn-ghost btn-sm px-2 lg:hidden"
            >
              <Bars3Icon className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-ink">{currentItem?.name || 'Fellowship Manager'}</h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => navigate('/notifications')}
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              className="btn btn-ghost btn-sm relative px-2"
            >
              <BellIcon className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xxs font-semibold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Theme Switch */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="btn btn-ghost btn-sm p-2"
                title={theme === 'dark' ? t('settings.light') : t('settings.dark')}
              >
                {resolvedTheme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
              </button>
            </div>

            {/* Language Switch */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLanguage(language === 'sw' ? 'en' : 'sw')}
                aria-label={language === 'sw' ? 'Switch to English' : 'Badilisha lugha hadi Kiswahili'}
                className="btn btn-ghost btn-sm px-2 py-1.5"
              >
                {language === 'sw' ? 'EN' : 'SW'}
              </button>
            </div>

            {/* PWA Install Button */}
            {isInstallable && !isInstalled && (
              <button
                onClick={install}
                aria-label="Install Fellowship Manager app"
                className="btn btn-primary px-3 py-1.5 flex items-center gap-1.5"
                title="Install Fellowship Manager"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline text-sm font-medium">Install App</span>
              </button>
            )}

            <button onClick={() => navigate('/profile')} className="flex items-center gap-2 rounded-control p-1.5 transition-colors hover:bg-surface-sunken">
              <Avatar name={`${user?.firstName || ''} ${user?.lastName || ''}`} size="sm" />
              <span className="hidden min-w-0 text-left md:block">
                <span className="block truncate text-sm font-medium leading-tight text-ink">
                  {user?.firstName} {user?.lastName}
                </span>
                <span className="block truncate text-xxs leading-tight text-ink-subtle">{user?.email}</span>
              </span>
            </button>
          </div>
        </header>

        {/* Admin acting as somebody else, and a client whose account a platform admin is acting as. Both are
          deliberately impossible to miss. */}
      <ImpersonationBanner />
      <SupportSessionBanner />

      {/* Offline status */}
        {!online && (
          <div role="status" className="bg-ink px-4 py-2.5 text-sm text-white sm:px-6">
            You are offline. Pages that need the server will not load until you reconnect.
          </div>
        )}

        {/* Main content */}
        <main id="main-content" tabIndex={0} className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
          <Suspense fallback={<PageLoading />}><Outlet /></Suspense>
        </main>
       </div>
      </div>
    </>
  );
}
