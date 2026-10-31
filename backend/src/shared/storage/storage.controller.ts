import { Controller, Post, UseInterceptors, UploadedFile, Body, Req, Get, Param, Res, Query, Delete } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from './cloudinary.service';
import { Response } from 'express';

@Controller('storage')
export class StorageController {
  constructor(private cloudinary: CloudinaryService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { folder?: string; resourceType?: 'image' | 'video' | 'raw' | 'auto' },
    @Req() req,
  ) {
    if (!file) {
      return { success: false, error: 'No file uploaded' };
    }

    try {
      const result = await this.cloudinary.uploadFile(file, {
        folder: body.folder || `fellowship-${req.user.fellowshipId}`,
        resourceType: body.resourceType || 'auto',
      });

      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Post('upload-multiple')
  @UseInterceptors(FileInterceptor('files', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadMultiple(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { folder?: string; resourceType?: 'image' | 'video' | 'raw' | 'auto' },
    @Req() req,
  ) {
    // For multiple files, we'd need a different interceptor
    return { success: false, error: 'Use /upload for single files' };
  }

  @Get('download/:publicId')
  async downloadFile(@Param('publicId') publicId: string, @Res() res: Response) {
    // This would typically redirect to the Cloudinary URL
    // For now, return the URL
    const url = this.cloudinary.getOptimizedUrl(publicId);
    res.redirect(url);
  }

  @Get('optimized/:publicId')
  getOptimizedUrl(@Param('publicId') publicId: string, @Query() query: { w?: string; h?: string; q?: string; f?: string }) {
    const url = this.cloudinary.getOptimizedUrl(publicId, {
      width: query.w ? parseInt(query.w) : undefined,
      height: query.h ? parseInt(query.h) : undefined,
      quality: query.q,
      format: query.f,
    });
    return { url };
  }

  @Get('thumbnail/:publicId')
  getThumbnail(@Param('publicId') publicId: string, @Query() query: { w?: string; h?: string }) {
    const url = this.cloudinary.getThumbnailUrl(publicId, query.w ? parseInt(query.w) : 200, query.h ? parseInt(query.h) : 200);
    return { url };
  }

  @Delete(':publicId')
  async deleteFile(@Param('publicId') publicId: string, @Body() body: { resourceType?: 'image' | 'video' | 'raw' }) {
    await this.cloudinary.deleteFile(publicId, body.resourceType || 'image');
    return { success: true };
  }
}