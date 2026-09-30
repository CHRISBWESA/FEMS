import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';

// PostgreSQL text and jsonb columns cannot hold U+0000. Prisma reports it as an opaque internal error, which used to
// reach the client as a 500 from nearly every endpoint that accepts text. No legitimate client sends it, so it is
// refused up front - in the body (including object keys), the query string and the path.
export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (value === null || typeof value !== 'object' || depth > 25) return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(([k, v]) => k.includes('\u0000') || containsNul(v, depth + 1));
}

@Injectable()
export class RejectNulBytesMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    if (/%00/i.test(String(req.originalUrl ?? req.url ?? '')) || containsNul(req.body) || containsNul(req.query)) {
      throw new BadRequestException('The request contains an invalid character.');
    }
    next();
  }
}
