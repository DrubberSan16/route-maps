import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { AppConfigService } from '../../config/app-config.service';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Paths redacted from every log line (credentials and tokens). */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
];

export const buildLoggerParams = (config: AppConfigService): Params => ({
  pinoHttp: {
    level: config.get('logLevel'),
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    transport: config.isProduction
      ? undefined
      : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } },
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const header = req.headers['x-request-id'];
      const incoming = Array.isArray(header) ? header[0] : header;
      const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        requestId: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customSuccessObject: (req, res, value: Record<string, unknown>) => ({
      ...value,
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
    }),
    customAttributeKeys: { responseTime: 'responseTime' },
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
  },
});
