import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const STRONG_ACCESS = 'f3a9c1e7b2d84f60a5e1c9b7d3f2a8e4c6b0d9f1a2e3c4b5';
  const STRONG_REFRESH = '9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f';

  const env = (overrides: Record<string, unknown> = {}) => ({
    DATABASE_URL: 'postgresql://maps:secret@postgres:5432/maps',
    JWT_SECRET: 'development-access-secret',
    JWT_REFRESH_SECRET: 'development-refresh-secret',
    ...overrides,
  });

  it('accepts a development configuration', () => {
    const config = env({ APP_PORT: '3000', ROUTING_PROVIDER: 'valhalla' });
    expect(validateEnv(config)).toBe(config);
  });

  it.each([
    ['a missing DATABASE_URL', { DATABASE_URL: undefined }, /DATABASE_URL/],
    ['a short JWT secret', { JWT_SECRET: 'short' }, /JWT_SECRET must be at least 16/],
    ['an unknown routing engine', { ROUTING_PROVIDER: 'graphhopper' }, /ROUTING_PROVIDER/],
    ['an invalid port', { APP_PORT: '70000' }, /APP_PORT/],
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }, /NODE_ENV/],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => validateEnv(env(overrides))).toThrow(message);
  });

  describe('in production', () => {
    const production = (overrides: Record<string, unknown> = {}) =>
      env({
        NODE_ENV: 'production',
        JWT_SECRET: STRONG_ACCESS,
        JWT_REFRESH_SECRET: STRONG_REFRESH,
        ...overrides,
      });

    it('accepts strong, different secrets', () => {
      expect(() => validateEnv(production())).not.toThrow();
    });

    it.each([
      ['the .env.example placeholder', 'CHANGE_ME_access_token_secret_000000000'],
      ['a lowercase placeholder', 'please-changeme-before-going-live-0000'],
      ['a secret shorter than 32 characters', 'only-twenty-eight-characters'],
    ])('rejects %s', (_label, secret) => {
      expect(() => validateEnv(production({ JWT_SECRET: secret }))).toThrow(
        'JWT_SECRET must be a strong secret (>= 32 chars) in production',
      );
    });

    it('rejects reusing the access secret for refresh tokens', () => {
      expect(() => validateEnv(production({ JWT_REFRESH_SECRET: STRONG_ACCESS }))).toThrow(
        'JWT_SECRET and JWT_REFRESH_SECRET must be different in production',
      );
    });
  });
});
