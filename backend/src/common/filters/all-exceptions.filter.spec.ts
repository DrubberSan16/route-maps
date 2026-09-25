import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  let logged: jest.SpyInstance;

  const run = (exception: unknown, options: { headersSent?: boolean; requestId?: string } = {}) => {
    const response = {
      headersSent: options.headersSent ?? false,
      statusCode: 0,
      body: undefined as unknown,
      ended: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
      end() {
        this.ended = true;
      },
    };
    const request = { url: '/api/v1/routes/calculate', method: 'POST', id: options.requestId };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return response;
  };

  beforeEach(() => {
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders AppException with its code, message and details', () => {
    const response = run(
      new AppException(ErrorCode.ROUTE_NOT_FOUND, 'No route could be calculated', 404, {
        reason: 'No path could be found for input',
      }),
      { requestId: 'req-42' },
    );

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'No route could be calculated',
        details: { reason: 'No path could be found for input' },
        requestId: 'req-42',
      },
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it('turns class-validator messages into VALIDATION_ERROR details', () => {
    const response = run(
      new BadRequestException(['origin.latitude must be a latitude string or number']),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: ['origin.latitude must be a latitude string or number'],
      },
    });
  });

  it.each([
    [new NotFoundException('Cannot GET /api/v1/nothing'), 404, 'NOT_FOUND'],
    [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE'],
    [new ThrottlerException(), 429, 'RATE_LIMIT_EXCEEDED'],
  ])('maps %p to %i %s', (exception, status, code) => {
    const response = run(exception);
    expect(response.statusCode).toBe(status);
    expect(response.body).toMatchObject({ success: false, error: { code } });
  });

  it.each([
    ['P2002', HttpStatus.CONFLICT, 'CONFLICT'],
    ['P2025', HttpStatus.NOT_FOUND, 'NOT_FOUND'],
  ])('maps Prisma %s to %i', (prismaCode, status, code) => {
    const error = new Prisma.PrismaClientKnownRequestError('Prisma error', {
      code: prismaCode,
      clientVersion: '7.10.0',
    });
    const response = run(error);
    expect(response.statusCode).toBe(status);
    expect(response.body).toMatchObject({ error: { code } });
  });

  it('hides unexpected errors behind INTERNAL_ERROR and logs them', () => {
    const response = run(new Error('password=hunter2 leaked in a driver message'));

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected internal error' },
    });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('only closes the connection when a download already sent its headers', () => {
    const response = run(new Error('EPIPE'), { headersSent: true });
    expect(response.ended).toBe(true);
    expect(response.body).toBeUndefined();
  });
});
