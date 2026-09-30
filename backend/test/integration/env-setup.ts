// Runs before any test module is loaded. Two jobs:
//  1. SAFETY: refuse to run unless the target database name contains "test" or "scratch", so these
//     tests can never be pointed at a real/shared database by accident.
//  2. Force DATABASE_URL to TEST_DATABASE_URL *before* Nest/Prisma/dotenv read it, so the URL in
//     backend/.env can never win.
const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl) {
  const dbName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ''));
  if (!/(test|scratch)/i.test(dbName)) {
    throw new Error(
      `Refusing to run integration tests: database "${dbName}" does not look like a test/scratch database. ` +
        'The database name must contain "test" or "scratch".',
    );
  }
  process.env.DATABASE_URL = testUrl;
}

process.env.JWT_SECRET = 'integration-test-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '1h';
process.env.RATE_LIMIT_MAX = '1000000';
process.env.AUTH_RATE_LIMIT_MAX = '1000000';
process.env.PUBLIC_RATE_LIMIT_MAX = '1000000';
process.env.NODE_ENV = 'test';
