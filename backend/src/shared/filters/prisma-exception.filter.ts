import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Turns database errors that would otherwise surface as an opaque 500 into the right client error, without
 * ever echoing database details (table, column or constraint names) to the caller. The detail is logged.
 *   malformed id / invalid input   -> 400        record not found        -> 404
 *   number out of range / NUL byte -> 400
 *   unique / foreign-key conflict  -> 409        anything else           -> 500 (generic)
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError, Prisma.PrismaClientUnknownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Database');

  catch(exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError | Prisma.PrismaClientUnknownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'The request contains an invalid value.';
    } else if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      // Text the database refuses to store (a NUL byte, an unsupported unicode escape) is the client's fault, not ours.
      if (/0x00|invalid byte sequence|unsupported Unicode escape|cannot be converted to text/i.test(exception.message)) {
        status = HttpStatus.BAD_REQUEST;
        message = 'The request contains an invalid value.';
      }
    } else {
      switch (exception.code) {
        case 'P2002': status = HttpStatus.CONFLICT; message = 'This record already exists.'; break;
        case 'P2003': status = HttpStatus.CONFLICT; message = 'This record is still referenced by other data or refers to something that does not exist.'; break;
        case 'P2025': status = HttpStatus.NOT_FOUND; message = 'Record not found.'; break;
        case 'P2023': case 'P2006': case 'P2007': case 'P2020': status = HttpStatus.BAD_REQUEST; message = 'The request contains an invalid value.'; break;
        default: break;
      }
    }
    const requestId = req?.requestId || 'unknown';
    const route = typeof req?.route?.path === 'string' ? req.route.path : 'unmatched';
    const errorCode = (exception as any).code ?? 'validation';
    this.logger.warn(`${req?.method || 'UNKNOWN'} ${route} -> ${status} requestId=${requestId} (${errorCode})`);
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Database request failed requestId=${requestId} code=${errorCode}`);
    }
    res.status(status).json({ statusCode: status, message, error: HttpStatus[status] });
  }
}
