import { Module } from '@nestjs/common';
import { StorageModule } from '../shared/storage/storage.module';
import { DepartmentUploadsService } from '../department-workspace/department-uploads.service';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { FinanceSetupController } from './finance-setup.controller';
import { FinanceAccessService } from './finance-access.service';
import { FinanceReleaseService } from './finance-release.service';
import { FinanceCatalogService } from './finance-catalog.service';
import { FinanceIncomeService } from './finance-income.service';
import { FinancePledgesService } from './finance-pledges.service';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceScopeService } from './accounting/finance-scope.service';
import { FinanceNotifyService } from './accounting/finance-notify.service';
import { ContributionsCoreService } from './accounting/contributions-core.service';
import { AccountsService } from './accounting/accounts.service';
import { ExpensesFlowService } from './accounting/expenses-flow.service';
import { BudgetsService } from './accounting/budgets.service';
import { FeesService } from './accounting/fees.service';
import { ProjectsService } from './accounting/projects.service';
import { FundraisingService } from './accounting/fundraising.service';
import { StatementsService } from './accounting/statements.service';
import { FinanceApprovalsService } from './accounting/finance-approvals.service';
import { FinanceRemindersService } from './accounting/finance-reminders.service';
import { AccountingController, ProjectsController, PublicFundraisingController } from './accounting/accounting.controller';

@Module({
  imports: [StorageModule],
  providers: [
    FinanceService,
    FinanceAccessService,
    FinanceReleaseService,
    FinanceCatalogService,
    FinanceIncomeService,
    FinancePledgesService,
    FinanceReportsService,
    FinanceScopeService,
    FinanceNotifyService,
    ContributionsCoreService,
    AccountsService,
    ExpensesFlowService,
    BudgetsService,
    FeesService,
    ProjectsService,
    FundraisingService,
    StatementsService,
    FinanceApprovalsService,
    FinanceRemindersService,
    DepartmentUploadsService,
  ],
  controllers: [AccountingController, FinanceController, FinanceSetupController, ProjectsController, PublicFundraisingController],
  exports: [FinanceService, FinanceReportsService, FinanceScopeService, FinanceNotifyService, ExpensesFlowService],
})
export class FinanceModule {}
