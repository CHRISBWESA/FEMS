import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { assertProductionConfig, parseTrustProxy } from './config/security-config';
import { REQUEST_ID_HEADER } from './shared/middleware/request-context.middleware';

function safeStartupError(error: unknown): string {
  if (error instanceof Error && /^(JWT_SECRET|DATABASE_URL|FRONTEND_URL|TRUST_PROXY|RATE_LIMIT_|AUTH_RATE_LIMIT_|PUBLIC_RATE_LIMIT_|UPLOAD_MAX_SIZE|DATABASE_FORCE_UTC_SESSION|BILLING_WEBHOOK_SECRET)/.test(error.message)) {
    return error.message;
  }
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? ` (${error.code})`
    : '';
  return `The API failed to start${code}. Check runtime configuration, database connectivity, and the process manager.`;
}

async function bootstrap() {
  // Refuses to start on an unsafe production configuration (weak/missing JWT secret, CORS origin, database URL).
  for (const w of assertProductionConfig()) console.warn(`[config] ${w}`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The billing webhook verifies a signature over the exact bytes received, so the raw body is kept.
    rawBody: true,
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
      exposedHeaders: ['X-Total-Count', REQUEST_ID_HEADER],
    },
  });

  // Behind a reverse proxy the client IP (used for rate limiting) comes from X-Forwarded-For, but only if told to trust it.
  const trust = parseTrustProxy(process.env.TRUST_PROXY);
  if (trust !== undefined) app.set('trust proxy', trust);

  app.use(helmet());
  app.enableShutdownHooks(); // finish in-flight requests and close the database on SIGTERM
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Fellowship Management API running on port ${port}`);
}
bootstrap().catch((err) => {
  // A start-up failure (unsafe production configuration, database unreachable, port in use) must end the process with a
  // clear message and a non-zero exit code, so the process manager restarts it and the deployment check fails.
  console.error(safeStartupError(err));
  process.exit(1);
});
