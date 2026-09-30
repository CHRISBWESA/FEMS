import { Module } from '@nestjs/common';
import { ResourcesController } from './resources.controller';
import { ResourcesAccessService } from './resources-access.service';
import { ResourcesCatalogService } from './resources-catalog.service';
import { AssetsService } from './assets.service';
import { AssetLoansService } from './asset-loans.service';
import { AssetMaintenanceService } from './asset-maintenance.service';
import { ResourcesReportsService } from './resources-reports.service';

@Module({
  providers: [
    ResourcesAccessService,
    ResourcesCatalogService,
    AssetsService,
    AssetLoansService,
    AssetMaintenanceService,
    ResourcesReportsService,
  ],
  controllers: [ResourcesController],
  exports: [ResourcesReportsService],
})
export class ResourcesModule {}
