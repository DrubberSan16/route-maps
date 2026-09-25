import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/app-config.service';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AuthenticatedUser } from '../types/authenticated-user';
import { JwtAuthGuard } from './jwt-auth.guard';

const ACCESS_SECRET = 'guard-access-secret-0123456789abcdef';

class TestController {
  @Public()
  open() {}

  closed() {}

  @Roles('ADMIN')
  adminOnly() {}
}

type Handler = 'open' | 'closed' | 'adminOnly';

describe('JwtAuthGuard', () => {
  const jwt = new JwtService();
  const config = { get: () => ({ accessSecret: ACCESS_SECRET }) } as unknown as AppConfigService;
  const guard = new JwtAuthGuard(new Reflector(), jwt, config);

  const run = async (handler: Handler, authorization?: string) => {
    const request: { headers: Record<string, string>; user?: AuthenticatedUser } = {
      headers: authorization ? { authorization } : {},
    };
    const context = {
      getHandler: () => TestController.prototype[handler],
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const allowed = await guard.canActivate(context);
    return { allowed, user: request.user };
  };

  const token = (payload: Record<string, unknown>, secret = ACCESS_SECRET) =>
    jwt.signAsync(payload, { secret, expiresIn: 60 });

  const accessToken = (role: 'USER' | 'ADMIN' = 'USER') =>
    token({ sub: 'user-1', email: 'ana@example.com', role, type: 'access' });

  const expectUnauthorized = async (
    promise: Promise<unknown>,
    status = HttpStatus.UNAUTHORIZED,
  ) => {
    const error = await promise.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(status);
    return error as AppException;
  };

  it('rejects protected routes without a token', async () => {
    const error = await expectUnauthorized(run('closed'));
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('accepts a valid access token and exposes the user', async () => {
    const result = await run('closed', `Bearer ${await accessToken()}`);
    expect(result).toEqual({
      allowed: true,
      user: { id: 'user-1', email: 'ana@example.com', role: 'USER' },
    });
  });

  it('rejects a refresh token presented as access token', async () => {
    const refresh = await token({ sub: 'user-1', jti: 'x', type: 'refresh' });
    await expectUnauthorized(run('closed', `Bearer ${refresh}`));
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await token(
      { sub: 'user-1', email: 'ana@example.com', role: 'ADMIN', type: 'access' },
      'attacker-secret-0123456789abcdef',
    );
    await expectUnauthorized(run('closed', `Bearer ${forged}`));
  });

  it('ignores authorization schemes other than Bearer', async () => {
    await expectUnauthorized(run('closed', `Basic ${Buffer.from('a:b').toString('base64')}`));
  });

  it('lets anonymous requests reach public routes', async () => {
    await expect(run('open')).resolves.toEqual({ allowed: true, user: undefined });
  });

  it('treats an invalid token on a public route as anonymous', async () => {
    await expect(run('open', 'Bearer invalid')).resolves.toEqual({
      allowed: true,
      user: undefined,
    });
  });

  it('attaches the user on public routes when the token is valid (optional auth)', async () => {
    const result = await run('open', `Bearer ${await accessToken()}`);
    expect(result.user?.id).toBe('user-1');
  });

  it('enforces roles', async () => {
    const error = await expectUnauthorized(
      run('adminOnly', `Bearer ${await accessToken('USER')}`),
      HttpStatus.FORBIDDEN,
    );
    expect(error.code).toBe(ErrorCode.FORBIDDEN);
    await expect(run('adminOnly', `Bearer ${await accessToken('ADMIN')}`)).resolves.toMatchObject({
      allowed: true,
    });
  });
});
