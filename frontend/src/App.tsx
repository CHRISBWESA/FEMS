import React, { createContext, useContext, useState, useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { decodeJwtPayload } from './lib/axios';
import Layout from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './context/I18nContext';
import { MembersProvider } from './context/MembersContext';
import Login from './pages/Login';
import ForcePasswordChange from './pages/ForcePasswordChange';
import NotFound from './pages/NotFound';
import { DEPARTMENT_LEADER_ROLES, isDepartmentLeaderOnly } from './lib/roles';
import { CENTRAL_FINANCE_ROLES, RESOURCE_CENTRAL_ROLES } from './lib/area-roles';
import PageLoading from './components/PageLoading';
import { lazyPage } from './lib/lazy-page';
import { clearProfile, loadProfile } from './lib/profile';

// Each page is downloaded the first time it is opened, so signing in only needs the shell, not the whole app.
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const Members = lazyPage(() => import('./pages/Members'));
const MemberDetail = lazyPage(() => import('./pages/MemberDetail'));
const Programmes = lazyPage(() => import('./pages/Programmes'));
const Departments = lazyPage(() => import('./pages/Departments'));
const DepartmentDetail = lazyPage(() => import('./pages/DepartmentDetail'));
const Activities = lazyPage(() => import('./pages/Activities'));
const ActivityDetail = lazyPage(() => import('./pages/ActivityDetail'));
const Reports = lazyPage(() => import('./pages/Reports'));
const FinanceArea = lazyPage(() => import('./fin/FinanceArea'));
const WsMoney = lazyPage(() => import('./fin/WsMoney'));
const Notifications = lazyPage(() => import('./pages/Notifications'));
const Audit = lazyPage(() => import('./pages/Audit'));
const RecycleBin = lazyPage(() => import('./pages/RecycleBin'));
const Backups = lazyPage(() => import('./pages/Backups'));
const ItContent = lazyPage(() => import('./pages/ItContent'));
const Profile = lazyPage(() => import('./pages/Profile'));
const DepartmentAnnouncements = lazyPage(() => import('./pages/DepartmentAnnouncements'));
const DepartmentReviews = lazyPage(() => import('./pages/DepartmentReviews'));
const WorkspaceLayout = lazyPage(() => import('./workspace/WorkspaceLayout'));
const WorkspaceRoot = lazyPage(() => import('./workspace/WorkspaceLayout').then((m) => ({ default: m.WorkspaceRoot })));
const WsDashboard = lazyPage(() => import('./workspace/WsDashboard'));
const WsMembers = lazyPage(() => import('./workspace/WsMembers'));
const WsActivities = lazyPage(() => import('./workspace/WsActivities'));
const WsReports = lazyPage(() => import('./workspace/WsReports'));
const WsFinance = lazyPage(() => import('./workspace/WsFinance'));
const WsAnnouncements = lazyPage(() => import('./workspace/WsPages').then((m) => ({ default: m.WsAnnouncements })));
const WsLeadership = lazyPage(() => import('./workspace/WsPages').then((m) => ({ default: m.WsLeadership })));
const WsAccount = lazyPage(() => import('./workspace/WsPages').then((m) => ({ default: m.WsAccount })));
const Users = lazyPage(() => import('./pages/Users'));
const Platform = lazyPage(() => import('./pages/Platform'));
const PlatformTenant = lazyPage(() => import('./pages/PlatformTenant'));
const Youth = lazyPage(() => import('./pages/Youth'));
const YouthDetail = lazyPage(() => import('./pages/YouthDetail'));
const YouthAgeGroups = lazyPage(() => import('./pages/YouthAgeGroups'));
const YouthPrograms = lazyPage(() => import('./pages/YouthPrograms'));
const YouthReports = lazyPage(() => import('./pages/YouthReports'));
const MemberInsights = lazyPage(() => import('./pages/MemberInsights'));
const MemberGroups = lazyPage(() => import('./pages/MemberGroups'));
const MemberGroupDetail = lazyPage(() => import('./pages/MemberGroupDetail'));
const MyGiving = lazyPage(() => import('./pages/MyGiving'));
const InventoryArea = lazyPage(() => import('./inv/InventoryArea'));
const WsResources = lazyPage(() => import('./inv/WsResources'));
const Leadership = lazyPage(() => import('./pages/Leadership'));
const MyLoans = lazyPage(() => import('./pages/MyLoans'));
const Volunteering = lazyPage(() => import('./pages/Volunteering'));
const VolunteerOpportunity = lazyPage(() => import('./pages/VolunteerOpportunity'));
const PlatformSite = lazyPage(() => import('./site/PlatformSite'));
const FellowshipSite = lazyPage(() => import('./fellowship-site/FellowshipSite'));
const PublicSiteAdmin = lazyPage(() => import('./pages/PublicSiteAdmin'));
const AcceptInvitation = lazyPage(() => import('./pages/AcceptInvitation'));
const Register = lazyPage(() => import('./pages/Register'));

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (role: string) => boolean;
  hasPermission: (permission: string) => boolean;
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoading fullScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.mustChangePassword) return <ForcePasswordChange onDone={() => window.location.reload()} />;
  return children;
}

