import { createContext, useContext } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import { ArchiveBoxIcon, BuildingOffice2Icon, CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, HandRaisedIcon, WrenchScrewdriverIcon, CubeIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import { useI18n } from '../context/I18nContext';
import { Button, Card, ErrorState, PageHeader, PageLoader, StatCard, StatGrid, useToast } from '../components/ui';
import { errMsg, FinContext, fmtDate, label, Status, useLoad } from '../fin/common';
import { AssetList } from './Register';
import { Borrowing, Requests, Transfers } from './Flows';
import { Consumables, Maintenance } from './Care';
import { InvReports, InvSettings } from './Admin';
import { AssetPage } from './AssetPage';

import { RESOURCE_CENTRAL_ROLES as CENTRAL_ROLES } from '../lib/area-roles';
export { CENTRAL_ROLES };

export interface InvScope {
  departmentId: string | null;
  departmentName?: string;
  roles: string[];
  leaderRole?: 'department_chairperson' | 'department_secretary' | null;
  base: string;
}
export const InvContext = createContext<InvScope>({ departmentId: null, roles: [], base: '/inventory' });
export const useInv = () => useContext(InvContext);
export const invQuery = (s: InvScope) => (s.departmentId ? `departmentId=${s.departmentId}` : '');
export const isTreasurer = (s: InvScope) => s.roles.includes('treasurer');
/** Can this person manage resources of this scope: the Treasurer centrally, a department's leaders in its workspace. */
export const canManageScope = (s: InvScope) => (s.departmentId ? !!s.leaderRole : isTreasurer(s));

export function sections(s: InvScope) {
  const central = !s.departmentId;
  return [
    { path: '', key: 'inv.nav.dashboard', element: <InvDashboard /> },
    { path: 'inventory', key: 'inv.nav.inventory', element: <AssetList /> },
    { path: 'department-assets', key: 'inv.nav.departmentAssets', element: <AssetList ownership="department" />, show: central },
    { path: 'requests', key: 'inv.nav.requests', element: <Requests /> },
    { path: 'borrowing', key: 'inv.nav.borrowing', element: <Borrowing /> },
    { path: 'transfers', key: 'inv.nav.transfers', element: <Transfers /> },
    { path: 'maintenance', key: 'inv.nav.maintenance', element: <Maintenance /> },
    { path: 'consumables', key: 'inv.nav.consumables', element: <Consumables /> },
    { path: 'reports', key: 'inv.nav.reports', element: <InvReports /> },
    { path: 'settings', key: 'inv.nav.settings', element: <InvSettings />, show: central },
  ].filter((x) => x.show !== false);
}

export function InventoryShell({ scope }: { scope: InvScope }) {
  const { t } = useI18n();
  return (
    <InvContext.Provider value={scope}>
      {/* The finance helpers (uploads, member search) read this scope too. */}
      <FinContext.Provider value={{ departmentId: scope.departmentId, roles: scope.roles, leaderRole: scope.leaderRole, currency: 'TZS', paymentMethods: ['cash'] }}>
        <div className="mx-auto max-w-7xl">
          <nav aria-label="Resource sections" className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-hairline pb-px">
            {sections(scope).map((x) => (
              <NavLink key={x.path} to={x.path ? `${scope.base}/${x.path}` : scope.base} end={!x.path}
                className={({ isActive }) => `whitespace-nowrap rounded-t-control px-3 py-2 text-sm font-medium ${isActive ? 'border-b-2 border-primary text-primary' : 'text-ink-muted hover:text-ink'}`}>
                {t(x.key)}
              </NavLink>
            ))}
          </nav>
          <Routes>
            {sections(scope).map((x) => (x.path ? <Route key={x.path} path={x.path} element={x.element} /> : <Route key="index" index element={x.element} />))}
            <Route path="assets/:id" element={<AssetPage />} />
            <Route path="*" element={<Navigate to={scope.base} replace />} />
          </Routes>
        </div>
      </FinContext.Provider>
    </InvContext.Provider>
  );
}

/** /inventory: the Treasurer's resource register and oversight for central officers. */
export default function InventoryArea() {
  const { user } = useAuth();
  return <InventoryShell scope={{ departmentId: null, roles: user?.roles ?? [], base: '/inventory' }} />;
}

function InvDashboard() {
  const s = useInv();
  const { t } = useI18n();
  const toast = useToast();
  const { data: d, error, reload } = useLoad<any>(`/inventory/dashboard?${invQuery(s)}`, [s.departmentId]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!d) return <PageLoader rows={3} />;
  const c = d.cards;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={s.departmentName ?? 'Fellowship'} title={t('inv.nav.dashboard')} description="Who owns what, who holds it, and what needs attention. Borrowed resources belong to others and are not counted as owned."
        actions={!s.departmentId && CENTRAL_ROLES.some((r) => s.roles.includes(r)) ? <Button size="sm" onClick={async () => { try { const r = (await axios.post('/inventory/reminders/run', {}, { withCredentials: true })).data; toast.push('success', `Reminders: ${r.overdue} overdue, ${r.upcoming} due soon, ${r.lowStock} low stock.`); } catch (e) { toast.push('error', errMsg(e, 'Could not send reminders.')); } }}>Send reminders</Button> : undefined} />
      <StatGrid>
        {!s.departmentId && <StatCard label="Fellowship-owned" value={c.fellowshipOwned} icon={<BuildingOffice2Icon className="h-5 w-5" />} tone="primary" />}
        <StatCard label="Department-owned" value={c.departmentOwned} icon={<ArchiveBoxIcon className="h-5 w-5" />} />
        <StatCard label="Donated" value={c.donated} icon={<HandRaisedIcon className="h-5 w-5" />} />
        <StatCard label="Borrowed from others" value={c.borrowedExternal} hint="Not owned" />
        <StatCard label="Available" value={c.available} icon={<CheckCircleIcon className="h-5 w-5" />} tone="success" />
        <StatCard label="Assigned" value={c.assigned} />
        <StatCard label="Out on loan" value={c.onLoan} />
        <StatCard label="Damaged" value={c.damaged} icon={<ExclamationTriangleIcon className="h-5 w-5" />} tone={c.damaged ? 'danger' : 'neutral'} />
        <StatCard label="Lost" value={c.lost} tone={c.lost ? 'danger' : 'neutral'} />
        <StatCard label="In maintenance" value={c.inMaintenance} icon={<WrenchScrewdriverIcon className="h-5 w-5" />} />
        <StatCard label="Pending requests" value={c.pendingRequests} icon={<ClockIcon className="h-5 w-5" />} tone={c.pendingRequests ? 'warning' : 'neutral'} to={`${s.base}/requests`} />
        <StatCard label="Due back this week" value={c.upcomingReturns} to={`${s.base}/borrowing`} />
        <StatCard label="Overdue returns" value={c.overdueReturns} tone={c.overdueReturns ? 'danger' : 'neutral'} to={`${s.base}/borrowing`} />
        <StatCard label="Low stock items" value={c.lowStock} icon={<CubeIcon className="h-5 w-5" />} tone={c.lowStock ? 'warning' : 'neutral'} to={`${s.base}/consumables`} />
      </StatGrid>
      {d.departments.length > 0 && (
        <Card className="card-pad">
          <h2 className="mb-2 text-sm font-semibold">Departments</h2>
          <table className="table w-full text-sm"><thead><tr><th>Department</th><th className="text-right">Owns</th><th className="text-right">Holds (assigned)</th></tr></thead>
            <tbody>{d.departments.map((x: any) => <tr key={x.id}><td>{x.name}</td><td className="text-right">{x.owned}</td><td className="text-right">{x.assigned}</td></tr>)}</tbody></table>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="card-pad"><h2 className="mb-2 text-sm font-semibold">Recent acquisitions</h2>
          {d.recentAcquisitions.length ? <ul className="space-y-1 text-sm">{d.recentAcquisitions.map((a: any) => <li key={a.id} className="flex justify-between"><span>{a.asset_tag} · {a.name}</span><span className="text-ink-subtle">{label(a.ownership_type)}</span></li>)}</ul> : <p className="text-sm text-ink-muted">None yet.</p>}
        </Card>
        <Card className="card-pad"><h2 className="mb-2 text-sm font-semibold">Recent transfers</h2>
          {d.recentTransfers.length ? <ul className="space-y-1 text-sm">{d.recentTransfers.map((x: any) => <li key={x.id} className="flex justify-between"><span>{x.transfer_number} · {label(x.kind)}</span><Status value={x.status} /></li>)}</ul> : <p className="text-sm text-ink-muted">None yet.</p>}
        </Card>
        <Card className="card-pad"><h2 className="mb-2 text-sm font-semibold">Recent disposals</h2>
          {d.recentDisposals.length ? <ul className="space-y-1 text-sm">{d.recentDisposals.map((a: any) => <li key={a.id} className="flex justify-between"><span>{a.asset_tag} · {a.name}</span><span className="text-ink-subtle">{label(a.status)} {fmtDate(a.disposed_at)}</span></li>)}</ul> : <p className="text-sm text-ink-muted">None.</p>}
        </Card>
      </div>
    </div>
  );
}
