import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { UserRole } from '../../generated/prisma/enums';
import {
  ACCOUNT_ACCESS,
  type AccountAccess,
  type AccountAccessReader,
  API_KEY_AUTHENTICATOR,
  type ApiKeyAuthenticator,
} from '../auth/auth-ports';
import { API_SCOPES_KEY } from '../decorators/api-scopes.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AccessTokenPayload, AuthenticatedUser } from '../types/authenticated-user';

export const API_KEY_HEADER = 'x-api-key';

type AuthRequest = Request & { user?: AuthenticatedUser };

const unauthorized = (code: ErrorCode, message: string, cause?: unknown) =>
  new AppException(code, message, HttpStatus.UNAUTHORIZED, undefined, { cause });

/**
 * Global guard. Every route needs a valid access token (people) or API key (integrations) unless
 * it is @Public(); public routes still identify the caller when valid credentials come along.
 *
 * - Access token (`Authorization: Bearer`): its account must exist and be active, and the token
 *   must not predate a "close sessions" of the account. Roles are read from the account, so a
 *   role change applies without waiting for the token to expire.
 * - API key (`X-API-Key`): accepted on routes marked @ApiScopes, when the key has every listed
 *   scope, and on public routes (where it only identifies the integration for its quota). Never on
 *   administration, session or synchronization routes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    @Inject(ACCOUNT_ACCESS) private readonly accounts: AccountAccessReader,
    @Inject(API_KEY_AUTHENTICATOR) private readonly apiKeys: ApiKeyAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ?? false;
    const http = context.switchToHttp();
    const request = http.getRequest<AuthRequest>();

    const apiKey = this.header(request, API_KEY_HEADER);
    if (apiKey !== undefined) {
      const scopes = this.reflector.getAllAndOverride<string[] | undefined>(
        API_SCOPES_KEY,
        targets,
      );
      request.user = await this.authenticateApiKey(
        apiKey,
        { isPublic, scopes },
        request,
        http.getResponse<Response>(),
      );
      return true;
    }

    const token = this.bearerToken(request);
    if (!token) {
      if (isPublic) return true;
      throw unauthorized(ErrorCode.UNAUTHORIZED, 'Missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('jwt').accessSecret,
      });
      if (payload.type !== 'access') throw new Error('Wrong token type');
    } catch (error) {
      if (isPublic) return true;
      throw unauthorized(ErrorCode.UNAUTHORIZED, 'Invalid or expired access token', error);
    }

    const account = await this.accounts.get(payload.sub);
    const refusal = this.refuseSession(account, payload);
    if (refusal !== undefined || account === null) {
      if (isPublic) return true;
      throw refusal ?? unauthorized(ErrorCode.UNAUTHORIZED, 'Invalid or expired access token');
    }
    request.user = { id: account.id, email: account.email, role: account.role };

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles && roles.length > 0 && !roles.includes(account.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Insufficient permissions', HttpStatus.FORBIDDEN);
    }
    return true;
  }

  /** Why a verified access token cannot be used, if it cannot. */
  private refuseSession(
    account: AccountAccess | null,
    payload: AccessTokenPayload,
  ): AppException | undefined {
    if (!account || account.serviceAccount) {
      return unauthorized(ErrorCode.UNAUTHORIZED, 'Invalid or expired access token');
    }
    if (!account.active) {
      return unauthorized(ErrorCode.ACCOUNT_DISABLED, 'This account is disabled');
    }
    if (account.sessionsRevokedAt !== null && (payload.sv ?? 0) < account.sessionsRevokedAt) {
      return unauthorized(ErrorCode.SESSION_REVOKED, 'This session was closed; log in again');
    }
    return undefined;
  }

  private async authenticateApiKey(
    rawKey: string,
    route: { isPublic: boolean; scopes: string[] | undefined },
    request: AuthRequest,
    response: Response,
  ): Promise<AuthenticatedUser> {
    if (!route.isPublic && route.scopes === undefined) {
      throw new AppException(
        ErrorCode.API_KEY_NOT_ALLOWED,
        'This endpoint does not accept API keys',
        HttpStatus.FORBIDDEN,
      );
    }
    const principal = await this.apiKeys.authenticate(rawKey);
    const account = await this.accounts.get(principal.userId);
    if (!account?.active) {
      throw unauthorized(ErrorCode.INVALID_API_KEY, 'The account of this integration is disabled');
    }
    this.apiKeys.track(principal, request.ip, response);

    const missing = (route.scopes ?? []).filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) {
      throw new AppException(
        ErrorCode.API_KEY_SCOPE_MISSING,
        `This API key lacks the scope ${missing.join(', ')}`,
        HttpStatus.FORBIDDEN,
        { required: route.scopes, missing },
      );
    }
    return { id: account.id, email: account.email, role: UserRole.USER, apiKey: principal };
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined ? undefined : first.trim();
  }

  private bearerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
  }
}
