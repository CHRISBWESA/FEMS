import { Body, Controller, Get, Module, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { StorageModule } from '../shared/storage/storage.module';
import { DepartmentWorkspaceModule } from '../department-workspace/department-workspace.module';
import { MembersModule } from '../members/members.module';
import { DepartmentUploadsService, MAX_UPLOAD_BYTES } from '../department-workspace/department-uploads.service';
import { reportToPdf, reportToXlsx } from '../finance/accounting/exporters';
import { LeadershipService } from './leadership.service';

const VIEWERS = [ROLES.FELLOWSHIP_ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.TREASURER];
const MANAGERS = [ROLES.FELLOWSHIP_ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY];

/** Leadership management. @Roles is a coarse gate; the service checks who may manage each kind of office. */
@Controller('leadership')
export class LeadershipController {
  constructor(private leadership: LeadershipService, private uploads: DepartmentUploadsService) {}

  @Get('positions') @Roles(...VIEWERS) positions(@Req() req) { return this.leadership.positions(req.user); }
  @Post('positions') @Roles(ROLES.FELLOWSHIP_ADMIN, ROLES.SECRETARY) createPosition(@Req() req, @Body() b) { return this.leadership.createPosition(req.user, b); }
  @Put('positions/:id') @Roles(ROLES.FELLOWSHIP_ADMIN, ROLES.SECRETARY) updatePosition(@Req() req, @Param('id') id: string, @Body() b) { return this.leadership.updatePosition(req.user, id, b); }

  @Get('appointments') @Roles(...VIEWERS) list(@Req() req, @Query() q) { return this.leadership.list(req.user, q); }
  @Post('appointments') @Roles(...MANAGERS) appoint(@Req() req, @Body() b) { return this.leadership.appoint(req.user, b); }
  @Get('appointments/:id') @Roles(...VIEWERS) detail(@Req() req, @Param('id') id: string) { return this.leadership.detail(req.user, id); }
  @Put('appointments/:id') @Roles(...MANAGERS) updateTerm(@Req() req, @Param('id') id: string, @Body() b) { return this.leadership.updateTerm(req.user, id, b); }
  @Post('appointments/:id/end') @Roles(...MANAGERS) end(@Req() req, @Param('id') id: string, @Body() b) { return this.leadership.end(req.user, id, b); }
  @Post('appointments/:id/suspend') @Roles(...MANAGERS) suspend(@Req() req, @Param('id') id: string, @Body() b) { return this.leadership.suspend(req.user, id, b); }
  @Post('appointments/:id/reinstate') @Roles(...MANAGERS) reinstate(@Req() req, @Param('id') id: string) { return this.leadership.reinstate(req.user, id); }

  @Get('scopes') @Roles(...VIEWERS) scopes(@Req() req) { return this.leadership.scopes(req.user); }
  @Get('member-search') @Roles(...VIEWERS) searchMembers(@Req() req, @Query() q) { return this.leadership.searchMembers(req.user, q); }
  @Get('current') @Roles(...VIEWERS) current(@Req() req, @Query() q) { return this.leadership.current(req.user, q); }
  @Get('members/:id') @Roles(...VIEWERS) member(@Req() req, @Param('id') id: string) { return this.leadership.memberProfile(req.user, id); }
  @Put('members/:id/photo') @Roles(...MANAGERS) photo(@Req() req, @Param('id') id: string, @Body() b) { return this.leadership.setPhoto(req.user, id, b); }
  @Post('uploads') @Roles(...MANAGERS) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  upload(@Req() req, @UploadedFile() file: Express.Multer.File) { return this.uploads.upload(req.user, { id: 'leadership', fellowship_id: req.user.fellowshipId }, file); }

  @Get('export') @Roles(...VIEWERS)
  async export(@Req() req, @Query() q, @Res() res: Response) {
    const r = await this.leadership.exportReport(req.user, q);
    const name = `${r.key}-${r.generatedAt.toISOString().slice(0, 10)}`;
    if (q?.format === 'xlsx') { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); return res.send(await reportToXlsx(r)); }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    return res.send(await reportToPdf(r));
  }
}

@Module({
  imports: [StorageModule, DepartmentWorkspaceModule, MembersModule],
  providers: [LeadershipService, DepartmentUploadsService],
  controllers: [LeadershipController],
  exports: [LeadershipService],
})
export class LeadershipModule {}
