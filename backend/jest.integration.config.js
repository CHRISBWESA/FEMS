/**
 * Real-Postgres integration tests (full AppModule over HTTP with real JWTs).
 * Skipped unless TEST_DATABASE_URL is set. See test/integration/env-setup.ts for the safety guard.
 *   TEST_DATABASE_URL=postgresql://.../fems_something_scratch npm run test:integration
 * The target database must already have this repo's migrations applied (`prisma migrate deploy`).
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  setupFiles: ['<rootDir>/test/integration/env-setup.ts'],
  testEnvironment: 'node',
  testTimeout: 60000,
  maxWorkers: 1,
};
