import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/app-config.service';
import { AccountAccess, AccountAccessReader, ApiKeyPrincipal } from '../auth/auth-ports';
import { ApiScopes } from '../decorators/api-scopes.decorator';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AuthenticatedUser } from '../types/authenticated-user';
import { AuthGuard } from './auth.guard';

const ACCESS_SECRET = 'guard-access-secret-0123456789abcdef';
const API_KEY = 'rmk_0123456789ab_' + 'k'.repeat(43);

class TestController {
  @Public()
  open() {}

  closed() {}

  @Roles('ADMIN')
  adminOnly() {}

  @ApiScopes('trips:read')
  tripsRead() {}

  @ApiScopes()
  anyKey() {}
}

type Handler = 'open' | 'closed' | 'adminOnly' | 'tripsRead' | 'anyKey';

const account = (overrides: Partial<AccountAccess> = {}): AccountAccess => ({
  id: 'user-1',
  email: 'ana@example.com',
  role: 'USER',
  active: true,
  serviceAccount: false,
  sessionsRevokedAt: null,
  ...overrides,
});

const principal = (overrides: Partial<ApiKeyPrincipal> = {}): ApiKeyPrincipal => ({
  keyId: 'key-1',
  integrationId: 'integration-1',
  integrationName: 'ERP',
  userId: 'svc-1',
  userEmail: 'svc@integrations.invalid',
  scopes: ['trips:read'],
  rateLimitPerMinute: 600,
  ...overrides,
});

