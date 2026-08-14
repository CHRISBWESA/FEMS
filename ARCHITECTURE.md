# Fellowship Management System - Architecture

## 1. Overview

```
┌─────────────────────┐    HTTPS    ┌──────────────────────────┐    ┌──────────────────┐
│  Frontend (PWA)     │◄───────────►│  Backend (RESTful API)    │◄──►│  PostgreSQL      │
│  React + Vite       │             │  NestJS (Node.js)         │    │  Relational DB   │
│  Service Worker     │             │  JWT + Session            │    │  ACID            │
│  Manifest           │             │  RBAC Guards              │    │  Constraints     │
│                     │             │  File Storage (local/s3)  │    │                  │
└─────────────────────┘             └──────────────────────────┘    └──────────────────┘
```

## 2. Technology Stack

### Frontend
- **Framework**: React 18 (Hooks, Context API for state management)
- **Build Tool**: Vite (fast HMR, PWA plugin included)
- **Styling**: Tailwind CSS (responsive, accessible)
- **PWA**: Vite PWA plugin (service worker, manifest, offline caching)
- **HTTP Client**: Axios with interceptors for auth
- **State Management**: React Query for server state, Context for auth

### Backend
- **Framework**: NestJS (modular, TypeScript, built-in DI, guards, interceptors)
- **ORM**: Prisma (type-safe, migrations, relations)
- **Database**: PostgreSQL
- **Authentication**: JWT + HttpOnly Secure cookies + Session tracking
- **Password Hashing**: bcrypt (salted, 12 rounds)
- **File Storage**: Multer for uploads, local filesystem (configurable to S3 later)
- **API Format**: RESTful JSON

### DevOps
- **Containerization**: Docker + Docker Compose (app, db, redis for rate limiting)
- **Configuration**: Environment variables (.env files)
- **Logging**: NestJS Logger + structured audit logs
- **Monitoring**: Basic health checks (extendable)

## 3. Architectural Principles

1. **Server-side authority**: All permissions, data isolation, approval workflows enforced on the server. No trust in frontend.
2. **Security by default**: RBAC guards on every endpoint, input validation, output encoding, CSRF tokens, rate limiting.
3. **Audit-first design**: Every mutation creates an audit log entry.
4. **Approval engines**: Reusable approval system for finance, reports, IT content, contributions edits, etc.
5. **Department isolation**: Queries filtered by department scope using guards.
6. **Separation of concerns**: Modular design (auth module, members module, departments module, finance module, etc.).

## 4. Module Structure (NestJS)

```
src/
├── auth/
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── jwt.strategy.ts
│   ├── local.strategy.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── rbac.guard.ts
│   │   ├── impersonate.guard.ts
│   │   └── department.guard.ts
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   └── permissions.decorator.ts
│   └── strategies/
├── members/
├── departments/
├── activities/
├── reports/
├── finance/
├── notifications/
├── audit/
├── recycle-bin/
├── backups/
├── it-content/
├── shared/
│   ├── approval-engine/
│   ├── notification-engine/
│   └── utils/
└── app.module.ts
```

## 5. Security Architecture

See SECURITY.md for full details. Summary:

- **Authentication**: JWT in HttpOnly Secure SameSite=Strict cookies
- **RBAC**: Role-based guards with permission constants
- **Department Scoping**: Department context injected per request
- **CSRF Protection**: Double-submit cookie pattern or same-origin checks + CSRF token
- **Rate Limiting**: Redis-based throttling (express-rate-limit equivalent)
- **IDOR Protection**: All entity access validated against user's role/department
- **Input Validation**: class-validator + DTOs for all inputs
- **Output Encoding**: Automatic via ORM + response sanitization

## 6. Data Flow

1. Client sends authenticated request with JWT cookie
2. NestJS Passport strategy validates JWT
3. RBAC guard checks permissions against user's roles
4. Department guard scopes data access
5. Controller receives validated, authorized request
6. Service applies business logic + approval state machine
7. Audit service logs every mutation
8. Notification engine generates in-app notifications
9. Response returned to client

## 7. Deployment

- **Development**: Docker Compose (app, db, redis)
- **Production**: Containerized, behind nginx reverse proxy, HTTPS, env-based config
- **Backups**: Cron job every 12 hours (pg_dump), stored local + cloud
- **Monitoring**: Health endpoint, logs to stdout for aggregation

## 8. PWA Architecture

- **Service Worker**: Cache-first for static assets, network-first for API calls, background sync for offline mutations
- **Manifest**: Full-screen display, theme colors, icons
- **Offline**: Dashboard shell cached, key data available offline with sync-on-reconnect
- **Installability**: meets Lighthouse PWA criteria
