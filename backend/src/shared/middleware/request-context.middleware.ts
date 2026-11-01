import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { clientIp, deviceSummary, runInRequestContext, type RequestContext } from './request-context.store';

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
    const context: RequestContext = {
      requestId,
      ip: clientIp(request.ip) ?? clientIp(request.header('x-forwarded-for')),
      userAgent: deviceSummary(request.header('user-agent')),
    };
    // Server-Timing lets the browser's network panel (and the frontend's own timing) show how long the server
    // and its database took. Written just before the headers go out; durations only, nothing about the data.
    const writeHead = response.writeHead;
    (response as any).writeHead = function (...args: any[]) {
      if (!response.headersSent) {
        const db = context.db;
        const parts = [`app;dur=${Date.now() - startedAt}`];
        if (db) parts.push(`db;dur=${Math.round(db.ms)};desc="${db.queries} queries"`);
        response.setHeader('Server-Timing', parts.join(', '));
      }
      return (writeHead as any).apply(this, args);
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
        dbQueries: context.db?.queries ?? 0,
        dbMs: Math.round(context.db?.ms ?? 0),
      }));
    };
    response.once('finish', log);
    response.once('close', log);
    runInRequestContext(context, next);
  }
}