function RequireRole({ roles, children }: { roles: string[]; children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.some(r => user.roles.includes(r))) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Whether this hostname serves the application or the platform's marketing site.
 *
 * In production the apex (`example.com`) is the marketing site and the app is on `app.example.com`; a fellowship's
 * own subdomain serves its landing page. In development every host is `localhost`, so the answer has to be "app",
 * or nobody could ever reach `/site` by typing a host. The site stays reachable by path either way, which is what
 * the local development flow and the tests use.
 */
function isAppHost(): boolean {
  const host = window.location.hostname.toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  // A bare IPv4 address is a development machine, not a public apex.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // An explicit override wins: hosting that does not put the app on an `app.` subdomain needs to say so.
  const forced = String(import.meta.env.VITE_APP_HOST || '').trim().toLowerCase();
  if (forced) return host === forced;
  // A hosting deployment host serves the application itself. Only a custom domain carries the marketing apex, and
  // `*.vercel.app` is not a custom domain, so it must not be mistaken for one.
  if (host.endsWith('.vercel.app')) return true;
  // A multi-label host is a real apex only if it has at least a domain and a TLD, e.g. example.com.
  const labels = host.split('.');
  const isApex = labels.length >= 2 && /^[a-z]{2,}$/.test(labels[labels.length - 1]);
  if (!isApex) return true;
  return host === 'app.' + labels.slice(1).join('.') || host.startsWith('app.');
}

/**
 * The frame around every signed-in route.
 *
 * On the app's own host this is the authenticated shell. On the apex it is the platform's marketing site, rendered
 * in place of the app entirely — which is why the decision is made here, above `RequireAuth`, rather than inside
 * the index route: a visitor who has never signed in must reach the marketing home page without being bounced to
 * the login form first.
 */
function AppRoot() {
  if (!isAppHost()) {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/site" replace />} />
        <Route path="*" element={<PlatformSite />} />
      </Routes>
    );
  }
  return <RequireAuth><Layout /></RequireAuth>;
}

