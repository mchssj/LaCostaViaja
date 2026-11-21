/** Simulación de temporada alta (no corre en `pnpm test`): `pnpm --filter @lacosta/api test:sim`. */
/** @type {import('jest').Config} */
module.exports = {
  ...require('./jest.config.js'),
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.sim-spec.ts'],
  testTimeout: 300_000,
};
