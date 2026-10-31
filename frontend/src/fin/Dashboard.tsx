import { BanknotesIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon, ClockIcon, HandRaisedIcon, ChartPieIcon } from '@heroicons/react/24/outline';
import { Card, ErrorState, PageHeader, PageLoader, StatCard, StatGrid, Button, useToast } from '../components/ui';
import { useI18n } from '../context/I18nContext';
import axios from 'axios';
import { errMsg, fmtDate, fmtMoney, label, MonthlyBars, Row, scopeQuery, useFin, useLoad } from './common';

export default function FinDashboard() {
  const s = useFin();
  const { t } = useI18n();
  const toast = useToast();
  const { data: d, error, reload } = useLoad<any>(`/finance/dashboard?${scopeQuery(s)}`, [s.departmentId]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!d) return <PageLoader rows={3} />;
  const c = d.cards;
  const runReminders = async () => {
    try {
      const r = (await axios.post('/finance/reminders/run', {}, { withCredentials: true })).data;
      toast.push('success', `Reminders sent: ${r.pledgesDueSoon + r.pledgesOverdue} pledges, ${r.budgetDeadlines} budget deadlines, ${r.reconciliations} reconciliations.`);
    } catch (e) { toast.push('error', errMsg(e, 'Could not send reminders.')); }
  };
  const canRemind = !s.departmentId && s.roles.some((r) => ['treasurer', 'secretary', 'assistant_secretary'].includes(r));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={d.label} title={t('fin.nav.dashboard')} description={t('fin.dashboard.desc')}
        actions={canRemind ? <Button size="sm" onClick={runReminders}>{t('fin.sendReminders')}</Button> : undefined} />
      <StatGrid>
        <StatCard label={t('fin.card.income')} value={fmtMoney(c.totalIncome, s.currency)} hint={t('fin.card.thisYear')} icon={<ArrowTrendingUpIcon className="h-5 w-5" />} tone="success" />
        <StatCard label={t('fin.card.expenses')} value={fmtMoney(c.totalExpenses, s.currency)} hint={t('fin.card.paidThisYear')} icon={<ArrowTrendingDownIcon className="h-5 w-5" />} tone="danger" />
        <StatCard label={t('fin.card.balance')} value={fmtMoney(c.availableBalance, s.currency)} hint={t('fin.card.allAccounts')} icon={<BanknotesIcon className="h-5 w-5" />} tone="primary" />
        <StatCard label={t('fin.card.pending')} value={c.pendingApprovals} hint={t('fin.card.waitingForYou')} icon={<ClockIcon className="h-5 w-5" />} tone={c.pendingApprovals ? 'warning' : 'neutral'} to={s.departmentId ? 'approvals' : '/finance/approvals'} />
        <StatCard label={t('fin.card.pledges')} value={fmtMoney(c.outstandingPledges, s.currency)} hint={c.overduePledges ? `${c.overduePledges} overdue · not yet received` : 'Promised, not yet received'} icon={<HandRaisedIcon className="h-5 w-5" />} tone={c.overduePledges ? 'danger' : 'neutral'} />
        <StatCard label={t('fin.card.budget')} value={c.budgetUtilisationPercent === null ? '—' : `${c.budgetUtilisationPercent}%`} hint={`${fmtMoney(c.budgetSpent, s.currency)} of ${fmtMoney(c.budgetApproved, s.currency)}`} icon={<ChartPieIcon className="h-5 w-5" />} tone={c.budgetUtilisationPercent > 90 ? 'danger' : 'neutral'} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="card-pad lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('fin.last12')}</h2>
          <MonthlyBars rows={d.monthly} currency={s.currency} />
        </Card>
        <Card className="card-pad">
          {d.generalFund ? (
            <>
              <h2 className="mb-2 text-sm font-semibold text-ink">{t('fin.generalFund')}</h2>
              <Row k="Central accounts" v={fmtMoney(d.generalFund.centralBalance, s.currency)} />
              <Row k="Earmarked for projects" v={fmtMoney(d.generalFund.earmarkedForProjects, s.currency)} />
              <Row k="Available" v={<span className="text-success">{fmtMoney(d.generalFund.available, s.currency)}</span>} />
              <p className="mt-2 text-xs text-ink-subtle">Moving General Fund money to a project is an allocation, not new income.</p>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-sm font-semibold text-ink">{t('fin.departmentPosition')}</h2>
              <Row k="Contributions" v={fmtMoney(d.department.contributionsCollected, s.currency)} />
              <Row k="Membership fees collected" v={fmtMoney(d.department.membershipFeesCollected, s.currency)} />
              <Row k="Membership fees outstanding" v={fmtMoney(d.department.outstandingMembershipFees, s.currency)} />
              <Row k="Spent" v={fmtMoney(d.department.totalExpenditure, s.currency)} />
              <Row k="Approved budget" v={fmtMoney(d.department.approvedBudget, s.currency)} />
            </>
          )}
        </Card>
      </div>

      <Card className="card-pad">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('fin.recent')}</h2>
        {d.recent.length === 0 ? <p className="text-sm text-ink-muted">{t('fin.noTransactions')}</p> : (
          <ul className="divide-y divide-hairline">
            {d.recent.map((e: any) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-ink">{e.description || label(e.type)}</span>
                  <span className="text-xs text-ink-subtle">{fmtDate(e.date)} · {e.account} · {label(e.type)}{e.reference ? ` · ${e.reference}` : ''}</span>
                </span>
                <span className={`shrink-0 tabular-nums ${Number(e.amount) < 0 ? 'text-danger' : 'text-success'}`}>{fmtMoney(e.amount, s.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
