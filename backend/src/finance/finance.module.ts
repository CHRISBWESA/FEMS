import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { FinanceSetupController } from './finance-setup.controller';
import { FinanceAccessService } from './finance-access.service';
import { FinanceReleaseService } from './finance-release.service';
import { FinanceCatalogService } from './finance-catalog.service';
import { FinanceIncomeService } from './finance-income.service';
import { FinancePledgesService } from './finance-pledges.service';
import { FinanceReportsService } from './finance-reports.service';

@Module({
  imports: [],
  providers: [
    FinanceService,
    FinanceAccessService,
    FinanceReleaseService,
    FinanceCatalogService,
    FinanceIncomeService,
    FinancePledgesService,
    FinanceReportsService,
  ],
  controllers: [FinanceController, FinanceSetupController],
  exports: [FinanceService, FinanceReportsService],
})
export class FinanceModule {}
