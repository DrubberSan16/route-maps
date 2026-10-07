import { HttpStatus, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AccessTokenPayload } from '../../../common/types/authenticated-user';
import { AppConfigService } from '../../../config/app-config.service';
import { UsersService } from '../../users/application/users.service';
import { UserEntity } from '../../users/domain/user.entity';
import { RefreshTokenPayload } from '../domain/auth-tokens';
import { PasswordHasher } from '../domain/password-hasher';
import { RefreshTokenRepository } from '../infrastructure/refresh-token.repository';
import { AuthService } from './auth.service';

const JWT_CONFIG = {
  accessSecret: 'test-access-secret-0123456789abcdef',
  refreshSecret: 'test-refresh-secret-0123456789abcdef',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3600,
};

interface StoredToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  revokedAt: Date | null;
  replacedById: string | null;
}

class InMemoryRefreshTokens {
  readonly tokens = new Map<string, StoredToken>();

  create(data: Omit<StoredToken, 'revokedAt' | 'replacedById'>) {
    const token = { ...data, revokedAt: null, replacedById: null };
    this.tokens.set(data.id, token);
    return Promise.resolve(token);
  }

  findById(id: string) {
    return Promise.resolve(this.tokens.get(id) ?? null);
  }

  rotate(previousId: string, next: Omit<StoredToken, 'revokedAt' | 'replacedById'>) {
    const previous = this.tokens.get(previousId);
    if (!previous || previous.revokedAt) return Promise.resolve(false);
    previous.revokedAt = new Date();
    previous.replacedById = next.id;
    this.tokens.set(next.id, { ...next, revokedAt: null, replacedById: null });
    return Promise.resolve(true);
  }

  revoke(id: string) {
    const token = this.tokens.get(id);
    if (token && !token.revokedAt) token.revokedAt = new Date();
    return Promise.resolve({ count: token ? 1 : 0 });
  }

  revokeAllForUser(userId: string) {
    for (const token of this.tokens.values()) {
      if (token.userId === userId && !token.revokedAt) token.revokedAt = new Date();
    }
    return Promise.resolve({ count: 0 });
  }
}

class InMemoryUsers {
  readonly users = new Map<string, UserEntity>();

  constructor(private readonly tokens: InMemoryRefreshTokens) {}

  findByEmail(email: string) {
    const user = [...this.users.values()].find((item) => item.email === email.toLowerCase());
    return Promise.resolve(user ?? null);
  }

  getById(id: string) {
    const user = this.users.get(id);
    if (!user) return Promise.reject(AppException.notFound(ErrorCode.NOT_FOUND, 'User not found'));
    return Promise.resolve(user);
  }

  create(input: { email: string; name: string; passwordHash: string }) {
    const user: UserEntity = {
      id: randomUUID(),
      email: input.email.toLowerCase(),
      name: input.name,
      role: 'USER',
      passwordHash: input.passwordHash,
      active: true,
      serviceAccount: false,
      sessionsRevokedAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(user.id, user);
    return Promise.resolve(user);
  }

  recordLogin(id: string) {
    this.users.get(id)!.lastLoginAt = new Date();
    return Promise.resolve();
  }

  replacePassword(id: string, passwordHash: string) {
    const user = this.users.get(id)!;
    user.passwordHash = passwordHash;
    user.sessionsRevokedAt = new Date();
    void this.tokens.revokeAllForUser(id);
    return Promise.resolve({ ...user });
  }
}

/** Deterministic hasher that records how many verifications ran. */
class FakeHasher implements PasswordHasher {
  verifications = 0;

  hash(plain: string) {
    return Promise.resolve(`hashed:${plain}`);
  }

