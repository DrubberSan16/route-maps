import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import type { AuditActor } from '../application/audit.service';

/** The signed-in administrator or operator and the address of the request, for the audit log. */
export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuditActor => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  return { id: request.user!.id, email: request.user!.email, ip: request.ip ?? null };
});
