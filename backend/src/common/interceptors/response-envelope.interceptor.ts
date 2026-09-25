import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

/** Wraps successful responses in `{ success: true, data }`. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw || context.getType() !== 'http') return next.handle();
    return next.handle().pipe(
      map((data: unknown) => {
        if (data instanceof StreamableFile) return data;
        return { success: true, data: data ?? null } satisfies SuccessEnvelope<unknown>;
      }),
    );
  }
}
