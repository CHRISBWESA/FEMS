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
import ImpersonationApproval from './pages/ImpersonationApproval';
import Profile from './pages/Profile';
import Users from './pages/Users';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  impersonating?: boolean;
  impersonationSessionId?: string;
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
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user || !user.roles.includes('admin')) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: string[]; children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.some(r => user.roles.includes(r))) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
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
      });
      setLoading(false);
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
    setUser(res.data.user);
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
  const hasPermission = (permission: string) => user?.permissions.includes(permission) ?? false;
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
          <Route path="/impersonate/:token" element={<ImpersonationApproval />} />
          <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="members" element={<ExcludeAdmin><Members /></ExcludeAdmin>} />
            <Route path="members/:id" element={<ExcludeAdmin><MemberDetail /></ExcludeAdmin>} />
            <Route path="programmes" element={<ExcludeAdmin><RequireRole roles={['secretary']}>{<Programmes />}</RequireRole></ExcludeAdmin>} />
            <Route path="departments" element={<ExcludeAdmin><Departments /></ExcludeAdmin>} />
            <Route path="departments/:id" element={<ExcludeAdmin><DepartmentDetail /></ExcludeAdmin>} />
            <Route path="activities" element={<ExcludeAdmin><Activities /></ExcludeAdmin>} />
            <Route path="activities/:id" element={<ExcludeAdmin><ActivityDetail /></ExcludeAdmin>} />
            <Route path="reports" element={<ExcludeAdmin><Reports /></ExcludeAdmin>} />
            <Route path="finance" element={<ExcludeAdmin><RequireRole roles={['treasurer', 'secretary', 'chairperson']}>{<Finance />}</RequireRole></ExcludeAdmin>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="audit" element={<RequireRole roles={['admin', 'secretary', 'chairperson']}>{<Audit />}</RequireRole>} />
            <Route path="recycle-bin" element={<RequireRole roles={['admin', 'secretary', 'assistant_secretary']}>{<RecycleBin />}</RequireRole>} />
            <Route path="backups" element={<RequireRole roles={['admin', 'secretary', 'assistant_secretary']}>{<Backups />}</RequireRole>} />
            <Route path="it-content" element={<ExcludeAdmin><ItContent /></ExcludeAdmin>} />
            <Route path="users" element={<RequireRole roles={['admin', 'secretary']}>{<Users />}</RequireRole>} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </Router>
    </AuthContext.Provider>
  );
}
