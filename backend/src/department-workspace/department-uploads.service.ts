import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryService } from '../shared/storage/cloudinary.service';
import { AuditService } from '../shared/audit/audit.service';
import { Attachment } from './department.util';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Allowed types, with the first bytes each must start with, so a renamed executable is refused.
const TYPES: Record<string, { kind: 'image' | 'raw'; magic: number[][] }> = {
  'image/jpeg': { kind: 'image', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { kind: 'image', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { kind: 'image', magic: [[0x52, 0x49, 0x46, 0x46]] },
  'image/gif': { kind: 'image', magic: [[0x47, 0x49, 0x46, 0x38]] },
  'application/pdf': { kind: 'raw', magic: [[0x25, 0x50, 0x44, 0x46]] },
  // Office Open XML documents are zip files.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'raw',
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'raw',
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    kind: 'raw',
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  // Legacy Office (OLE2).
  'application/msword': { kind: 'raw', magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  'application/vnd.ms-excel': { kind: 'raw', magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
};

/** Supporting photos and documents for department activities, reports and requests, stored in Cloudinary. */
@Injectable()
export class DepartmentUploadsService {
  constructor(
    private cloudinary: CloudinaryService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  async upload(
    user: any,
    department: any,
    file: Express.Multer.File | undefined,
  ): Promise<Attachment> {
    if (!file || !file.buffer?.length) throw new BadRequestException('Choose a file to upload.');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('Files can be at most 10 MB.');
    const type = TYPES[file.mimetype];
    if (!type)
      throw new BadRequestException(
        'Only photos (JPEG, PNG, WebP, GIF), PDF, Word, Excel and PowerPoint files can be uploaded.',
      );
    if (!type.magic.some((sig) => sig.every((b, i) => file.buffer[i] === b))) {
      throw new BadRequestException('The file content does not match its type.');
    }
    if (!this.config.get('CLOUDINARY_API_KEY') || !this.config.get('CLOUDINARY_API_SECRET')) {
      throw new ServiceUnavailableException('File storage is not configured on the server yet.');
    }
    const result = await this.cloudinary.uploadFile(file, {
      folder: `fems/f-${department.fellowship_id}/d-${department.id}`,
      resourceType: type.kind,
    });
    const name = (file.originalname || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 200);
    await this.audit.log({
      userId: user.userId,
      action: 'department.file_upload',
      entityType: 'department',
      entityId: department.id,
      newValue: { name, bytes: result.bytes, publicId: result.publicId },
    });
    return {
      url: result.url,
      publicId: result.publicId,
      name,
      type: file.mimetype,
      bytes: result.bytes,
    };
  }
}
