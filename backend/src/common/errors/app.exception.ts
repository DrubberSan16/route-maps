import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface AppErrorBody {
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

/**
 * Domain/application exception carrying a stable error code.
 * The global exception filter turns it into the standard error envelope.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super({ code, message, details } satisfies AppErrorBody, status, { cause: options?.cause });
  }

  static notFound(code: ErrorCode, message: string): AppException {
    return new AppException(code, message, HttpStatus.NOT_FOUND);
  }

  static unavailable(code: ErrorCode, message: string, cause?: unknown): AppException {
    return new AppException(code, message, HttpStatus.SERVICE_UNAVAILABLE, undefined, { cause });
  }
}
