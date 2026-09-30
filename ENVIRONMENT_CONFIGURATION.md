# Environment Configuration Guide

This guide lists configuration the code actually reads. Development may use a local `.env`; production must inject real environment variables and must not ship a `.env` file.

## Backend

### Required in production

| Variable | Rule |
|---|---|
| `NODE_ENV` | exactly `production`; enables start-up refusal checks and disables env-file loading |
| `DATABASE_URL` | valid `postgres:`/`postgresql:` URL naming a database |
| `JWT_SECRET` | at least 32 characters, not a known placeholder, at least eight distinct characters; use a unique 48+ character random value per environment |
| `FRONTEND_URL` | exact public `https://` origin; no credentials, path, trailing slash, query or fragment; localhost/loopback refused |

`npm run start:prod` forces `NODE_ENV=production` before loading the application. If configuration is unsafe, the process exits non-zero with a sanitized reason. It does not print the supplied secret or connection string.

### Recommended / tuning

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | listener port; must be 1-65535 in production |
| `TRUST_PROXY` | unset | `1`, `true`, `false`, or comma-separated proxy addresses/subnets; set it to match the real topology |
| `BILLING_WEBHOOK_SECRET` | unset | HMAC secret for `POST /api/v1/billing/webhooks/signed`; at least 32 characters and non-placeholder when set |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | access-token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | refresh-token lifetime |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `600` | general per-client-address limit; the window is milliseconds |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` | `60000` / `10` | sign-in, refresh, password change/reset |
| `PUBLIC_RATE_LIMIT_WINDOW_MS` / `PUBLIC_RATE_LIMIT_MAX` | `60000` / `30` | public attendance link and billing webhook |
| `UPLOAD_MAX_SIZE` | `10485760` | maximum accepted upload bytes |
| `DATABASE_FORCE_UTC_SESSION` | `true` | adds `options=-c TimeZone=UTC` to the database URL; set `false` only for a pooler that rejects startup options, and set the database time zone to UTC separately |

Rate-limit counters are process-local. With N API instances the effective limit is approximately N times the configured value.

### Development only

| Variable | Meaning |
|---|---|
| `SEED_ADMIN_PASSWORD` | operator-supplied password used only by `npm run prisma:seed`; at least 12 characters, never printed, and the seeded account must change it at first login |

Seeding is refused when `NODE_ENV=production`.

### Not read by application code

Do not rely on these legacy names: `REDIS_URL`, `UPLOAD_DIR`, `ALLOWED_FILE_TYPES`, `BACKUP_*`, `BCRYPT_ROUNDS`, and the older `VITE_APP_*` PWA variables. Redis is unused, allowed upload types are fixed in code, hashing cost is fixed at 12, and in-app backup endpoints do not create dumps.

## Frontend (build time)

| Variable | Rule |
|---|---|
| `VITE_API_BASE_URL` | explicitly supplied for a release; must be https, non-local, contain no credentials/query/fragment, and have path exactly `/api/v1` |

The value is compiled into the browser bundle and is public. Never put a secret in a `VITE_*` variable. `npm run build:release` refuses an unset, local, unsafe or wrongly shaped value and does not print the value.

## Test database

`TEST_DATABASE_URL` is read only by backend integration tests. It must be a PostgreSQL URL whose decoded database name contains `test` or `scratch`. The setup file replaces `DATABASE_URL` with it before Nest/Prisma loads. The database must already have this checkout's migrations applied.

- `npm run test:integration` skips database-backed suites when the variable is absent.
- `npm run test:integration:required` refuses to run when it is absent or unsafe; use this as a release gate.
- Never point it at development, staging or production.

## Secret handling

- `.env` and `.env.*` are ignored; `.env.example` contains no usable secret.
- Passwords are stored only as bcrypt cost-12 hashes. Temporary/reset passwords are shown once and are not written to logs.
- Audit payloads are redacted for password/token/secret/key/hash/signature-like fields.
- No card or bank details are stored; FEMS has no payment provider.
- Rotate `JWT_SECRET` when leakage is suspected; all sessions end. Rotate `BILLING_WEBHOOK_SECRET` with the provider. Change database credentials with a rolling restart.
- Restrict log, audit and backup access because they can contain identifiers and operational data.

## Environment separation checklist

- separate databases and database users;
- separate `JWT_SECRET` and `BILLING_WEBHOOK_SECRET`;
- different `FRONTEND_URL` and `VITE_API_BASE_URL` per environment;
- production data is not copied to lower environments unless anonymised;
- no `.env` file is copied into an image or release bundle.