  verify(hash: string, plain: string) {
    this.verifications++;
    return Promise.resolve(hash === `hashed:${plain}`);
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function expectAppError(promise: Promise<unknown>, code: ErrorCode, status: number) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  expect((error as AppException).getStatus()).toBe(status);
}

describe('AuthService', () => {
  let users: InMemoryUsers;
  let tokens: InMemoryRefreshTokens;
  let hasher: FakeHasher;
  let jwt: JwtService;
  let accounts: { get: jest.Mock; invalidate: jest.Mock };
  let service: AuthService;
  let warn: jest.SpyInstance;

  const register = () =>
    service.register(
      { email: 'Ana@Example.com', password: 'S3cure-password', name: 'Ana' },
      'jest-agent',
    );

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    tokens = new InMemoryRefreshTokens();
    users = new InMemoryUsers(tokens);
    hasher = new FakeHasher();
    jwt = new JwtService();
    accounts = { get: jest.fn(), invalidate: jest.fn() };
    const config = { get: (key: string) => (key === 'jwt' ? JWT_CONFIG : undefined) };
    service = new AuthService(
      users as unknown as UsersService,
      jwt,
      config as unknown as AppConfigService,
      tokens as unknown as RefreshTokenRepository,
      hasher,
      accounts,
    );
  });

  afterEach(() => warn.mockRestore());

  describe('register', () => {
    it('creates the user with a hashed password and returns a public profile and tokens', async () => {
      const result = await register();

      const stored = [...users.users.values()][0];
      expect(stored.email).toBe('ana@example.com');
      expect(stored.passwordHash).toBe('hashed:S3cure-password');
      expect(result.user).toEqual({
        id: stored.id,
        email: 'ana@example.com',
        name: 'Ana',
        role: 'USER',
        createdAt: stored.createdAt,
      });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: JWT_CONFIG.accessTtlSeconds,
        refreshExpiresIn: JWT_CONFIG.refreshTtlSeconds,
      });
    });

    it('stores only the SHA-256 of the refresh token', async () => {
      const result = await register();

      const [stored] = [...tokens.tokens.values()];
      expect(stored.tokenHash).toBe(sha256(result.refreshToken));
      expect(stored.tokenHash).not.toBe(result.refreshToken);
      expect(stored.userAgent).toBe('jest-agent');
    });

