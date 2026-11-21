/** Tests unitarios y HTTP con dobles en memoria (no requieren base de datos). */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: { '^@lacosta/domain$': '<rootDir>/../../packages/domain/src/index.ts' },
};
