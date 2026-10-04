import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../App';
import FormModal from '../components/resources/FormModal';
import SecretModal from '../components/platform/SecretModal';
import CredentialsModal from '../components/platform/CredentialsModal';
import Impersonation from '../components/platform/Impersonation';
import { Empty, Modal, Spinner, errMsg } from '../components/finance/common';
import { PageHeader, Card, StatCard, StatGrid, Badge, Button, EmptyState, Alert } from '../components/ui';
import { DataTable, SearchInput, type Column } from '../components/DataTable';

const MODULES: [string, string][] = [
  ['finance', 'Finance & contributions'], ['youth', 'Youth & children'], ['resources', 'Resources & assets'],
  ['volunteers', 'Volunteers & service'], ['analytics', 'Analytics'], ['member_engagement', 'Member engagement'],
];
type Tab = 'dashboard' | 'registrations' | 'impersonation' | 'tenants' | 'plans' | 'billing' | 'invoices' | 'webhooks' | 'support' | 'audit' | 'health';
const badge = (s: string) => (s === 'active' || s === 'approved' ? 'status-active' : s === 'suspended' || s === 'denied' || s === 'revoked' ? 'status-rejected' : s === 'requested' ? 'status-submitted' : 'status-inactive');

const statusTone = (s: string): 'success' | 'danger' | 'warning' | 'neutral' =>
  s === 'active' || s === 'approved' || s === 'paid' ? 'success'
    : s === 'suspended' || s === 'denied' || s === 'revoked' || s === 'past_due' || s === 'void' ? 'danger'
      : s === 'requested' || s === 'trialing' || s === 'pending' ? 'warning'
        : 'neutral';

/**
 * Eleven tabs in one row overflowed on anything narrower than a large desktop and gave no hint of what belonged
 * together. They are grouped by what an operator is actually doing: looking at the estate, acting on a request,
 * or checking the machine.
 */
const TAB_GROUPS: { title: string; tabs: [Tab, string, string][] }[] = [
  {
    title: 'Estate',
    tabs: [
      ['dashboard', 'Dashboard', 'platform.analytics_view'],
      ['tenants', 'Fellowships', 'platform.tenants_view'],
      ['plans', 'Plans', 'platform.billing_view'],
      ['billing', 'Subscriptions', 'platform.billing_view'],
      ['invoices', 'Invoices', 'platform.billing_view'],
    ],
  },
  {
    title: 'Requests',
    tabs: [
      ['registrations', 'Signup requests', 'platform.tenants_view'],
      ['support', 'Support access', 'platform.support_request'],
    ],
  },
  {
    title: 'System',
    tabs: [
      ['impersonation', 'Impersonation', 'admin.impersonate'],
      ['webhooks', 'Webhooks', 'platform.billing_view'],
      ['audit', 'Audit', 'platform.audit_view'],
      ['health', 'Health', 'platform.analytics_view'],
    ],
  },
];