    it('rejects an email that is already registered', async () => {
      await register();
      await expectAppError(register(), ErrorCode.EMAIL_ALREADY_REGISTERED, HttpStatus.CONFLICT);
    });
  });

  describe('login', () => {
    it('returns an access token signed with the access secret', async () => {
      const { user } = await register();

      const result = await service.login({ email: 'ana@example.com', password: 'S3cure-password' });

      const payload = await jwt.verifyAsync<AccessTokenPayload>(result.accessToken, {
        secret: JWT_CONFIG.accessSecret,
      });
      expect(payload).toMatchObject({
        sub: user.id,
        email: 'ana@example.com',
        role: 'USER',
        type: 'access',
        // No session of the account was ever closed.
        sv: 0,
      });
      await expect(
        jwt.verifyAsync(result.accessToken, { secret: JWT_CONFIG.refreshSecret }),
      ).rejects.toThrow();
    });

    it('records when the account signed in', async () => {
      const { user } = await register();

      await service.login({ email: 'ana@example.com', password: 'S3cure-password' });

      expect(users.users.get(user.id)!.lastLoginAt).toBeInstanceOf(Date);
    });

    it('stamps access tokens with the last time the sessions were closed', async () => {
      const { user } = await register();
      const closedAt = new Date('2026-10-01T12:00:00.123Z');
      users.users.get(user.id)!.sessionsRevokedAt = closedAt;

      const result = await service.login({ email: 'ana@example.com', password: 'S3cure-password' });

      const payload = await jwt.verifyAsync<AccessTokenPayload>(result.accessToken, {
        secret: JWT_CONFIG.accessSecret,
      });
      expect(payload.sv).toBe(closedAt.getTime());
    });

    it('tells a disabled account so only when the password is right', async () => {
      const { user } = await register();
      users.users.get(user.id)!.active = false;

      await expectAppError(
        service.login({ email: 'ana@example.com', password: 'wrong-password' }),
        ErrorCode.INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
      );
      await expectAppError(
        service.login({ email: 'ana@example.com', password: 'S3cure-password' }),
        ErrorCode.ACCOUNT_DISABLED,
        HttpStatus.FORBIDDEN,
      );
      expect(tokens.tokens.size).toBe(1);
    });

    it('treats the account of an integration as unknown, even with its password', async () => {
      const { user } = await register();
      users.users.get(user.id)!.serviceAccount = true;
      hasher.verifications = 0;

      await expectAppError(
        service.login({ email: 'ana@example.com', password: 'S3cure-password' }),
        ErrorCode.INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
      );
      expect(hasher.verifications).toBe(1);
    });

    it('rejects a wrong password', async () => {
      await register();
      await expectAppError(
        service.login({ email: 'ana@example.com', password: 'wrong-password' }),
        ErrorCode.INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects an unknown email with the same error, still running a verification', async () => {
      await expectAppError(
        service.login({ email: 'nobody@example.com', password: 'whatever-123' }),
        ErrorCode.INVALID_CREDENTIALS,
        HttpStatus.UNAUTHORIZED,
      );
      expect(hasher.verifications).toBe(1);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token and revokes the previous one', async () => {
      const first = await register();
      const firstId = (
        await jwt.verifyAsync<RefreshTokenPayload>(first.refreshToken, {
          secret: JWT_CONFIG.refreshSecret,
        })
      ).jti;

      const second = await service.refresh(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      const secondId = (
        await jwt.verifyAsync<RefreshTokenPayload>(second.refreshToken, {
          secret: JWT_CONFIG.refreshSecret,
        })
      ).jti;
      const previous = tokens.tokens.get(firstId)!;
      expect(previous.revokedAt).toBeInstanceOf(Date);
      expect(previous.replacedById).toBe(secondId);
      expect(tokens.tokens.get(secondId)!.revokedAt).toBeNull();
    });

    it('detects re-use of a rotated token and revokes every session of the user', async () => {
      const first = await register();
      const second = await service.refresh(first.refreshToken);

      await expectAppError(
        service.refresh(first.refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
      // The legitimate latest token is revoked too: the session family is compromised.
      await expectAppError(
        service.refresh(second.refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
      expect([...tokens.tokens.values()].every((token) => token.revokedAt !== null)).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        { userId: first.user.id },
        'Refresh token reuse detected; revoking sessions',
      );
    });

    it('lets only one of two simultaneous refreshes with the same token through', async () => {
      const first = await register();
      // Both requests read the stored token before either rotates it (two API replicas).
      const read = tokens.findById.bind(tokens);
      let reads = 0;
      let bothRead!: () => void;
      const barrier = new Promise<void>((resolve) => (bothRead = resolve));
      jest.spyOn(tokens, 'findById').mockImplementation(async (id: string) => {
        const snapshot = await read(id).then((token) => token && { ...token });
        if (++reads === 2) bothRead();
        await barrier;
        return snapshot;
      });

      const results = await Promise.allSettled([
        service.refresh(first.refreshToken),
        service.refresh(first.refreshToken),
      ]);

      const winners = results.filter((result) => result.status === 'fulfilled');
      const losers = results.filter((result) => result.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].reason).toMatchObject({ code: ErrorCode.INVALID_REFRESH_TOKEN });
      // The loser's token was never stored, and the re-use revoked the winner's one too.
      expect(tokens.tokens.size).toBe(2);
      expect([...tokens.tokens.values()].every((token) => token.revokedAt !== null)).toBe(true);
      await expectAppError(
        service.refresh(winners[0].value.refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
      expect(warn).toHaveBeenCalledWith(
        { userId: first.user.id },
        'Refresh token reuse detected; revoking sessions',
      );
    });

    it('rejects an access token used as refresh token', async () => {
      const { accessToken } = await register();
      await expectAppError(
        service.refresh(accessToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects a token whose stored session expired', async () => {
      const { refreshToken } = await register();
      for (const token of tokens.tokens.values()) token.expiresAt = new Date(Date.now() - 1000);
      await expectAppError(
        service.refresh(refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects a token that does not match the stored hash', async () => {
      const { refreshToken } = await register();
      for (const token of tokens.tokens.values()) token.tokenHash = sha256('another-token');
      await expectAppError(
        service.refresh(refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('rejects garbage', async () => {
      await expectAppError(
        service.refresh('not-a-jwt'),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('ends the session of a disabled account with a 401, so the app signs out', async () => {
      const { user, refreshToken } = await register();
      users.users.get(user.id)!.active = false;

      await expectAppError(
        service.refresh(refreshToken),
        ErrorCode.ACCOUNT_DISABLED,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('never refreshes a session of the account of an integration', async () => {
      const { user, refreshToken } = await register();
      users.users.get(user.id)!.serviceAccount = true;

      await expectAppError(
        service.refresh(refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
    });
  });

  describe('changePassword', () => {
    it('replaces the password, closes the other sessions and keeps the caller signed in', async () => {
      const { user, refreshToken } = await register();

      const result = await service.changePassword(user.id, {
        currentPassword: 'S3cure-password',
        newPassword: 'An0ther-password',
      });

      const stored = users.users.get(user.id)!;
      expect(stored.passwordHash).toBe('hashed:An0ther-password');
      expect(accounts.invalidate).toHaveBeenCalledWith(user.id);
      // The previous session is gone; the new pair works and passes the session check.
      await expectAppError(
        service.refresh(refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
      const payload = await jwt.verifyAsync<AccessTokenPayload>(result.accessToken, {
        secret: JWT_CONFIG.accessSecret,
      });
      expect(payload.sv).toBe(stored.sessionsRevokedAt!.getTime());
    });

    it('keeps the new session when another device still tries the closed one', async () => {
      const { user, refreshToken: otherDevice } = await register();
      const result = await service.changePassword(user.id, {
        currentPassword: 'S3cure-password',
        newPassword: 'An0ther-password',
      });

      // A token closed by the new password is just invalid, not a stolen copy that has been
      // used: the session that changed the password goes on.
      await expectAppError(
        service.refresh(otherDevice),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
      await expect(service.refresh(result.refreshToken)).resolves.toMatchObject({
        refreshToken: expect.any(String),
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it('refuses a wrong current password', async () => {
      const { user } = await register();
      await expectAppError(
        service.changePassword(user.id, {
          currentPassword: 'not-my-password',
          newPassword: 'An0ther-password',
        }),
        ErrorCode.INVALID_CURRENT_PASSWORD,
        HttpStatus.BAD_REQUEST,
      );
      expect(users.users.get(user.id)!.passwordHash).toBe('hashed:S3cure-password');
    });

    it('refuses the same password', async () => {
      const { user } = await register();
      await expectAppError(
        service.changePassword(user.id, {
          currentPassword: 'S3cure-password',
          newPassword: 'S3cure-password',
        }),
        ErrorCode.VALIDATION_ERROR,
        HttpStatus.BAD_REQUEST,
      );
    });
  });

  describe('logout and me', () => {
    it('revokes the refresh token on logout', async () => {
      const { refreshToken } = await register();

      await expect(service.logout(refreshToken)).resolves.toEqual({ loggedOut: true });

      await expectAppError(
        service.refresh(refreshToken),
        ErrorCode.INVALID_REFRESH_TOKEN,
        HttpStatus.UNAUTHORIZED,
      );
    });

    it('returns the profile of the current user', async () => {
      const { user } = await register();
      await expect(service.me(user.id)).resolves.toEqual(user);
    });
  });
});
