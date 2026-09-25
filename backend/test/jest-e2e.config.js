/**
 * End-to-end tests: the whole AppModule over HTTP against a real PostgreSQL +
 * PostGIS database (migrated by global-setup). The routing engine is replaced
 * by a deterministic fake; Valhalla itself is covered by the adapter tests and
 * by infrastructure/scripts/smoke-test.sh against the Docker stack.
 *
 *   E2E_DATABASE_URL=postgresql://maps:maps@localhost:5432/maps_e2e npm run test:e2e
 */
module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
};
