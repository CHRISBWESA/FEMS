import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProgrammesService, CreateProgrammeDto } from './programmes.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

@Controller('programmes')
export class ProgrammesController {
  constructor(private readonly programmesService: ProgrammesService) {}

  @Get()
  @Roles(ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async findAll(@Req() req, @Query('fellowshipId') fellowshipId?: string) {
    return this.programmesService.findAll(req.user, fellowshipId);
  }

  @Post()
  @Roles(ROLES.SECRETARY)
  async create(@Body() body: CreateProgrammeDto, @Req() req) {
    return this.programmesService.create(body, req.user);
  }

  @Post('bulk-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @Roles(ROLES.SECRETARY)
  async bulkUpload(@UploadedFile() file: Express.Multer.File, @Req() req) {
    return this.programmesService.bulkCreate(file, req.user);
  }

  @Put(':id')
  @Roles(ROLES.SECRETARY)
  async update(@Param('id') id: string, @Body() body: CreateProgrammeDto, @Req() req) {
    return this.programmesService.update(id, body, req.user);
  }

  @Delete(':id')
  @Roles(ROLES.SECRETARY)
  async remove(@Param('id') id: string, @Req() req) {
    await this.programmesService.remove(id, req.user);
    return { message: 'Programme deleted' };
  }
}
