import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { decodeJwtPayload } from './lib/axios';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import MemberDetail from './pages/MemberDetail';
import Programmes from './pages/Programmes';
import Departments from './pages/Departments';
import DepartmentDetail from './pages/DepartmentDetail';
import Activities from './pages/Activities';
import ActivityDetail from './pages/ActivityDetail';
import Reports from './pages/Reports';
import Finance from './pages/Finance';
import Notifications from './pages/Notifications';
import Audit from './pages/Audit';
import RecycleBin from './pages/RecycleBin';
import Backups from './pages/Backups';
import ItContent from './pages/ItContent';
import Profile from './pages/Profile';
import Users from './pages/Users';
import Approvals from './pages/Approvals';
import Platform from './pages/Platform';
import PlatformTenant from './pages/PlatformTenant';
import SupportAccess from './pages/SupportAccess';
import Billing from './pages/Billing';
import AttendancePublic from './pages/AttendancePublic';
import Youth from './pages/Youth';
import YouthDetail from './pages/YouthDetail';
import YouthAgeGroups from './pages/YouthAgeGroups';
import YouthPrograms from './pages/YouthPrograms';
import YouthReports from './pages/YouthReports';
import MemberInsights from './pages/MemberInsights';
import MemberGroups from './pages/MemberGroups';
import MyGiving from './pages/MyGiving';
import Resources from './pages/Resources';
import AssetDetail from './pages/AssetDetail';
import MyLoans from './pages/MyLoans';
import Volunteering from './pages/Volunteering';
import VolunteerOpportunity from './pages/VolunteerOpportunity';
import Analytics from './pages/Analytics';
import ForcePasswordChange from './pages/ForcePasswordChange';
import NotFound from './pages/NotFound';
import PlatformSite from './site/PlatformSite';
import FellowshipSite from './fellowship-site/FellowshipSite';
import PublicSiteAdmin from './pages/PublicSiteAdmin';
import Appointments from './pages/Appointments';
import AcceptInvitation from './pages/AcceptInvitation';
import Register from './pages/Register';

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

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
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
        const profile = await axios.get('/profile', { withCredentials: true });
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
      <Router>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" replace />} />
          <Route path="/register" element={!user ? <Register /> : <Navigate to="/dashboard" replace />} />
          <Route path="/attendance/:id" element={<AttendancePublic />} />
          {/* Unauthenticated on purpose: the person arriving has never signed in, which is what an invitation is for.
              The token in the URL is the entire authorisation, and it is single use. */}
          <Route path="/invite/:token" element={<AcceptInvitation />} />
          {/* The two public sites. `/site` is the platform's own marketing site; `/f/:subdomain` is one fellowship's
              landing page. Both are reachable by path in every environment. On the apex domain in production,
              `/` below sends a visitor to the marketing site instead of the app, so the front door of the platform
              is its own home page. */}
          <Route path="/site/*" element={<PlatformSite />} />
          <Route path="/f/:subdomain/*" element={<FellowshipSite />} />
          <Route path="/" element={<AppRoot />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="members" element={<ExcludeAdmin><Members /></ExcludeAdmin>} />
            <Route path="members/insights" element={<ExcludeAdmin><MemberInsights /></ExcludeAdmin>} />
            <Route path="members/:id" element={<ExcludeAdmin><MemberDetail /></ExcludeAdmin>} />
            <Route path="member-groups" element={<ExcludeAdmin><MemberGroups /></ExcludeAdmin>} />
            <Route path="programmes" element={<ExcludeAdmin><RequireRole roles={['secretary']}>{<Programmes />}</RequireRole></ExcludeAdmin>} />
            <Route path="departments" element={<ExcludeAdmin><Departments /></ExcludeAdmin>} />
            <Route path="departments/:id" element={<ExcludeAdmin><DepartmentDetail /></ExcludeAdmin>} />
            <Route path="activities" element={<ExcludeAdmin><Activities /></ExcludeAdmin>} />
            <Route path="activities/:id" element={<ExcludeAdmin><ActivityDetail /></ExcludeAdmin>} />
            <Route path="reports" element={<ExcludeAdmin><Reports /></ExcludeAdmin>} />
            <Route path="finance" element={<ExcludeAdmin><RequireRole roles={['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'department_secretary', 'department_chairperson']}>{<Finance />}</RequireRole></ExcludeAdmin>} />
            <Route path="my-giving" element={<ExcludeAdmin><MyGiving /></ExcludeAdmin>} />
            <Route path="resources" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer', 'department_secretary', 'department_chairperson']}>{<Resources />}</RequireRole></ExcludeAdmin>} />
            <Route path="resources/:id" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer', 'department_secretary', 'department_chairperson']}>{<AssetDetail />}</RequireRole></ExcludeAdmin>} />
            <Route path="my-loans" element={<ExcludeAdmin><MyLoans /></ExcludeAdmin>} />
            <Route path="analytics" element={<ExcludeAdmin><RequireRole roles={['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'treasurer', 'department_secretary', 'department_chairperson']}>{<Analytics />}</RequireRole></ExcludeAdmin>} />
            <Route path="volunteering" element={<ExcludeAdmin><Volunteering /></ExcludeAdmin>} />
            <Route path="volunteering/:id" element={<ExcludeAdmin><VolunteerOpportunity /></ExcludeAdmin>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="audit" element={<RequireRole roles={['admin', 'secretary', 'chairperson', 'assistant_chairperson']}>{<Audit />}</RequireRole>} />
            <Route path="recycle-bin" element={<RequireRole roles={['secretary', 'assistant_secretary']}>{<RecycleBin />}</RequireRole>} />
            <Route path="backups" element={<RequireRole roles={['admin']}>{<Backups />}</RequireRole>} />
            <Route path="it-content" element={<ExcludeAdmin><ItContent /></ExcludeAdmin>} />
            {/* The fellowship administrator's screen: appointing the people who hold the fellowship's offices. */}
            <Route path="appointments" element={<ExcludeAdmin><RequireRole roles={['fellowship_admin', 'secretary']}><Appointments /></RequireRole></ExcludeAdmin>} />
            {/* The content manager's own screen. `admin` is deliberately absent, matching the IT Content page: the
                platform administrator runs the platform, and a tenant's public site is the tenant's business. */}
            <Route path="public-site" element={<ExcludeAdmin><RequireRole roles={['it_admin', 'secretary', 'assistant_secretary']}><PublicSiteAdmin /></RequireRole></ExcludeAdmin>} />
            <Route path="youth" element={<ExcludeAdmin><Youth /></ExcludeAdmin>} />
            <Route path="youth/age-groups" element={<ExcludeAdmin><RequireRole roles={['secretary']}>{<YouthAgeGroups />}</RequireRole></ExcludeAdmin>} />
            <Route path="youth/programs" element={<ExcludeAdmin><YouthPrograms /></ExcludeAdmin>} />
            <Route path="youth/reports" element={<ExcludeAdmin><YouthReports /></ExcludeAdmin>} />
            <Route path="youth/:id" element={<ExcludeAdmin><YouthDetail /></ExcludeAdmin>} />
            <Route path="users" element={<RequireRole roles={['admin', 'secretary']}>{<Users />}</RequireRole>} />
            <Route path="approvals" element={<ExcludeAdmin><Approvals /></ExcludeAdmin>} />
            <Route path="platform" element={<RequireRole roles={['admin', 'platform_support']}>{<Platform />}</RequireRole>} />
            <Route path="platform/tenants/:id" element={<RequireRole roles={['admin', 'platform_support']}>{<PlatformTenant />}</RequireRole>} />
            <Route path="fellowships" element={<Navigate to="/platform" replace />} />
            <Route path="billing" element={<ExcludeAdmin><RequireRole roles={['secretary']}>{<Billing />}</RequireRole></ExcludeAdmin>} />
            <Route path="support-access" element={<ExcludeAdmin><RequireRole roles={['secretary']}>{<SupportAccess />}</RequireRole></ExcludeAdmin>} />
            <Route path="profile" element={<Profile />} />
            {/* Any address inside the authenticated shell that matches nothing above. */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Router>
    </AuthContext.Provider>
  );
}
