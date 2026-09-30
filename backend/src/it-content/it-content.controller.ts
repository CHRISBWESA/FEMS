import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ItContentService, UploadDocumentDto, CreateAnnouncementDto } from './it-content.service';
import { contentDisposition, SAFE_DOWNLOAD_TYPE } from '../shared/utils/file-storage.util';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('it-content')
export class ItContentController {
  constructor(private readonly itContentService: ItContentService) {}

  // === Documents ===
  @Get('documents')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.IT_ADMIN,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.ORDINARY_MEMBER,
  )
  async findDocuments(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.itContentService.findDocuments(req.user, fellowshipId);
  }

  @Post('documents')
  // Without a limit multer buffers the whole upload in memory before any check runs.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: Number(process.env.UPLOAD_MAX_SIZE || 10 * 1024 * 1024), files: 1, fields: 20 } }))
  @Roles(
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.IT_ADMIN,
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
    @Req() req,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.itContentService.uploadDocument(body, file, req.user);
  }

  @Post('documents/:id/submit')
  @Roles(
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.IT_ADMIN,
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

  /**
   * The bytes of a document, for a signed-in member of the owning fellowship.
   *
   * The authenticated counterpart to the public download. Served as an opaque download with a `Content-Disposition`
   * rather than with the stored type, so a document cannot be opened as markup in a signed-in user's session -
   * the document list is a list of things to read, not to render.
   */
  @Get('documents/:id/download')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.IT_ADMIN,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.ORDINARY_MEMBER,
  )
  async downloadDocument(
    @Param('id') id: string,
    @Req() req,
    @Res() res: Response,
  ) {
    const { doc, bytes } = await this.itContentService.readDocument(id, req.user);
    // A full @Res(), for the same reason as the public route: with passthrough the Buffer would be JSON-encoded.
    res.setHeader('Content-Type', SAFE_DOWNLOAD_TYPE);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', contentDisposition(doc.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Private: a fellowship's own documents are never a shared cache's business.
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(bytes);
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
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.IT_ADMIN,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
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
  @Roles(ROLES.CHAIRPERSON, ROLES.ASSISTANT_CHAIRPERSON)
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
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.ORDINARY_MEMBER,
  )
  async findGallery(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.itContentService.findGallery(req.user, fellowshipId);
  }
}
