import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AccessTokenPayload } from '../../../common/types/authenticated-user';
import { AppConfigService } from '../../../config/app-config.service';
import { UsersService } from '../../users/application/users.service';
import { toUserProfile, UserEntity, UserProfile } from '../../users/domain/user.entity';
import { AuthTokens, RefreshTokenPayload } from '../domain/auth-tokens';
import { PASSWORD_HASHER, type PasswordHasher } from '../domain/password-hasher';
import {
  NewRefreshToken,
  RefreshTokenRepository,
} from '../infrastructure/refresh-token.repository';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}

  async register(
    dto: RegisterDto,
    userAgent?: string,
  ): Promise<{ user: UserProfile } & AuthTokens> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new AppException(
        ErrorCode.EMAIL_ALREADY_REGISTERED,
        'Email is already registered',
        HttpStatus.CONFLICT,
      );
    }
    const user = await this.users.create({
      email: dto.email,
      name: dto.name,
      passwordHash: await this.hasher.hash(dto.password),
    });
    const tokens = await this.issueTokens(user, userAgent);
    return { user: toUserProfile(user), ...tokens };
  }

  async login(dto: LoginDto, userAgent?: string): Promise<{ user: UserProfile } & AuthTokens> {
    const user = await this.users.findByEmail(dto.email);
    // Always run a verification to keep response time similar for unknown emails.
    const valid = user
      ? await this.hasher.verify(user.passwordHash, dto.password)
      : await this.hasher.verify(await this.dummyHash(), dto.password).then(() => false);
    if (!user || !valid) {
      throw new AppException(
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const tokens = await this.issueTokens(user, userAgent);
    return { user: toUserProfile(user), ...tokens };
  }

  /** Rotates the refresh token. Re-use of a revoked token revokes the whole family. */
  async refresh(refreshToken: string, userAgent?: string): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const stored = await this.refreshTokens.findById(payload.jti);
    if (!stored || stored.userId !== payload.sub || stored.tokenHash !== sha256(refreshToken)) {
      throw this.invalidRefresh();
    }
    if (stored.revokedAt) throw await this.reuseDetected(stored.userId);
    if (stored.expiresAt.getTime() <= Date.now()) throw this.invalidRefresh();

    const user = await this.users.getById(stored.userId);
    const { tokens, record } = await this.signTokens(user, userAgent);
    // The token may have been rotated since it was read (the same token sent twice at
    // once): only the request that claims it gets a successor, the other is a re-use.
    if (!(await this.refreshTokens.rotate(stored.id, record))) {
      throw await this.reuseDetected(stored.userId);
    }
    return tokens;
  }

  async logout(refreshToken: string): Promise<{ loggedOut: true }> {
    const payload = await this.verifyRefreshToken(refreshToken);
    await this.refreshTokens.revoke(payload.jti);
    return { loggedOut: true };
  }

  async me(userId: string): Promise<UserProfile> {
    return toUserProfile(await this.users.getById(userId));
  }

  private async issueTokens(user: UserEntity, userAgent?: string): Promise<AuthTokens> {
    const { tokens, record } = await this.signTokens(user, userAgent);
    await this.refreshTokens.create(record);
    return tokens;
  }

  /** Signs a token pair; the refresh token is stored by the caller (only its SHA-256). */
  private async signTokens(
    user: UserEntity,
    userAgent?: string,
  ): Promise<{ tokens: AuthTokens; record: NewRefreshToken }> {
    const { accessSecret, refreshSecret, accessTtlSeconds, refreshTtlSeconds } =
      this.config.get('jwt');
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti, type: 'refresh' };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, { secret: accessSecret, expiresIn: accessTtlSeconds }),
      this.jwt.signAsync(refreshPayload, { secret: refreshSecret, expiresIn: refreshTtlSeconds }),
    ]);

    return {
      tokens: {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: accessTtlSeconds,
        refreshExpiresIn: refreshTtlSeconds,
      },
      record: {
        id: jti,
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
        userAgent: userAgent?.slice(0, 255),
      },
    };
  }

  private async reuseDetected(userId: string): Promise<AppException> {
    this.logger.warn({ userId }, 'Refresh token reuse detected; revoking sessions');
    await this.refreshTokens.revokeAllForUser(userId);
    return this.invalidRefresh();
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.get('jwt').refreshSecret,
      });
      if (payload.type !== 'refresh' || !payload.jti) throw new Error('Wrong token type');
      return payload;
    } catch (error) {
      throw this.invalidRefresh(error);
    }
  }

  private invalidRefresh(cause?: unknown): AppException {
    return new AppException(
      ErrorCode.INVALID_REFRESH_TOKEN,
      'Invalid or expired refresh token',
      HttpStatus.UNAUTHORIZED,
      undefined,
      { cause },
    );
  }

  private dummyHashPromise?: Promise<string>;
  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hasher.hash(randomUUID());
    return this.dummyHashPromise;
  }
}
