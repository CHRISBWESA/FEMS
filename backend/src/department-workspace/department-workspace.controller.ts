import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentLeadershipService } from './department-leadership.service';
import { DepartmentMembersService } from './department-members.service';
import { DepartmentActivitiesService } from './department-activities.service';
import { DepartmentReportsService } from './department-reports.service';
import { DepartmentFinanceService } from './department-finance.service';
import { DepartmentAnnouncementsService } from './department-announcements.service';
import { DepartmentDashboardService } from './department-dashboard.service';
import { DepartmentReviewsService, ReviewKind } from './department-reviews.service';
import { DepartmentUploadsService, MAX_UPLOAD_BYTES } from './department-uploads.service';
import { dateRange } from './department.util';

const UPLOAD_THROTTLE = {
  default: { limit: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 30), ttl: 60_000 },
};

function sendCsv(res: any, file: { filename: string; csv: string }) {
  const safe = file.filename.replace(/[^\w.\- ]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.send(file.csv);
}

// ------------------------------------------------------------------ Fellowship Secretary

@Controller('department-admin')
@Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
export class DepartmentAdminController {
  constructor(
    private leadership: DepartmentLeadershipService,
    private announcements: DepartmentAnnouncementsService,
  ) {}

  @Get('departments') list(@Req() req) {
    return this.leadership.list(req.user);
  }
  @Post('departments') create(@Req() req, @Body() body: any) {
    return this.leadership.create(req.user, body);
  }
  @Post('departments/standard') addStandard(@Req() req) {
    return this.leadership.addStandard(req.user);
  }
  @Get('departments/:id') get(@Req() req, @Param('id') id: string) {
    return this.leadership.get(req.user, id);
  }
  @Put('departments/:id') update(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.leadership.update(req.user, id, body);
  }
  @Post('departments/:id/leaders') appoint(@Req() req, @Param('id') id: string, @Body() body: any) {
    return this.leadership.appoint(req.user, id, body);
  }
  @Post('departments/:id/leaders/:role/vacate') vacate(
    @Req() req,
    @Param('id') id: string,
    @Param('role') role: string,
    @Body() body: any,
  ) {
    return this.leadership.vacate(req.user, id, role, body?.reason);
  }

  @Get('announcements') listAnnouncements(@Req() req, @Query() q: any) {
    return this.announcements.listAll(req.user, q);
  }
  @Post('announcements') createAnnouncement(@Req() req, @Body() body: any) {
    return this.announcements.create(req.user, body);
  }
  @Put('announcements/:id') updateAnnouncement(
    @Req() req,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.announcements.update(req.user, id, body);
  }
  @Post('announcements/:id/publish') publish(@Req() req, @Param('id') id: string) {
    return this.announcements.publish(req.user, id);
  }
  @Post('announcements/:id/archive') archive(@Req() req, @Param('id') id: string) {
    return this.announcements.archive(req.user, id);
  }
}

// ------------------------------------------------------------------ Department leaders

@Controller('department-workspace')
@Roles(ROLES.DEPARTMENT_CHAIRPERSON, ROLES.DEPARTMENT_SECRETARY)
export class DepartmentWorkspaceController {
  constructor(
    private access: DepartmentAccessService,
    private dashboard: DepartmentDashboardService,
    private members: DepartmentMembersService,
    private activities: DepartmentActivitiesService,
    private reports: DepartmentReportsService,
    private finance: DepartmentFinanceService,
    private announcements: DepartmentAnnouncementsService,
    private uploads: DepartmentUploadsService,
  ) {}

  @Get('me') me(@Req() req) {
    return this.dashboard.me(req.user);
  }
  @Get(':deptId/dashboard') home(@Req() req, @Param('deptId') d: string) {
    return this.dashboard.dashboard(req.user, d);
  }
  @Get(':deptId/leadership') leadership(@Req() req, @Param('deptId') d: string) {
    return this.dashboard.leadershipView(req.user, d);
  }
  @Get(':deptId/analytics') analytics(@Req() req, @Param('deptId') d: string, @Query() q: any) {
    return this.dashboard.analytics(req.user, d, dateRange(q.from, q.to));
  }

  // Members
  @Get(':deptId/members') listMembers(@Req() req, @Param('deptId') d: string, @Query() q: any) {
    return this.members.list(req.user, d, q);
  }
  @Get(':deptId/members/stats') memberStats(@Req() req, @Param('deptId') d: string) {
    return this.members.stats(req.user, d);
  }
  @Get(':deptId/members/candidates') candidates(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
  ) {
    return this.members.candidates(req.user, d, q);
  }
  @Get(':deptId/members/export') async exportMembers(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
    @Res() res,
  ) {
    sendCsv(res, await this.members.exportCsv(req.user, d, q));
  }
  @Get(':deptId/members/:memberId') memberDetail(
    @Req() req,
    @Param('deptId') d: string,
    @Param('memberId') m: string,
  ) {
    return this.members.detail(req.user, d, m);
  }
  @Post(':deptId/members') addMembers(@Req() req, @Param('deptId') d: string, @Body() body: any) {
    return this.members.add(req.user, d, body);
  }
  @Post(':deptId/members/:memberId/remove') removeMember(
    @Req() req,
    @Param('deptId') d: string,
    @Param('memberId') m: string,
    @Body() body: any,
  ) {
    return this.members.remove(req.user, d, m, body);
  }

  // Activities
  @Get(':deptId/activities') listActivities(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
  ) {
    return this.activities.list(req.user, d, q);
  }
  @Get(':deptId/activities/export') async exportActivities(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
    @Res() res,
  ) {
    sendCsv(res, await this.activities.exportCsv(req.user, d, q));
  }
  @Get(':deptId/activities/:id') getActivity(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
  ) {
    return this.activities.get(req.user, d, id);
  }
  @Post(':deptId/activities') createActivity(
    @Req() req,
    @Param('deptId') d: string,
    @Body() body: any,
  ) {
    return this.activities.create(req.user, d, body);
  }
  @Put(':deptId/activities/:id') updateActivity(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.activities.update(req.user, d, id, body);
  }
  @Post(':deptId/activities/:id/submit') submitActivity(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
  ) {
    return this.activities.submit(req.user, d, id);
  }
  @Post(':deptId/activities/:id/cancel') cancelActivity(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.activities.cancel(req.user, d, id, body);
  }
  @Post(':deptId/activities/:id/complete') completeActivity(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
  ) {
    return this.activities.complete(req.user, d, id);
  }

  // Reports
  @Get(':deptId/reports') listReports(@Req() req, @Param('deptId') d: string, @Query() q: any) {
    return this.reports.list(req.user, d, q);
  }
  @Get(':deptId/reports/export') async exportReports(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
    @Res() res,
  ) {
    sendCsv(res, await this.reports.exportCsv(req.user, d, q));
  }
  @Get(':deptId/reports/:id') getReport(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
  ) {
    return this.reports.get(req.user, d, id);
  }
  @Post(':deptId/reports') createReport(@Req() req, @Param('deptId') d: string, @Body() body: any) {
    return this.reports.create(req.user, d, body);
  }
  @Put(':deptId/reports/:id') updateReport(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.reports.update(req.user, d, id, body);
  }
  @Post(':deptId/reports/:id/submit') submitReport(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
  ) {
    return this.reports.submit(req.user, d, id);
  }

  // Financial requests
  @Get(':deptId/financial-requests') listFinance(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
  ) {
    return this.finance.list(req.user, d, q);
  }
  @Get(':deptId/financial-requests/export') async exportFinance(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
    @Res() res,
  ) {
    sendCsv(res, await this.finance.exportCsv(req.user, d, q));
  }
  @Get(':deptId/financial-requests/:id') getFinance(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
  ) {
    return this.finance.get(req.user, d, id);
  }
  @Post(':deptId/financial-requests') createFinance(
    @Req() req,
    @Param('deptId') d: string,
    @Body() body: any,
  ) {
    return this.finance.create(req.user, d, body);
  }
  @Post(':deptId/financial-requests/:id/resubmit') resubmitFinance(
    @Req() req,
    @Param('deptId') d: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.finance.resubmit(req.user, d, id, body);
  }

  // Announcements (read only)
  @Get(':deptId/announcements') announcementsFor(
    @Req() req,
    @Param('deptId') d: string,
    @Query() q: any,
  ) {
    return this.announcements.forDepartment(req.user, d, q);
  }

  // Supporting files
  @Post(':deptId/uploads')
  @Throttle(UPLOAD_THROTTLE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }),
  )
  async upload(@Req() req, @Param('deptId') d: string, @UploadedFile() file: Express.Multer.File) {
    const { department } = await this.access.assertLeader(req.user, d);
    return this.uploads.upload(req.user, department, file);
  }
}

// ------------------------------------------------------------------ Fellowship reviewers

@Controller('department-reviews')
@Roles(
  ROLES.SECRETARY,
  ROLES.ASSISTANT_SECRETARY,
  ROLES.CHAIRPERSON,
  ROLES.ASSISTANT_CHAIRPERSON,
  ROLES.TREASURER,
)
export class DepartmentReviewsController {
  constructor(private reviews: DepartmentReviewsService) {}

  @Get('summary') summary(@Req() req) {
    return this.reviews.summary(req.user);
  }
  @Get('pending') pending(@Req() req, @Query('kind') kind?: ReviewKind) {
    return this.reviews.pending(req.user, kind);
  }
  @Get(':kind') all(@Req() req, @Param('kind') kind: ReviewKind, @Query() q: any) {
    return this.reviews.all(req.user, kind, q);
  }
  @Get(':kind/:id') detail(@Req() req, @Param('kind') kind: ReviewKind, @Param('id') id: string) {
    return this.reviews.detail(req.user, kind, id);
  }
  @Post(':kind/:id/decide') decide(
    @Req() req,
    @Param('kind') kind: ReviewKind,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.reviews.decide(req.user, kind, id, body);
  }
}