/** Sends anyone holding one of these roles back to the dashboard. */
function HideFor({ roles, children }: { roles: string[]; children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles.some(r => user.roles.includes(r))) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// Administration pages are for the super admin (the platform `admin` role) only.
const SUPER_ADMIN = ['admin'];

// Pages the Secretary does not use. The sidebar hides the same ones (Layout.tsx).
const NOT_SECRETARY = ['secretary'];


/** Sends department leaders (who hold no other office) to their workspace instead of the administration screens. */
function LeaderHome({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user && isDepartmentLeaderOnly(user.roles)) return <Navigate to="/workspace" replace />;
  return children;
}

function ExcludeAdmin({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.roles.includes('admin')) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      const payload = decodeJwtPayload(token);
      if (!payload) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        setUser(null);
        setLoading(false);
        return;
      }
      setUser({
        id: payload.sub,
        email: payload.email,
        firstName: '',
        lastName: '',
        roles: payload.roles || [],
        permissions: payload.permissions || [],
        mustChangePassword: !!payload.mustChangePassword,
      });
      try {
        const profile = { data: await loadProfile() };
        setUser((current) => current ? {
          ...current,
          id: profile.data.id || current.id,
          email: profile.data.email || current.email,
          firstName: profile.data.firstName || current.firstName,
          lastName: profile.data.lastName || current.lastName,
          roles: profile.data.roles || current.roles,
          permissions: profile.data.permissions || current.permissions,
          mustChangePassword: !!profile.data.mustChangePassword,
        } : current);
      } catch {
        // Keep the decoded session for offline startup; protected API calls remain server-authorized.
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await axios.post('/auth/login', { email, password }, { withCredentials: true });
    if (res.data.accessToken) {
      localStorage.setItem('accessToken', res.data.accessToken);
    }
    if (res.data.refreshToken) {
      localStorage.setItem('refreshToken', res.data.refreshToken);
    }
    setUser({ ...res.data.user, mustChangePassword: !!res.data.user?.mustChangePassword });
  };

  const logout = async () => {
    try {
      await axios.post('/auth/logout', {}, { withCredentials: true });
    } catch {
      // ignore logout network errors
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    clearProfile();
    setUser(null);
  };

  const hasRole = (role: string) => user?.roles.includes(role) ?? false;
  const hasPermission = (permission: string) => user?.permissions?.includes(permission) ?? false;
  const isAdmin = () => hasRole('admin');

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    hasRole,
    hasPermission,
    isAdmin,
  };

  return (
    <AuthContext.Provider value={value}>
      <ThemeProvider>
        <I18nProvider>
          <MembersProvider>
            <Router>
        <Suspense fallback={<PageLoading fullScreen />}>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" replace />} />
          <Route path="/register" element={!user ? <Register /> : <Navigate to="/dashboard" replace />} />
          {/* Unauthenticated on purpose: the person arriving has never signed in, which is what an invitation is for.
              The token in the URL is the entire authorisation, and it is single use. */}
          <Route path="/invite/:token" element={<AcceptInvitation />} />
          {/* The two public sites. `/site` is the platform's own marketing site; `/f/:subdomain` is one fellowship's
              landing page. Both are reachable by path in every environment. On the apex domain in production,
              `/` below sends a visitor to the marketing site instead of the app, so the front door of the platform
              is its own home page. */}
          <Route path="/site/*" element={<PlatformSite />} />
          <Route path="/f/:subdomain/*" element={<FellowshipSite />} />
          {/* The department leaders' workspace: its own layout, separate from the fellowship administration. */}
          <Route path="/workspace" element={<RequireAuth><RequireRole roles={DEPARTMENT_LEADER_ROLES}><WorkspaceRoot /></RequireRole></RequireAuth>} />
          <Route path="/workspace/:deptId" element={<RequireAuth><RequireRole roles={DEPARTMENT_LEADER_ROLES}><WorkspaceLayout /></RequireRole></RequireAuth>}>
            <Route index element={<WsDashboard />} />
            <Route path="members" element={<WsMembers />} />
            <Route path="activities" element={<WsActivities />} />
            <Route path="announcements" element={<WsAnnouncements />} />
            <Route path="reports" element={<WsReports />} />
            <Route path="finance" element={<WsFinance />} />
            <Route path="money/*" element={<WsMoney />} />
            <Route path="resources/*" element={<WsResources />} />
            <Route path="leadership" element={<WsLeadership />} />
            <Route path="account" element={<WsAccount />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="/" element={<AppRoot />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<LeaderHome><Dashboard /></LeaderHome>} />
            <Route path="department-announcements" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary']}><DepartmentAnnouncements /></RequireRole></ExcludeAdmin>} />
            <Route path="department-reviews" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer']}><DepartmentReviews /></RequireRole></ExcludeAdmin>} />
            <Route path="members" element={<ExcludeAdmin><Members /></ExcludeAdmin>} />
            <Route path="members/insights" element={<ExcludeAdmin><MemberInsights /></ExcludeAdmin>} />
            <Route path="members/:id" element={<ExcludeAdmin><MemberDetail /></ExcludeAdmin>} />
            <Route path="member-groups" element={<ExcludeAdmin><MemberGroups /></ExcludeAdmin>} />
            <Route path="member-groups/:id" element={<ExcludeAdmin><MemberGroupDetail /></ExcludeAdmin>} />
            <Route path="programmes" element={<ExcludeAdmin><RequireRole roles={['secretary']}>{<Programmes />}</RequireRole></ExcludeAdmin>} />
            <Route path="departments" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary']}><Departments /></RequireRole></ExcludeAdmin>} />
            <Route path="departments/:id" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary']}><DepartmentDetail /></RequireRole></ExcludeAdmin>} />
            <Route path="activities" element={<ExcludeAdmin><Activities /></ExcludeAdmin>} />
            <Route path="activities/:id" element={<ExcludeAdmin><ActivityDetail /></ExcludeAdmin>} />
            <Route path="reports" element={<ExcludeAdmin><Reports /></ExcludeAdmin>} />
            <Route path="finance/*" element={<ExcludeAdmin><RequireRole roles={CENTRAL_FINANCE_ROLES}>{<FinanceArea />}</RequireRole></ExcludeAdmin>} />
            <Route path="my-giving" element={<ExcludeAdmin><MyGiving /></ExcludeAdmin>} />
            <Route path="leadership" element={<ExcludeAdmin><RequireRole roles={['fellowship_admin', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer']}><Leadership /></RequireRole></ExcludeAdmin>} />
            <Route path="inventory/*" element={<ExcludeAdmin><RequireRole roles={RESOURCE_CENTRAL_ROLES}>{<InventoryArea />}</RequireRole></ExcludeAdmin>} />
            {/* Old links keep working. */}
            <Route path="resources" element={<Navigate to="/inventory" replace />} />
            <Route path="resources/:id" element={<Navigate to="/inventory/inventory" replace />} />
            <Route path="my-loans" element={<ExcludeAdmin><MyLoans /></ExcludeAdmin>} />
            <Route path="volunteering" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><Volunteering /></ExcludeAdmin></HideFor>} />
            <Route path="volunteering/:id" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><VolunteerOpportunity /></ExcludeAdmin></HideFor>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="audit" element={<RequireRole roles={SUPER_ADMIN}>{<Audit />}</RequireRole>} />
            <Route path="recycle-bin" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary']}>{<RecycleBin />}</RequireRole></ExcludeAdmin>} />
            <Route path="backups" element={<RequireRole roles={SUPER_ADMIN}>{<Backups />}</RequireRole>} />
            <Route path="it-content" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><ItContent /></ExcludeAdmin></HideFor>} />
            {/* The content manager's own screen. `admin` is deliberately absent, matching the IT Content page: the
                platform administrator runs the platform, and a tenant's public site is the tenant's business. */}
            <Route path="public-site" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><RequireRole roles={['it_admin', 'secretary', 'assistant_secretary']}><PublicSiteAdmin /></RequireRole></ExcludeAdmin></HideFor>} />
            <Route path="youth" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><Youth /></ExcludeAdmin></HideFor>} />
            <Route path="youth/age-groups" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><RequireRole roles={['secretary']}>{<YouthAgeGroups />}</RequireRole></ExcludeAdmin></HideFor>} />
            <Route path="youth/programs" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><YouthPrograms /></ExcludeAdmin></HideFor>} />
            <Route path="youth/reports" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><YouthReports /></ExcludeAdmin></HideFor>} />
            <Route path="youth/:id" element={<HideFor roles={NOT_SECRETARY}><ExcludeAdmin><YouthDetail /></ExcludeAdmin></HideFor>} />
            <Route path="users" element={<RequireRole roles={SUPER_ADMIN}>{<Users />}</RequireRole>} />
            <Route path="platform" element={<RequireRole roles={SUPER_ADMIN}>{<Platform />}</RequireRole>} />
            <Route path="platform/tenants/:id" element={<RequireRole roles={SUPER_ADMIN}>{<PlatformTenant />}</RequireRole>} />
            <Route path="fellowships" element={<Navigate to="/platform" replace />} />
            <Route path="profile" element={<Profile />} />
            {/* Any address inside the authenticated shell that matches nothing above. */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        </Suspense>
      </Router>
        </MembersProvider>
      </I18nProvider>
      </ThemeProvider>
    </AuthContext.Provider>
  );
}
