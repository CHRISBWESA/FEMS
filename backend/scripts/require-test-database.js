const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is required. Database-backed integration tests are being blocked, not reported as passed.');
  process.exit(1);
}
let database;
try {
  database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
} catch {
  console.error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.');
  process.exit(1);
}
if (!/(test|scratch)/i.test(database)) {
  console.error('TEST_DATABASE_URL must name a database containing "test" or "scratch".');
  process.exit(1);
}
