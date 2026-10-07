import { Injectable } from '@nestjs/common';
import { Paginated } from '../../../common/dto/pagination.dto';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/** Who made a change: the signed-in administrator or operator, and from where. */
export interface AuditActor {
  /** Null for changes made from the command line on the server. */
  id: string | null;
  email: string;
  ip?: string | null;
}

export interface AuditEntry {
  /** What was done, e.g. "user.update" or "integration.key.create". */
  action: string;
  targetType: string;
  targetId?: string | null;
  /** Name of the target at that moment (an email, an integration name), shown in the panel. */
  summary: string;
  details?: Record<string, unknown>;
}

export interface AuditLogView {
  id: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  details: unknown;
  ip: string | null;
  createdAt: Date;
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

/** Record of what administrators and operators changed (accounts, integrations, regions...). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(actor: AuditActor, entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        actorEmail: actor.email,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        summary: entry.summary.slice(0, 300),
        details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: actor.ip ?? null,
      },
    });
  }

  async list(query: AuditQuery): Promise<Paginated<AuditLogView>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }
}
