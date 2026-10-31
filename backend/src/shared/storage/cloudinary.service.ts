import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudinaryService {
  constructor(private config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get('CLOUDINARY_CLOUD_NAME') || 'dyyiogtro',
      api_key: this.config.get('CLOUDINARY_API_KEY'),
      api_secret: this.config.get('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    options: { folder?: string; publicId?: string; resourceType?: 'image' | 'video' | 'raw' | 'auto' } = {}
  ): Promise<{ url: string; publicId: string; format: string; width?: number; height?: number; bytes: number }> {
    return new Promise((resolve, reject) => {
      const uploadOptions = {
        folder: options.folder || 'fems',
        public_id: options.publicId,
        resource_type: options.resourceType || 'auto',
        overwrite: true,
        invalidate: true,
      };

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              format: result.format,
              width: result.width,
              height: result.height,
              bytes: result.bytes,
            });
          }
        }
      );

      uploadStream.end(file.buffer);
    });
  }

  async deleteFile(publicId: string, resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<void> {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  }

  async deleteFolder(folder: string): Promise<void> {
    await cloudinary.api.delete_resources_by_prefix(`fems/${folder}/`);
    await cloudinary.api.delete_folder(`fems/${folder}`);
  }

  getOptimizedUrl(publicId: string, options: { width?: string | number; height?: string | number; quality?: string | number; format?: string } = {}): string {
    return cloudinary.url(publicId, {
      fetch_format: options.format || 'auto',
      quality: options.quality || 'auto',
      width: options.width ? String(options.width) : undefined,
      height: options.height ? String(options.height) : undefined,
      crop: options.width || options.height ? 'fill' : undefined,
      gravity: 'auto',
      secure: true,
    });
  }

  getThumbnailUrl(publicId: string, width = 200, height = 200): string {
    return cloudinary.url(publicId, {
      width: String(width),
      height: String(height),
      crop: 'fill',
      gravity: 'face',
      fetch_format: 'auto',
      quality: 'auto',
      secure: true,
    });
  }
}