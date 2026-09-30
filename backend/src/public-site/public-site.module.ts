import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicSiteService } from './public-site.service';
import { PublicSiteManageService } from './public-site-manage.service';
import { PublicSiteController } from './public-site.controller';
import { PublicSiteManageController } from './public-site-manage.controller';
import { PlatformSiteController, PlatformSiteService } from './platform-site.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PublicSiteController, PlatformSiteController, PublicSiteManageController],
  providers: [PublicSiteService, PublicSiteManageService, PlatformSiteService],
  exports: [PublicSiteService, PublicSiteManageService],
})
export class PublicSiteModule {}
