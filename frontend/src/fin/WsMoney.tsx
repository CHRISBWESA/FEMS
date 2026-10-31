import { useWorkspace } from '../workspace/shared';
import { PageLoader } from '../components/ui';
import { useAuth } from '../App';
import { FinContext, FinScope } from './common';
import { FinanceNav, FinanceRoutes, useFinanceSettings } from './FinanceArea';

/**
 * The department workspace's own finances: the same screens as the fellowship's finance area, scoped to this
 * department's money. The server allows only this department's current leaders to act.
 */
export default function WsMoney() {
  const { department, path } = useWorkspace();
  const { user } = useAuth();
  const settings = useFinanceSettings();
  if (!settings.data && !settings.error) return <PageLoader rows={3} />;
  const scope: FinScope = {
    departmentId: department.departmentId,
    departmentName: department.name,
    roles: user?.roles ?? [],
    leaderRole: department.role,
    currency: settings.data?.currency ?? 'TZS',
    paymentMethods: settings.data?.payment_methods ?? ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'],
  };
  const base = path('money');
  return (
    <FinContext.Provider value={scope}>
      <div className="mx-auto max-w-7xl">
        <FinanceNav base={base} scope={scope} />
        <FinanceRoutes scope={scope} base={base} />
      </div>
    </FinContext.Provider>
  );
}
