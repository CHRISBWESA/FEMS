import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { clientIp, deviceSummary, runInRequestContext } from './request-context.store';

export const REQUEST_ID_HEADER = 'X-Request-Id';

export function normalizeRequestId(value: unknown): string {
  if (typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value)) return value;
  return randomUUID();
}

function safeRoute(request: Request): string {
  const route = (request as any).route?.path;
  if (typeof route === 'string' && route.length <= 256) return route;
  return 'unmatched';
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Http');

  use(request: Request, response: Response, next: () => void): void {
    const requestId = normalizeRequestId(request.header(REQUEST_ID_HEADER));
    const startedAt = Date.now();
    (request as any).requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    // The address and user agent are captured here so AuditService can attribute any entry written while this
    // request is being served, without every service having to accept and pass a Request through.
    const context = {
      requestId,
      ip: clientIp(request.ip) ?? clientIp(request.header('x-forwarded-for')),
      userAgent: deviceSummary(request.header('user-agent')),
    };
    let logged = false;
    const log = () => {
      if (logged || process.env.NODE_ENV !== 'production') return;
      logged = true;
      this.logger.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId,
        method: request.method,
        route: safeRoute(request),
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      }));
    };
    response.once('finish', log);
    response.once('close', log);
    runInRequestContext(context, next);
  }
}
