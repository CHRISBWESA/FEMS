// Type declaration for Multer
declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }
    interface Files {
      [fieldname: string]: File[];
    }
  }
}
