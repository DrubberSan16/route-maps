import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { UserRole } from '../../generated/prisma/enums';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AccessTokenPayload, AuthenticatedUser } from '../types/authenticated-user';

/**
 * Global guard: every route requires a valid access token unless it is
 * decorated with @Public(). Public routes still receive `request.user`
 * when a valid token is supplied (optional authentication).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ?? false;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Missing access token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('jwt').accessSecret,
      });
      if (payload.type !== 'access') throw new Error('Wrong token type');
      request.user = { id: payload.sub, email: payload.email, role: payload.role };
    } catch (error) {
      if (isPublic) return true;
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Invalid or expired access token',
        HttpStatus.UNAUTHORIZED,
        undefined,
        { cause: error },
      );
    }

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles && roles.length > 0 && !roles.includes(request.user.role)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Insufficient permissions', HttpStatus.FORBIDDEN);
    }
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
  }
}
