import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Req,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ItContentService, UploadDocumentDto, CreateAnnouncementDto } from './it-content.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('it-content')
export class ItContentController {
  constructor(private readonly itContentService: ItContentService) {}

  // === Documents ===
  @Get('documents')
  @Roles(
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.ORDINARY_MEMBER,
  )
  async findDocuments(@Req() req) {
    return this.itContentService.findDocuments(req.user);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  @Roles(
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
    @Req() req,
  ) {
    if (!file) {
      throw new Error('File is required');
    }
    return this.itContentService.uploadDocument(body, file, req.user);
  }

  @Post('documents/:id/submit')
  @Roles(
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
  )
  async submitDocument(@Param('id') id: string, @Req() req) {
    return this.itContentService.submitForApproval(id, req.user);
  }

  @Post('documents/:id/approve')
  @Roles(
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
  )
  async approveDocument(
    @Param('id') id: string,
    @Body() body: { decision: 'approved' | 'rejected'; comment?: string },
    @Req() req,
  ) {
    return this.itContentService.approveDocument(id, body.decision, body.comment || '', req.user);
  }

  @Post('documents/:id/request-delete')
  @Roles(
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.SECRETARY,
    )
  async requestDelete(@Param('id') id: string, @Req() req) {
    return this.itContentService.requestDelete(id, req.user);
  }

  // === Announcements ===
  @Get('announcements')
  @Roles(
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.ORDINARY_MEMBER,
  )
  async findAnnouncements(@Req() req) {
    return this.itContentService.findAnnouncements(req.user);
  }

  @Post('announcements')
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async createAnnouncement(@Body() body: CreateAnnouncementDto, @Req() req) {
    return this.itContentService.createAnnouncement(body, req.user);
  }

  @Post('announcements/:id/approve')
  @Roles(ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON, ROLES.SECRETARY)
  async approveAnnouncement(
    @Param('id') id: string,
    @Body() body: { decision: 'approved' | 'rejected'; comment?: string },
    @Req() req,
  ) {
    return this.itContentService.approveAnnouncement(id, body.decision, body.comment || '', req.user);
  }

  // === Gallery ===
  @Get('gallery')
  @Roles(
    ROLES.SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.ORDINARY_MEMBER,
  )
  async findGallery(@Req() req) {
    return this.itContentService.findGallery(req.user);
  }
}