describe('AuthGuard', () => {
  const jwt = new JwtService();
  const config = { get: () => ({ accessSecret: ACCESS_SECRET }) } as unknown as AppConfigService;
  let accounts: Map<string, AccountAccess>;
  let keys: { authenticate: jest.Mock; track: jest.Mock };
  let guard: AuthGuard;

  beforeEach(() => {
    accounts = new Map([['user-1', account()]]);
    keys = {
      authenticate: jest.fn((raw: string) =>
        raw === API_KEY
          ? Promise.resolve(principal())
          : Promise.reject(new AppException(ErrorCode.INVALID_API_KEY, 'Invalid API key', 401)),
      ),
      track: jest.fn(),
    };
    const reader: AccountAccessReader = {
      get: (id) => Promise.resolve(accounts.get(id) ?? null),
      invalidate: () => undefined,
    };
    guard = new AuthGuard(new Reflector(), jwt, config, reader, keys);
  });

  const run = async (handler: Handler, headers: Record<string, string> = {}) => {
    const request: {
      headers: Record<string, string>;
      ip: string;
      user?: AuthenticatedUser;
    } = { headers, ip: '203.0.113.7' };
    const response = { statusCode: 200, once: jest.fn() };
    const context = {
      getHandler: () => TestController.prototype[handler],
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;
    const allowed = await guard.canActivate(context);
    return { allowed, user: request.user };
  };

  const token = (payload: Record<string, unknown>, secret = ACCESS_SECRET) =>
    jwt.signAsync(payload, { secret, expiresIn: 60 });

  const bearer = async (payload: Record<string, unknown> = {}) => ({
    authorization: `Bearer ${await token({
      sub: 'user-1',
      email: 'ana@example.com',
      role: 'USER',
      type: 'access',
      sv: 0,
      ...payload,
    })}`,
  });

  const failure = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AppException);
    return error as AppException;
  };

  const expectError = async (promise: Promise<unknown>, code: ErrorCode, status: number) => {
    const error = await failure(promise);
    expect(error.code).toBe(code);
    expect(error.getStatus()).toBe(status);
  };

  describe('access tokens', () => {
    it('rejects protected routes without credentials', async () => {
      await expectError(run('closed'), ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    });

    it('accepts a valid access token and exposes the account', async () => {
      await expect(run('closed', await bearer())).resolves.toEqual({
        allowed: true,
        user: { id: 'user-1', email: 'ana@example.com', role: 'USER' },
      });
    });

    it('rejects a refresh token presented as access token', async () => {
      const refresh = await token({ sub: 'user-1', jti: 'x', type: 'refresh' });
      await expectError(
        run('closed', { authorization: `Bearer ${refresh}` }),
        ErrorCode.UNAUTHORIZED,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects a token signed with another secret', async () => {
      const forged = await token(
        { sub: 'user-1', email: 'ana@example.com', role: 'ADMIN', type: 'access' },
        'attacker-secret-0123456789abcdef',
      );
      await expectError(
        run('closed', { authorization: `Bearer ${forged}` }),
        ErrorCode.UNAUTHORIZED,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('ignores authorization schemes other than Bearer', async () => {
      await expectError(
        run('closed', { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` }),
        ErrorCode.UNAUTHORIZED,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('lets anonymous requests and invalid tokens reach public routes anonymously', async () => {
      await expect(run('open')).resolves.toEqual({ allowed: true, user: undefined });
      await expect(run('open', { authorization: 'Bearer invalid' })).resolves.toEqual({
        allowed: true,
        user: undefined,
      });
    });

    it('identifies the caller on public routes when the token is valid', async () => {
      const result = await run('open', await bearer());
      expect(result.user?.id).toBe('user-1');
    });

    it('reads the role from the account, not from the token', async () => {
      // Promoted after the token was issued: no need to sign in again.
      accounts.set('user-1', account({ role: 'ADMIN' }));
      await expect(run('adminOnly', await bearer({ role: 'USER' }))).resolves.toMatchObject({
        allowed: true,
        user: { role: 'ADMIN' },
      });
      // Demoted: the old ADMIN claim of the token is worthless.
      accounts.set('user-1', account({ role: 'USER' }));
      await expectError(
        run('adminOnly', await bearer({ role: 'ADMIN' })),
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
      );
    });

    it('refuses the tokens of a disabled account', async () => {
      accounts.set('user-1', account({ active: false }));
      await expectError(
        run('closed', await bearer()),
        ErrorCode.ACCOUNT_DISABLED,
        HttpStatus.UNAUTHORIZED,
      );
      // Public routes still answer, anonymously.
      await expect(run('open', await bearer())).resolves.toEqual({
        allowed: true,
        user: undefined,
      });
    });

    it('refuses tokens issued before the sessions of the account were closed', async () => {
      const closedAt = Date.now();
      accounts.set('user-1', account({ sessionsRevokedAt: closedAt }));
      await expectError(
        run('closed', await bearer({ sv: closedAt - 1 })),
        ErrorCode.SESSION_REVOKED,
        HttpStatus.UNAUTHORIZED,
      );
      // Tokens without the claim (issued before the platform had it) are older too.
      await expectError(
        run('closed', await bearer({ sv: undefined })),
        ErrorCode.SESSION_REVOKED,
        HttpStatus.UNAUTHORIZED,
      );
      await expect(run('closed', await bearer({ sv: closedAt }))).resolves.toMatchObject({
        allowed: true,
      });
    });

    it('refuses tokens of deleted accounts and of integration accounts', async () => {
      accounts.delete('user-1');
      await expectError(
        run('closed', await bearer()),
        ErrorCode.UNAUTHORIZED,
        HttpStatus.UNAUTHORIZED,
      );
      accounts.set('user-1', account({ serviceAccount: true }));
      await expectError(
        run('closed', await bearer()),
        ErrorCode.UNAUTHORIZED,
        HttpStatus.UNAUTHORIZED,
      );
    });
  });

  describe('API keys', () => {
    beforeEach(() => accounts.set('svc-1', account({ id: 'svc-1', serviceAccount: true })));

    it('accepts a key with the scope of the route and acts as its account', async () => {
      const result = await run('tripsRead', { 'x-api-key': API_KEY });
      expect(result.user).toEqual({
        id: 'svc-1',
        email: 'ana@example.com',
        role: 'USER',
        apiKey: principal(),
      });
      expect(keys.track).toHaveBeenCalledWith(principal(), '203.0.113.7', expect.anything());
    });

    it('lists the missing scopes', async () => {
      keys.authenticate.mockResolvedValueOnce(principal({ scopes: ['geofences:read'] }));
      const error = await failure(run('tripsRead', { 'x-api-key': API_KEY }));
      expect(error.code).toBe(ErrorCode.API_KEY_SCOPE_MISSING);
      expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(error.details).toEqual({ required: ['trips:read'], missing: ['trips:read'] });
    });

    it('accepts any valid key on routes without required scopes', async () => {
      keys.authenticate.mockResolvedValueOnce(principal({ scopes: [] }));
      await expect(run('anyKey', { 'x-api-key': API_KEY })).resolves.toMatchObject({
        allowed: true,
      });
    });

    it('never accepts keys on routes that did not opt in (administration, sessions)', async () => {
      await expectError(
        run('adminOnly', { 'x-api-key': API_KEY }),
        ErrorCode.API_KEY_NOT_ALLOWED,
        HttpStatus.FORBIDDEN,
      );
      await expectError(
        run('closed', { 'x-api-key': API_KEY }),
        ErrorCode.API_KEY_NOT_ALLOWED,
        HttpStatus.FORBIDDEN,
      );
      expect(keys.authenticate).not.toHaveBeenCalled();
    });

    it('identifies the integration on public routes (for its quota)', async () => {
      const result = await run('open', { 'x-api-key': API_KEY });
      expect(result.user?.apiKey?.integrationId).toBe('integration-1');
    });

    it('refuses an invalid key, even on public routes', async () => {
      await expectError(
        run('open', { 'x-api-key': 'rmk_nope' }),
        ErrorCode.INVALID_API_KEY,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('refuses keys whose account was disabled or deleted', async () => {
      accounts.set('svc-1', account({ id: 'svc-1', active: false }));
      await expectError(
        run('tripsRead', { 'x-api-key': API_KEY }),
        ErrorCode.INVALID_API_KEY,
        HttpStatus.UNAUTHORIZED,
      );
      accounts.delete('svc-1');
      await expectError(
        run('tripsRead', { 'x-api-key': API_KEY }),
        ErrorCode.INVALID_API_KEY,
        HttpStatus.UNAUTHORIZED,
      );
      expect(keys.track).not.toHaveBeenCalled();
    });

    it('never grants roles to a key, even one of an administrator account', async () => {
      accounts.set('svc-1', account({ id: 'svc-1', role: 'ADMIN' }));
      const result = await run('tripsRead', { 'x-api-key': API_KEY });
      expect(result.user?.role).toBe('USER');
    });
  });
});
