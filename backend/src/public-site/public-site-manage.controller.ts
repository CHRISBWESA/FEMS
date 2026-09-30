import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { PublicSiteManageService } from './public-site-manage.service';

/**
 * The content manager's screen for a fellowship's landing page.
 *
 * `it_admin` is the fellowship's content manager (rule 6 of the account procedure: the IT role is exactly this and
 * nothing else), so it leads the list. The Secretary is included because whoever also runs the fellowship is a
 * `secretary` as well, and the platform administrator because it is the escalation path when a fellowship's own
 * content manager is gone.
 *
 * Note what is *not* here: `platform_support`. Support staff are read-only at platform level and hold no
 * fellowship, so they cannot reach a tenant's content through this controller.
 */
@Roles(ROLES.IT_ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY, ROLES.ADMIN)
@Controller('it-content/site')
export class PublicSiteManageController {
  constructor(private readonly manage: PublicSiteManageService) {}

  @Get()
  overview(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.overview(req.user, fellowshipId);
  }

  @Put('profile')
  updateProfile(@Req() req, @Body() body: any, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.updateProfile(req.user, body, fellowshipId);
  }

  @Put('pages/:key')
  updatePage(@Req() req, @Param('key') key: string, @Body() body: any, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.updatePage(req.user, key, body, fellowshipId);
  }

  @Post('subdomain')
  setSubdomain(@Req() req, @Body() body: any, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.setSubdomain(req.user, body, fellowshipId);
  }

  @Post('publish')
  setPublished(@Req() req, @Body() body: any, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.setPublished(req.user, body, fellowshipId);
  }

  @Post('posts')
  createPost(@Req() req, @Body() body: any, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.createPost(req.user, body, fellowshipId);
  }

  @Put('posts/:id')
  updatePost(@Req() req, @Param('id') id: string, @Body() body: any, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.updatePost(req.user, id, body, fellowshipId);
  }

  @Delete('posts/:id')
  deletePost(@Req() req, @Param('id') id: string, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.deletePost(req.user, id, fellowshipId);
  }

  @Get('enquiries')
  listEnquiries(
    @Req() req,
    @Query('kind') kind?: string,
    @Query('isHandled') isHandled?: string,
    @Query('fellowshipId') fellowshipId?: string,
  ) {
    return this.manage.listEnquiries(req.user, { kind, isHandled }, fellowshipId);
  }

  @Post('enquiries/:id/handled')
  markHandled(@Req() req, @Param('id') id: string, @Query('fellowshipId') fellowshipId?: string) {
    return this.manage.markEnquiryHandled(req.user, id, fellowshipId);
  }
}
