/** Suite de integración contra PostgreSQL + PostGIS real (requiere TEST_DATABASE_URL). */
/** @type {import('jest').Config} */
module.exports = {
  ...require('./jest.config.js'),
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.int-spec.ts'],
  testTimeout: 20_000,
};
