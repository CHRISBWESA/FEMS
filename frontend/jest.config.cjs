// Unit tests for the framework-free logic (offline store/outbox, PWA configuration guards). Component tests would
// need a DOM environment and are not part of this setup.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  transform: { '^.+\.tsx?$': '<rootDir>/jest.esbuild.cjs' },
  setupFiles: ['fake-indexeddb/auto'],
};
