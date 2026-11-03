import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../App';
import { useI18n } from '../context/I18nContext';
import { PageLoader } from '../components/ui';
import { FinContext, FinScope, useLoad } from './common';
import FinDashboard from './Dashboard';
import Drives from './Drives';
import { Expenses } from './Spending';
import { Reports, Settings } from './Admin';

import { CENTRAL_FINANCE_ROLES } from '../lib/area-roles';
export { CENTRAL_FINANCE_ROLES };

interface Section { path: string; key: string; element: JSX.Element; show?: boolean; nested?: boolean }

/** The sections of a finance area, for central money or one department's money. */
export function sections(scope: FinScope): Section[] {
  const central = !scope.departmentId;
  return [
    { path: '', key: 'fin.nav.dashboard', element: <FinDashboard /> },
    { path: 'contributions', key: 'fin.nav.contributions', element: <Drives />, nested: true },
    { path: 'expenses', key: 'fin.nav.expenses', element: <Expenses /> },
    { path: 'reports', key: 'fin.nav.reports', element: <Reports /> },
    { path: 'settings', key: 'fin.nav.settings', element: <Settings />, show: central },
  ].filter((s) => s.show !== false);
}

export function FinanceNav({ base, scope }: { base: string; scope: FinScope }) {
  const { t } = useI18n();
  return (
    <nav aria-label="Finance sections" className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-hairline pb-px">
      {sections(scope).map((s) => (
        <NavLink key={s.path} to={s.path ? `${base}/${s.path}` : base} end={!s.path}
          className={({ isActive }) => `whitespace-nowrap rounded-t-control px-3 py-2 text-sm font-medium ${isActive ? 'border-b-2 border-primary text-primary' : 'text-ink-muted hover:text-ink'}`}>
          {t(s.key)}
        </NavLink>
      ))}
    </nav>
  );
}

export function FinanceRoutes({ scope, base }: { scope: FinScope; base: string }) {
  return (
    <Routes>
      {sections(scope).map((s) => (s.path
        ? <Route key={s.path} path={s.nested ? `${s.path}/*` : s.path} element={s.element} />
        : <Route key="index" index element={s.element} />))}
      <Route path="*" element={<Navigate to={base} replace />} />
    </Routes>
  );
}

/** Settings shared by every finance screen (currency, payment methods). */
export function useFinanceSettings() {
  return useLoad<any>('/finance/settings');
}

/** /finance: the fellowship's central finances, for the Treasurer and the central officers. */
export default function FinanceArea() {
  const { user } = useAuth();
  const settings = useFinanceSettings();
  if (!settings.data && !settings.error) return <PageLoader rows={3} />;
  const scope: FinScope = {
    departmentId: null,
    roles: user?.roles ?? [],
    currency: settings.data?.currency ?? 'TZS',
    paymentMethods: settings.data?.payment_methods ?? ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'],
  };
  return (
    <FinContext.Provider value={scope}>
      <div className="mx-auto max-w-7xl">
        <FinanceRoutes scope={scope} base="/finance" />
      </div>
    </FinContext.Provider>
  );
}