export default function Platform() {
  const { hasPermission } = useAuth();
  const groups = TAB_GROUPS
    .map((g) => ({ ...g, tabs: g.tabs.filter(([, , perm]) => hasPermission(perm)) }))
    .filter((g) => g.tabs.length > 0);

  const available = groups.flatMap((g) => g.tabs.map(([id]) => id));
  const [tab, setTab] = useState<Tab>(available[0] ?? 'registrations');

  // A permission change can leave the current tab unreachable; fall back rather than render nothing.
  const active = available.includes(tab) ? tab : available[0];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Platform administration"
        title="Fellowships on the platform"
        description="Manage the estates, requests and billing behind FEMS. Platform accounts never see a fellowship's members, finances or other operational data."
        actions={
          hasPermission('platform.staff_manage') ? (
            // System accounts live with the other account management, in Users > System accounts, so there is one
            // place to administer accounts rather than two that can disagree.
            <Link to="/users?view=admin" className="btn btn-secondary">System accounts</Link>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Grouped navigation. On a phone it becomes a horizontal scroller rather than eleven squeezed tabs. */}
        <nav className="lg:w-56 lg:shrink-0" aria-label="Platform sections">
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
            {groups.map((g) => (
              <div key={g.title} className="shrink-0 lg:shrink">
                <p className="mb-1.5 px-3 text-xxs font-semibold uppercase tracking-wider text-ink-subtle">{g.title}</p>
                <div className="flex gap-1 lg:flex-col lg:gap-0.5">
                  {g.tabs.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-current={id === active ? 'page' : undefined}
                      onClick={() => setTab(id)}
                      className={`whitespace-nowrap rounded-control px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                        id === active ? 'bg-primary text-white shadow-card' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {active === 'dashboard' && <DashboardTab />}
          {active === 'registrations' && <RegistrationsTab />}
          {active === 'impersonation' && <Impersonation />}
          {active === 'tenants' && <TenantsTab />}
          {active === 'plans' && <PlansTab />}
          {active === 'billing' && <SubscriptionsTab />}
          {active === 'invoices' && <InvoicesTab />}
          {active === 'webhooks' && <WebhooksTab />}
          {active === 'support' && <SupportTab />}
          {active === 'audit' && <AuditTab />}
          {active === 'health' && <HealthTab />}
        </div>
      </div>
    </div>
  );
}

function RegistrationsTab() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const canApprove = hasPermission('platform.onboard');
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<null | { r: any; mode: 'approve' | 'reject' }>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [secret, setSecret] = useState<null | { email: string; password: string }>(null);
  // The set of one-time passwords created by approving a request: one per default role.
  const [credentials, setCredentials] = useState<null | {
    accounts: any[]; fellowship?: string; subdomain?: string; outstandingRoles?: string[]; note?: string;
  }>(null);
  const [outcome, setOutcome] = useState('');

  const load = () => {
    const p = new URLSearchParams({ limit: '100' });
    if (status) p.set('status', status);
    if (q.trim()) p.set('search', q.trim());
    axios.get(`/platform/registrations?${p}`, { withCredentials: true })
      .then((r) => { setData(r.data); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load signup requests')));
  };
  useEffect(() => { load(); }, [status]);
  useEffect(() => {
    if (!canApprove) return;
    axios.get('/platform/billing/plans', { withCredentials: true }).then((r) => setPlans(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, [canApprove]);

  const act = async (r: any, mode: 'approve' | 'reject', values: any) => {
    setBusy(r.id);
    setError('');
    try {
      if (mode === 'approve') {
        const body: any = { note: values.note || undefined };
        if (values.planCode) body.planCode = values.planCode;
        if (values.planCode && values.startTrial) body.startTrial = true;
        const res = await axios.post(`/platform/registrations/${r.id}/approve`, body, { withCredentials: true });
        // Approving provisions every default role at once, so the whole set of one-time passwords is handed over
        // together. `accounts` is absent on an older server; fall back to the single administrator credential.
        setCredentials(res.data.accounts
          ? { accounts: res.data.accounts, fellowship: res.data.fellowship?.name, subdomain: res.data.fellowship?.subdomain, outstandingRoles: res.data.outstandingRoles, note: res.data.note }
          : { accounts: [{ ...res.data.administrator, roles: res.data.administrator.roles ?? [] }], note: res.data.note });
        setOutcome(res.data.subscriptionNote || 'The fellowship and its default role accounts were created.');
      } else {
        await axios.post(`/platform/registrations/${r.id}/reject`, { note: values.note }, { withCredentials: true });
        setOutcome('The request was rejected and the reason recorded.');
      }
      setDialog(null);
      load();
    } catch (e: any) {
      setError(errMsg(e, mode === 'approve' ? 'Could not approve' : 'Could not reject'));
    } finally {
      setBusy('');
    }
  };

  const r = dialog?.r;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex flex-1 gap-2">
          <input className="input max-w-xs" placeholder="Search name, e-mail or locationâ€¦" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="btn btn-secondary" type="submit">Search</button>
        </form>
        {data && (
          <p className="text-sm text-ink-muted">
            {data.counts.pending} pending Â· {data.counts.approved} approved Â· {data.counts.rejected} rejected
          </p>
        )}
      </div>
      <p className="mb-4 text-sm text-ink-muted">
        Requests submitted from the public signup form. Approving one creates the fellowship, makes the requester its
        Secretary, and provisions an active account for every default role; the temporary passwords are shown once.
        Nothing a requester writes can grant access on its own.
      </p>

      {outcome && !secret && !credentials && (
        <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20">{outcome}</p>
      )}
      {error && <p className="alert alert-danger mb-3 py-2.5" role="alert">{error}</p>}

      {!data ? <Spinner /> : data.data.length === 0 ? <Empty text="No signup requests" /> : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead><tr><th>Fellowship</th><th>Requested by</th><th>Contact</th><th>Plan asked for</th><th>Status</th><th>Received</th><th /></tr></thead>
            <tbody>
              {data.data.map((row: any) => (
                <tr key={row.id} className="align-top">
                  <td className="font-medium text-ink">
                    {row.fellowshipName}
                    {row.location && <span className="ml-2 text-xs text-ink-subtle">{row.location}</span>}
                    {row.description && <p className="mt-1 max-w-xs text-xs text-ink-muted">{row.description}</p>}
                    {row.reason && <p className="mt-1 max-w-xs text-xs italic text-ink-muted">"{row.reason}"</p>}
                  </td>
                  <td className="text-xs">
                    <span className="block text-ink">{row.email}</span>
                    {row.phone && <span className="text-ink-subtle">{row.phone}</span>}
                    {row.submittedIp && <span className="block text-ink-subtle">from {row.submittedIp}</span>}
                  </td>
                  <td className="text-xs text-ink">{row.contactName}</td>
                  <td className="text-xs text-ink-muted">{row.requestedPlanCode || 'â€”'}</td>
                  <td>
                    <span className={`status-badge ${row.status === 'approved' ? 'status-active' : row.status === 'rejected' ? 'status-rejected' : 'status-submitted'} capitalize`}>{row.status}</span>
                    {row.decisionNote && <p className="mt-1 max-w-[12rem] text-xs text-ink-muted">{row.decisionNote}</p>}
                  </td>
                  <td className="whitespace-nowrap text-xs text-ink-muted">{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td className="text-right">
                    {row.status === 'pending' && (
                      <span className="space-x-2">
                        <button className="btn btn-primary btn-sm" disabled={busy === row.id || !canApprove}
                          title={canApprove ? '' : 'Your role can review requests but not approve them'}
                          onClick={() => setDialog({ r: row, mode: 'approve' })}>Approve</button>
                        <button className="btn btn-secondary btn-sm" disabled={busy === row.id}
                          onClick={() => setDialog({ r: row, mode: 'reject' })}>Reject</button>
                      </span>
                    )}
                    {row.createdFellowshipId && (
                      <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/platform/tenants/${row.createdFellowshipId}`)}>Open fellowship</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && r && dialog.mode === 'approve' && (
        <FormModal
          title={`Approve ${r.fellowshipName}`}
          submitLabel="Create fellowship"
          description={`Creates the fellowship and its first administrator (${r.contactName}, ${r.email}). A temporary password is shown once.`}
          initial={{ startTrial: true }}
          fields={[
            { name: 'planCode', label: 'Assign a plan', type: 'select', options: [{ value: '', label: 'No plan for now' }, ...plans.filter((p) => p.isActive).map((p) => ({ value: p.code, label: `${p.name} â€“ ${p.price} ${p.currency}/${p.billingInterval}${p.trialDays > 0 ? ` (${p.trialDays}-day trial)` : ''}` }))] },
            { name: 'startTrial', label: 'Start the planâ€™s free trial', type: 'checkbox' },
            { name: 'note', label: 'Decision note (kept on the request)', type: 'textarea' },
          ]}
          onSubmit={(v) => act(r, 'approve', v)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog && r && dialog.mode === 'reject' && (
        <FormModal
          title={`Reject ${r.fellowshipName}`}
          submitLabel="Reject request"
          description="The reason is recorded on the request and in the platform audit trail."
          fields={[{ name: 'note', label: 'Reason', type: 'textarea', required: true }]}
          onSubmit={(v) => act(r, 'reject', v)}
          onClose={() => setDialog(null)}
        />
      )}
      {secret && (
        <SecretModal
          title="Administrator account created"
          email={secret.email}
          password={secret.password}
          onClose={() => { setSecret(null); setOutcome(''); }}
        />
      )}
      {credentials && (
        <CredentialsModal
          title="Fellowship created - default accounts"
          accounts={credentials.accounts}
          fellowship={credentials.fellowship}
          subdomain={credentials.subdomain}
          outstandingRoles={credentials.outstandingRoles}
          note={credentials.note}
          onClose={() => { setCredentials(null); setOutcome(''); load(); }}
        />
      )}
    </div>
  );
}

function DashboardTab() {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    axios.get('/platform/dashboard', { withCredentials: true }).then((r) => setD(r.data)).catch((e) => setError(errMsg(e, 'Could not load the dashboard')));
  }, [reloadKey]);

  if (error) {
    return (
      <Card className="card-pad">
        <EmptyState
          title="Could not load the platform dashboard"
          description={error}
          action={<Button variant="secondary" onClick={() => { setError(''); setReloadKey((k) => k + 1); }}>Try again</Button>}
        />
      </Card>
    );
  }
  if (!d) return <Spinner />;

  const s = d.subscriptions;
  const b = d.billing;

  const revenueColumns: Column<any>[] = [
    { key: 'currency', header: 'Currency', priority: 'primary' },
    { key: 'invoiced', header: 'Invoiced', align: 'right', tabular: true, priority: 'meta', render: (r) => r.invoiced.toFixed(2) },
    { key: 'collected', header: 'Collected', align: 'right', tabular: true, priority: 'meta', render: (r) => <span className="text-success">{r.collected.toFixed(2)}</span> },
    { key: 'outstanding', header: 'Outstanding', align: 'right', tabular: true, priority: 'meta', render: (r) => <span className="text-warning">{r.outstanding.toFixed(2)}</span> },
  ];

  const planColumns: Column<any>[] = [
    { key: 'name', header: 'Plan', priority: 'primary' },
    { key: 'price', header: 'Price', align: 'right', tabular: true, priority: 'meta', render: (p) => `${p.price} ${p.currency}/${p.billingInterval === 'year' ? 'yr' : 'mo'}` },
    { key: 'subscribers', header: 'Fellowships', align: 'right', tabular: true, priority: 'meta' },
  ];

  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard label="Fellowships" value={d.tenants.total} hint={`${d.tenants.active} active · ${d.tenants.suspended} suspended`} />
        <StatCard label="Fellowship accounts" value={d.users.active} hint={`${d.users.inactive} inactive`} />
        <StatCard label="Platform accounts" value={d.users.platformAccounts} />
        <StatCard
          label="Without an active secretary"
          value={d.tenantsWithoutActiveSecretary}
          hint="Active fellowships nobody can administer"
          tone={d.tenantsWithoutActiveSecretary > 0 ? 'warning' : 'neutral'}
        />
      </StatGrid>

      {/* Anything an operator must act on is lifted to the top rather than left in a grid of equal figures. */}
      {d.support.pendingRequests > 0 || d.subscriptions.byStatus.find((x: any) => x.status === 'past_due')?.count > 0 ? (
        <div className="space-y-2">
          {d.support.pendingRequests > 0 ? (
            <Alert tone="warning" title={`${d.support.pendingRequests} support request${d.support.pendingRequests === 1 ? '' : 's'} waiting`}>
              Somebody has asked for access to a fellowship's data and is waiting for a decision.
            </Alert>
          ) : null}
          {s.byStatus.find((x: any) => x.status === 'past_due')?.count > 0 ? (
            <Alert tone="danger" title={`${s.byStatus.find((x: any) => x.status === 'past_due').count} subscription${s.byStatus.find((x: any) => x.status === 'past_due').count === 1 ? '' : 's'} past due`}>
              Payment has not been recorded for these fellowships.
            </Alert>
          ) : null}
        </div>
      ) : null}

      <Card className="card-pad">
        <h3 className="section-title">Subscriptions</h3>
        <div className="mt-4">
          <StatGrid>
            <StatCard label="Subscribed" value={`${s.total} / ${d.tenants.total}`} hint={`${s.tenantsWithoutSubscription} on no plan`} />
            <StatCard label="On a free trial" value={s.trialing} hint="Trial not yet ended" />
            <StatCard label="Ending within 30 days" value={s.expiringSoon} hint="Trial or paid period" tone={s.expiringSoon > 0 ? 'warning' : 'neutral'} />
            <StatCard label="Overdue" value={s.byStatus.find((x: any) => x.status === 'past_due')?.count ?? 0} hint="Payment not recorded" tone="danger" />
          </StatGrid>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-hairline pt-4 text-sm sm:grid-cols-5">
          {s.byStatus.map((x: any) => (
            <div key={x.status} className="flex items-baseline justify-between gap-2 py-1">
              <dt className="capitalize text-ink-muted">{x.status.replace(/_/g, ' ')}</dt>
              <dd className="font-semibold tabular-nums text-ink">{x.count}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="card-pad">
          <h3 className="section-title">Billing</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {b.invoices.total} invoice{b.invoices.total === 1 ? '' : 's'} · {b.invoices.open} open · {b.invoices.paid} paid · {b.invoices.void} void
          </p>
          <div className="mt-4">
            {b.revenue.length === 0 ? (
              <EmptyState compact title="Nothing invoiced yet" description="Invoices you raise against a fellowship's subscription will total here, by currency." />
            ) : (
              <DataTable columns={revenueColumns} rows={b.revenue} rowKey={(r) => r.currency} caption="Revenue by currency" mobile="scroll" />
            )}
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-subtle">
            Amounts are never added across currencies. Payments are recorded by an administrator; no payment provider is connected.
          </p>
        </Card>

        <Card className="card-pad">
          <h3 className="section-title">Plans in use</h3>
          <div className="mt-4">
            {d.plans.length === 0 ? (
              <EmptyState compact title="No active plans defined" description="Define a plan before a fellowship can be subscribed to one." />
            ) : (
              <DataTable columns={planColumns} rows={d.plans} rowKey={(p) => p.id} caption="Plans and their subscribers" mobile="scroll" />
            )}
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-sm text-ink-muted">
            Inbound payment notifications: {b.webhooks.processed} processed · {b.webhooks.received} waiting ·{' '}
            <span className={b.webhooks.failed > 0 ? 'font-medium text-danger' : undefined}>{b.webhooks.failed} failed</span>
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="card-pad">
          <h3 className="section-title">Modules switched off</h3>
          {d.modules.length === 0 ? (
            <p className="mt-3 text-sm text-ink-subtle">Every module is switched on for every fellowship.</p>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {d.modules.map((m: any) => (
                <li key={m.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-ink">{m.label}</span>
                  <Badge tone={m.tenantsWithModuleOff > 0 ? 'warning' : 'neutral'}>
                    {m.tenantsWithModuleOff} fellowship{m.tenantsWithModuleOff === 1 ? '' : 's'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="card-pad">
          <h3 className="section-title">Newest fellowships</h3>
          {d.recentTenants.length === 0 ? (
            <EmptyState compact title="No fellowships yet" description="Onboard a fellowship, or approve a signup request, and it will appear here." />
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {d.recentTenants.map((t: any) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">{t.name}</span>
                  <span className="shrink-0 text-ink-subtle">{new Date(t.createdAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function TenantsTab() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [staffed, setStaffed] = useState('');
  const [error, setError] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [secret, setSecret] = useState<null | { email: string; password: string }>(null);
  // Every default role account created by onboarding, so all the one-time passwords are handed over together.
  const [credentials, setCredentials] = useState<null | {
    accounts: any[]; fellowship?: string; subdomain?: string; outstandingRoles?: string[]; note?: string;
  }>(null);
  const load = () => {
    const p = new URLSearchParams({ limit: '100' });
    if (q.trim()) p.set('search', q.trim());
    if (status) p.set('status', status);
    axios.get(`/platform/tenants?${p}`, { withCredentials: true }).then((r) => {
      const all = r.data.data || [];
      // Staffing is a client-side filter: the account count is already in the row.
      setRows(staffed === 'unstaffed' ? all.filter((t: any) => t.users === 0)
        : staffed === 'staffed' ? all.filter((t: any) => t.users > 0)
        : all);
      setError('');
    }).catch((e) => setError(errMsg(e, 'Could not load fellowships')));
  };
  useEffect(load, [status, staffed]);

  const columns: Column<any>[] = [
    {
      key: 'name',
      header: 'Fellowship',
      priority: 'primary',
      render: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{t.name}</p>
          {t.location ? <p className="text-xs text-ink-subtle">{t.location}</p> : null}
          {t.users === 0 ? <p className="mt-1 text-xs font-medium text-danger">No administrator — nobody can sign in</p> : null}
        </div>
      ),
    },
    { key: 'status', header: 'Status', priority: 'meta', render: (t) => <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
    {
      key: 'users',
      header: 'Accounts',
      align: 'right',
      tabular: true,
      priority: 'meta',
      render: (t) => (t.users === 0 ? <Badge tone="danger">0</Badge> : t.users),
    },
    { key: 'members', header: 'Members', align: 'right', tabular: true, priority: 'secondary' },
    { key: 'modulesDisabled', header: 'Modules off', align: 'right', tabular: true, priority: 'secondary', render: (t) => t.modulesDisabled || '—' },
    {
      key: 'createdAt',
      header: 'Created',
      priority: 'secondary',
      render: (t) => new Date(t.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex flex-1 flex-wrap gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search fellowships" className="w-full sm:w-64" />
          <select className="select w-40" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select className="select w-48" aria-label="Filter by staffing" value={staffed} onChange={(e) => setStaffed(e.target.value)}>
            <option value="">Any staffing</option>
            <option value="staffed">Has an administrator</option>
            <option value="unstaffed">No administrator</option>
          </select>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {hasPermission('platform.onboard') && (
          <Button variant="primary" onClick={() => setOnboarding(true)}>
            <PlusIcon className="h-4 w-4" />
            Onboard fellowship
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-ink-muted">
        A fellowship with no accounts cannot be signed in to. It is flagged rather than hidden, so a subscribed
        congregation is never quietly forgotten.
      </p>
      <DataTable
        caption="Fellowships on the platform"
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        loading={!rows}
        error={error || null}
        onRetry={load}
        empty={{
          title: 'No fellowships found',
          description: q || status || staffed
            ? 'No fellowship matches these filters. Clear them to see the whole list.'
            : 'Onboard a fellowship, or approve a signup request, and it will appear here.',
          action: hasPermission('platform.onboard') ? (
            <Button variant="primary" onClick={() => setOnboarding(true)}>
              <PlusIcon className="h-4 w-4" />
              Onboard fellowship
            </Button>
          ) : undefined,
        }}
        boundedNotice={{ total: rows?.length ?? 0, noun: 'fellowships' }}
        rowActions={(t) => (
          <Link to={`/platform/tenants/${t.id}`} className="btn btn-secondary btn-sm" onClick={(e) => e.stopPropagation()}>
            Open
          </Link>
        )}
      />
      {onboarding && (
        <FormModal
          title="Onboard a fellowship" submitLabel="Create fellowship"
          description="Creates the fellowship, makes the administrator its Secretary, and provisions an active account for every default role. The temporary passwords are shown once."
          initial={{ finance: true, youth: true, resources: true, volunteers: true, analytics: true, member_engagement: true }}
          fields={[
            { name: 'name', label: 'Fellowship name', required: true },
            { name: 'location', label: 'Location' },
            { name: 'description', label: 'Description', type: 'textarea' },
            { name: 'adminFirst', label: 'Administrator first name', required: true },
            { name: 'adminLast', label: 'Administrator last name', required: true },
            { name: 'adminEmail', label: 'Administrator e-mail (they become the Secretary)', required: true },
            { name: 'adminPhone', label: 'Administrator phone' },
            ...MODULES.map(([key, label]) => ({ name: key, label: `Enable: ${label}`, type: 'checkbox' as const })),
          ]}
          onSubmit={async (v) => {
            const r = await axios.post('/platform/onboarding', {
              name: v.name, location: v.location || undefined, description: v.description || undefined,
              modules: Object.fromEntries(MODULES.map(([k]) => [k, !!v[k]])),
              administrator: { email: v.adminEmail, firstName: v.adminFirst, lastName: v.adminLast, phone: v.adminPhone || undefined },
            }, { withCredentials: true });
            setSecret(null);
            setCredentials(r.data.accounts
              ? { accounts: r.data.accounts, fellowship: r.data.fellowship?.name, subdomain: r.data.fellowship?.subdomain, outstandingRoles: r.data.outstandingRoles, note: r.data.note }
              : { accounts: [{ ...r.data.administrator, roles: r.data.administrator.roles ?? [] }], note: r.data.note });
            setOnboarding(false);
            load();
          }}
          onClose={() => setOnboarding(false)}
        />
      )}
      {secret && <SecretModal title="Administrator created" email={secret.email} password={secret.password} onClose={() => setSecret(null)} />}
      {credentials && (
        <CredentialsModal
          title="Fellowship created - default accounts"
          accounts={credentials.accounts}
          fellowship={credentials.fellowship}
          subdomain={credentials.subdomain}
          outstandingRoles={credentials.outstandingRoles}
          note={credentials.note}
          onClose={() => { setCredentials(null); load(); }}
        />
      )}
    </div>
  );
}

function SupportTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [view, setView] = useState<null | { title: string; data: any }>(null);
  const load = () => axios.get('/platform/support/grants?limit=100', { withCredentials: true }).then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); axios.get('/platform/tenants?limit=100&status=active', { withCredentials: true }).then((r) => setTenants(r.data.data)).catch(() => {}); }, []);
  const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name || id.slice(0, 8);
  const open = async (g: any, kind: 'config' | 'users') => {
    try { const r = await axios.get(`/platform/support/tenants/${g.fellowshipId}/${kind}`, { withCredentials: true }); setView({ title: `${nameOf(g.fellowshipId)} â€“ ${kind === 'config' ? 'configuration' : 'account directory'}`, data: r.data }); } catch (e) { alert(errMsg(e, 'Could not open')); }
  };
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Support access is requested from the fellowship's Secretary, limited to read-only diagnostics, time-boxed, and every use is recorded in the fellowship's audit trail.</p>
        <button className="btn btn-primary" onClick={() => setRequesting(true)}><PlusIcon className="h-4 w-4" /> Request access</button>
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty text="No support requests yet" /> : (
        <div className="table-wrap overflow-x-auto"><table className="table"><thead><tr><th>Fellowship</th><th>Scope</th><th>Status</th><th>Expires</th><th /></tr></thead>
          <tbody>{rows.map((g) => (
            <tr key={g.id}>
              <td className="font-medium text-ink">{nameOf(g.fellowshipId)}</td>
              <td>{g.scopes.join(', ').replace(/_/g, ' ')}</td>
              <td><span className={`status-badge ${badge(g.status)} capitalize`}>{g.status}</span></td>
              <td>{g.expiresAt && g.status === 'approved' ? new Date(g.expiresAt).toLocaleTimeString() : 'â€”'}</td>
              <td className="space-x-2 text-right">
                {g.status === 'approved' && g.scopes.includes('tenant_config') && <button className="btn btn-secondary btn-sm" onClick={() => open(g, 'config')}>Configuration</button>}
                {g.status === 'approved' && g.scopes.includes('user_directory') && <button className="btn btn-secondary btn-sm" onClick={() => open(g, 'users')}>Accounts</button>}
                {['requested', 'approved'].includes(g.status) && <button className="btn btn-secondary btn-sm" onClick={async () => { try { await axios.post(`/platform/support/grants/${g.id}/cancel`, {}, { withCredentials: true }); load(); } catch (e) { alert(errMsg(e, 'Failed')); } }}>{g.status === 'requested' ? 'Withdraw' : 'End access'}</button>}
              </td>
            </tr>
          ))}</tbody></table></div>
      )}
      {requesting && (
        <FormModal
          title="Request support access" submitLabel="Send request"
          initial={{ tenant_config: true, user_directory: false, durationMinutes: 60 }}
          fields={[
            { name: 'fellowshipId', label: 'Fellowship', type: 'select', required: true, options: [{ value: '', label: 'Selectâ€¦' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))] },
            { name: 'tenant_config', label: 'Configuration (settings, modules, department names)', type: 'checkbox' },
            { name: 'user_directory', label: 'Account directory (names, e-mails, roles, status)', type: 'checkbox' },
            { name: 'durationMinutes', label: 'Duration (minutes, 15â€“240)', type: 'number', min: 15 },
            { name: 'reason', label: 'Reason (shown to the Secretary)', type: 'textarea', required: true },
          ]}
          onSubmit={async (v) => {
            await axios.post('/platform/support/requests', { fellowshipId: v.fellowshipId, scopes: ['tenant_config', 'user_directory'].filter((s) => v[s]), durationMinutes: Number(v.durationMinutes), reason: v.reason }, { withCredentials: true });
            load();
          }}
          onClose={() => setRequesting(false)}
        />
      )}
      {view && <Modal title={view.title} onClose={() => setView(null)} max="max-w-3xl"><pre className="max-h-96 overflow-auto rounded-lg bg-canvas p-3 text-xs">{JSON.stringify(view.data, null, 2)}</pre></Modal>}
    </div>
  );
}


function AuditTab() {
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ page: String(page), limit: '25' });
    if (action.trim()) p.set('action', action.trim());
    axios.get(`/platform/audit?${p}`, { withCredentials: true }).then((r) => { setData(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load the audit log')));
  }, [page]);
  const search = (e: React.FormEvent) => { e.preventDefault(); setPage(1); setData(null); axios.get(`/platform/audit?limit=25&action=${encodeURIComponent(action.trim())}`, { withCredentials: true }).then((r) => setData(r.data)).catch(() => {}); };
  return (
    <div>
      <form onSubmit={search} className="mb-4 flex gap-2"><input className="input max-w-xs" placeholder="Filter by action (e.g. platform.tenant)" value={action} onChange={(e) => setAction(e.target.value)} /><button className="btn btn-secondary" type="submit">Filter</button></form>
      {error ? <Empty text={error} /> : !data ? <Spinner /> : data.data.length === 0 ? <Empty text="No platform entries" /> : (
        <>
          <div className="table-wrap overflow-x-auto"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Fellowship</th><th>IP</th><th>Comment</th></tr></thead>
            <tbody>{data.data.map((r: any) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{new Date(r.timestamp).toLocaleString()}</td>
                <td className="text-xs">
                  {r.actor
                    ? <><span className="block font-medium text-ink">{r.actor.name || r.actor.email}</span>{r.actor.roles?.length > 0 && <span className="text-ink-subtle">{r.actor.roles.join(', ').replace(/_/g, ' ')}</span>}</>
                    : <span className="text-ink-subtle">system</span>}
                </td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="text-xs text-ink-muted">{r.entityType || 'â€”'} {r.entityId?.slice(0, 8)}</td>
                <td className="text-xs text-ink-muted">{r.tenant ? r.tenant.name : <span className="text-ink-subtle">platform</span>}</td>
                <td className="font-mono text-xs text-ink-muted">{r.ipAddress || 'â€”'}</td>
                <td className="text-ink-muted">{r.comment || ''}</td>
              </tr>
            ))}</tbody></table></div>
          <div className="mt-3 flex items-center justify-between text-sm text-ink-muted"><span>{data.total} entries</span><span className="space-x-2"><button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-secondary btn-sm" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button></span></div>
        </>
      )}
    </div>
  );
}

function InvoicesTab() {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    const p = new URLSearchParams({ page: String(page), limit: '25' });
    if (status) p.set('status', status);
    axios.get(`/platform/billing/invoices?${p}`, { withCredentials: true }).then((r) => { setData(r.data); setError(''); }).catch((e) => setError(errMsg(e, 'Could not load invoices')));
  }, [status, page]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="select w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {['open', 'paid', 'void'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <p className="flex-1 text-sm text-ink-muted">Every invoice raised on the platform. Open one to record a payment or void it.</p>
      </div>
      {error ? <Empty text={error} /> : !data ? <Spinner /> : data.data.length === 0 ? <Empty text="No invoices" /> : (
        <>
          <div className="table-wrap overflow-x-auto"><table className="table">
            <thead><tr><th>Number</th><th>Fellowship</th><th>Plan</th><th>Amount</th><th>Period</th><th>Due</th><th>Status</th><th>Payment</th></tr></thead>
            <tbody>{data.data.map((i: any) => (
              <tr key={i.id}>
                <td className="font-mono text-xs">{i.number}</td>
                <td className="font-medium text-ink">{i.fellowship || 'Unknown fellowship'}</td>
                <td className="text-xs text-ink-muted">{i.planName}</td>
                <td>{i.amount} {i.currency}</td>
                <td className="whitespace-nowrap text-xs text-ink-muted">{new Date(i.periodStart).toLocaleDateString()} â€“ {new Date(i.periodEnd).toLocaleDateString()}</td>
                <td className="whitespace-nowrap text-xs">{new Date(i.dueAt).toLocaleDateString()}</td>
                <td><span className={`status-badge ${i.status === 'paid' ? 'status-active' : i.status === 'open' ? 'status-submitted' : 'status-rejected'} capitalize`}>{i.status}</span></td>
                <td className="text-xs text-ink-muted">
                  {i.receipt ? <>{i.receipt.method || 'paid'}{i.receipt.reference ? ` Â· ${i.receipt.reference}` : ''}<br /><span className="text-ink-subtle">{new Date(i.receipt.paidAt).toLocaleDateString()}</span></> : i.voidedAt ? <span className="text-ink-subtle">voided {new Date(i.voidedAt).toLocaleDateString()}</span> : 'â€”'}
                </td>
              </tr>
            ))}</tbody></table></div>
          <div className="mt-3 flex items-center justify-between text-sm text-ink-muted"><span>{data.total} invoices</span><span className="space-x-2"><button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-secondary btn-sm" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button></span></div>
        </>
      )}
    </div>
  );
}

function WebhooksTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/platform/billing/webhook-events', { withCredentials: true }).then((r) => setRows(r.data)).catch((e) => { setRows([]); setError(errMsg(e, 'Could not load webhook events')); }); }, []);
  return (
    <div>
      <p className="mb-4 text-sm text-ink-muted">
        Inbound payment notifications. FEMS has no payment provider connected, so this stays empty until
        <span className="font-mono"> BILLING_WEBHOOK_SECRET</span> is configured and an external system starts posting signed events.
      </p>
      {error ? <Empty text={error} /> : !rows ? <Spinner /> : rows.length === 0 ? <Empty text="No webhook events received" /> : (
        <div className="table-wrap overflow-x-auto"><table className="table">
          <thead><tr><th>Received</th><th>Provider</th><th>Type</th><th>Event id</th><th>Status</th><th>Error</th></tr></thead>
          <tbody>{rows.map((e: any) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap text-xs">{new Date(e.receivedAt).toLocaleString()}</td>
              <td className="text-xs">{e.provider}</td>
              <td className="text-xs font-medium text-ink">{e.type}</td>
              <td className="font-mono text-xs text-ink-muted">{e.eventId}</td>
              <td><span className={`status-badge ${e.status === 'processed' ? 'status-active' : e.status === 'failed' ? 'status-rejected' : 'status-submitted'} capitalize`}>{e.status}</span></td>
              <td className="text-xs text-rose-700">{e.error || ''}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
}

function HealthTab() {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/health/system', { withCredentials: true }).then((r) => setD(r.data)).catch((e) => setError(errMsg(e, 'Could not load system health'))); }, []);
  if (error) return <Empty text={error} />;
  if (!d) return <Spinner />;
  const ok = (v: boolean) => v ? 'status-active' : 'status-rejected';
  const row = (k: string, v: any) => <tr key={k}><td className="text-ink-muted">{k}</td><td className="text-right font-medium text-ink">{v}</td></tr>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card"><p className="text-sm text-ink-muted">API</p><p className="text-2xl font-semibold text-ink">{d.application.version}</p><p className="mt-1 text-xs text-ink-subtle">{d.application.environment} Â· node {d.application.node}</p></div>
        <div className="card"><p className="text-sm text-ink-muted">Database</p><p className={`text-2xl font-semibold ${d.database.reachable ? 'text-emerald-700' : 'text-rose-700'}`}>{d.database.reachable ? 'Reachable' : 'Down'}</p><p className="mt-1 text-xs text-ink-subtle">{d.database.latencyMs} ms</p></div>
        <div className="card"><p className="text-sm text-ink-muted">Uptime</p><p className="text-2xl font-semibold text-ink">{Math.floor(d.application.uptimeSeconds / 60)} min</p><p className="mt-1 text-xs text-ink-subtle">since {new Date(d.application.startedAt).toLocaleTimeString()}</p></div>
        <div className="card"><p className="text-sm text-ink-muted">Migrations applied</p><p className={`text-2xl font-semibold ${d.migrations.failed ? 'text-rose-700' : 'text-ink'}`}>{d.migrations.applied}</p><p className="mt-1 text-xs text-ink-subtle">{d.migrations.failed ? `${d.migrations.failed} failed` : d.migrations.lastApplied ?? 'none'}</p></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Runtime</h3>
          <table className="table"><tbody>
            {row('Heap in use', `${d.process.memoryHeapUsedMb} MB`)}
            {row('Heap allocated', `${d.process.memoryHeapTotalMb} MB`)}
            {row('Resident set size', `${d.process.memoryRssMb} MB`)}
            {row('CPU time (user)', `${d.process.cpuUserMs} ms`)}
            {row('CPU time (system)', `${d.process.cpuSystemMs} ms`)}
            {row('Listening port', d.application.port)}
            {row('Timezone', d.application.timezone)}
          </tbody></table>
        </div>
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Integrations</h3>
          <table className="table">
            <thead><tr><th>Capability</th><th className="text-right">State</th></tr></thead>
            <tbody>
              <tr><td className="text-ink-muted">Payment notifications</td><td className="text-right"><span className={`status-badge ${ok(d.integrations.paymentProviderConfigured)}`}>{d.integrations.paymentProviderConfigured ? 'Configured' : 'Not configured'}</span></td></tr>
              <tr><td className="text-ink-muted">Shared rate-limit store</td><td className="text-right"><span className={`status-badge ${d.integrations.redisConfigured ? 'status-submitted' : 'status-inactive'}`}>{d.integrations.redisConfigured ? 'Configured (in-process)' : 'In-process only'}</span></td></tr>
              <tr><td className="text-ink-muted">Failed webhook events</td><td className="text-right font-medium">{d.integrations.failedWebhookEvents}</td></tr>
              <tr><td className="text-ink-muted">Oldest unprocessed event</td><td className="text-right font-medium">{d.integrations.oldestUnprocessedWebhookAt ? new Date(d.integrations.oldestUnprocessedWebhookAt).toLocaleString() : 'â€”'}</td></tr>
              <tr><td className="text-ink-muted">In-app backup execution</td><td className="text-right"><span className="status-badge status-inactive">Not available</span></td></tr>
              <tr><td className="text-ink-muted">Backup metadata rows</td><td className="text-right font-medium">{d.integrations.backupMetadataRows}</td></tr>
            </tbody></table>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-subtle">Operational notes</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {d.notes.map((n: string) => <li key={n}>{n}</li>)}
        </ul>
        <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-subtle">Measured at {new Date(d.generatedAt).toLocaleString()}.</p>
      </div>
    </div>
  );
}

const LIMITS: [string, string][] = [['max_users', 'Max user accounts'], ['max_members', 'Max members'], ['max_storage_mb', 'Max document storage (MB)']];

function PlansTab() {
  const { hasPermission } = useAuth();
  const manage = hasPermission('platform.billing_manage');
  const [rows, setRows] = useState<any[] | null>(null);
  const [dialog, setDialog] = useState<null | { plan?: any }>(null);
  const load = () => axios.get('/platform/billing/plans', { withCredentials: true }).then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const p = dialog?.plan;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Plans decide which optional modules a fellowship gets and how much it can add. They are configuration, not code. Fellowships without a subscription are not limited.</p>
        {manage && <button className="btn btn-primary" onClick={() => setDialog({})}><PlusIcon className="h-4 w-4" /> New plan</button>}
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty text="No plans yet" /> : (
        <div className="table-wrap overflow-x-auto"><table className="table"><thead><tr><th>Plan</th><th>Price</th><th>Trial</th><th>Modules</th><th>Limits</th><th>Fellowships</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.isActive ? '' : 'opacity-60'}>
              <td className="font-medium text-ink">{r.name}<span className="ml-2 font-mono text-xs text-ink-subtle">{r.code}</span>{!r.isActive && <span className="ml-2 status-badge status-inactive">Retired</span>}</td>
              <td>{r.price} {r.currency} / {r.billingInterval}</td><td>{r.trialDays ? `${r.trialDays} days` : 'â€”'}</td>
              <td className="text-xs">{r.modules.length ? r.modules.join(', ') : 'core only'}</td>
              <td className="text-xs">{Object.keys(r.limits).length ? Object.entries(r.limits).map(([k, v]) => `${k.replace('max_', '')}: ${v}`).join(', ') : 'none'}</td>
              <td>{r.subscribers}</td>
              <td className="text-right">{manage && <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ plan: r })}>Edit</button>}</td>
            </tr>
          ))}</tbody></table></div>
      )}
      {dialog && (
        <FormModal
          title={p ? `Edit ${p.name}` : 'New plan'}
          initial={p ? { name: p.name, description: p.description || '', price: p.price, trialDays: p.trialDays, isActive: p.isActive, ...Object.fromEntries(MODULES.map(([k]) => [`m_${k}`, p.modules.includes(k)])), ...Object.fromEntries(LIMITS.map(([k]) => [k, p.limits[k] ?? ''])) } : { currency: 'USD', billingInterval: 'month', price: 0, trialDays: 0 }}
          fields={[
            ...(p ? [] : [{ name: 'code', label: 'Code (permanent, e.g. standard)', required: true }]),
            { name: 'name', label: 'Name', required: true },
            { name: 'description', label: 'Description', type: 'textarea' },
            { name: 'price', label: 'Price', type: 'number', min: 0 },
            ...(p ? [] : [
              { name: 'currency', label: 'Currency (ISO code)' },
              { name: 'billingInterval', label: 'Billed', type: 'select' as const, options: [{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }] },
            ]),
            { name: 'trialDays', label: 'Free trial (days, 0 = none)', type: 'number', min: 0 },
            ...MODULES.map(([k, label]) => ({ name: `m_${k}`, label: `Includes: ${label}`, type: 'checkbox' as const })),
            ...LIMITS.map(([k, label]) => ({ name: k, label: `${label} (blank = unlimited)`, type: 'number' as const, min: 1 })),
            ...(p ? [{ name: 'isActive', label: 'Offered to new subscribers', type: 'checkbox' as const }] : []),
          ]}
          onSubmit={async (v) => {
            const body: any = {
              name: v.name, description: v.description || null, price: Number(v.price), trialDays: Number(v.trialDays || 0),
              modules: MODULES.filter(([k]) => v[`m_${k}`]).map(([k]) => k),
              limits: Object.fromEntries(LIMITS.filter(([k]) => v[k] !== '' && v[k] !== null && v[k] !== undefined).map(([k]) => [k, Number(v[k])])),
            };
            if (p) { body.isActive = !!v.isActive; await axios.put(`/platform/billing/plans/${p.id}`, body, { withCredentials: true }); }
            else await axios.post('/platform/billing/plans', { ...body, code: v.code, currency: v.currency || 'USD', billingInterval: v.billingInterval || 'month' }, { withCredentials: true });
            load();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function SubscriptionsTab() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const load = () => axios.get(`/platform/billing/subscriptions?limit=100${status ? `&status=${status}` : ''}`, { withCredentials: true }).then((r) => setRows(r.data.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, [status]);
  const runMaintenance = async () => {
    try { const r = await axios.post('/platform/billing/maintenance', {}, { withCredentials: true }); setNote(`Trials ended: ${r.data.trialsExpired} Â· marked overdue: ${r.data.pastDue} Â· expired after grace: ${r.data.expiredAfterGrace} Â· cancelled at period end: ${r.data.cancelledAtPeriodEnd}`); load(); } catch (e) { alert(errMsg(e, 'Failed')); }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="select w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['trialing', 'active', 'past_due', 'cancelled', 'expired'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
        <p className="flex-1 text-sm text-ink-muted">Open a fellowship to assign a plan, issue invoices and record payments. There is no payment provider connected: payments are recorded by an administrator.</p>
        {hasPermission('platform.billing_manage') && <button className="btn btn-secondary" onClick={runMaintenance}>Run overdue / trial check</button>}
      </div>
      {note && <p className="mb-3 rounded-lg bg-canvas p-3 text-sm text-ink">{note}</p>}
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty text="No subscriptions" /> : (
        <div className="table-wrap overflow-x-auto"><table className="table"><thead><tr><th>Fellowship</th><th>Plan</th><th>Status</th><th>Trial / paid until</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.fellowshipId} className="cursor-pointer hover:bg-canvas" onClick={() => navigate(`/platform/tenants/${r.fellowshipId}`)}>
              <td className="font-medium text-ink">{r.fellowship}</td><td>{r.plan.name}</td>
              <td><span className={`status-badge ${r.status === 'active' ? 'status-active' : r.status === 'trialing' ? 'status-submitted' : r.status === 'past_due' ? 'status-draft' : 'status-rejected'} capitalize`}>{r.status.replace('_', ' ')}</span>{r.cancelAtPeriodEnd && <span className="ml-2 text-xs text-amber-700">cancels at period end</span>}</td>
              <td>{new Date(r.trialEndsAt || r.currentPeriodEnd || 0).getTime() ? new Date(r.trialEndsAt || r.currentPeriodEnd).toLocaleDateString() : 'â€”'}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
}
