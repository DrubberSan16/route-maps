import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppConfigService } from '../../../config/app-config.service';
import { guardedLookup, MAX_RESPONSE_BODY, WebhookSender } from './webhook-sender';

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

const sender = (overrides: Record<string, unknown> = {}) =>
  new WebhookSender({
    get: () => ({
      webhooks: {
        allowInsecure: true,
        allowPrivateNetworks: true,
        timeoutMs: 1_000,
        ...overrides,
      },
    }),
  } as unknown as AppConfigService);

describe('WebhookSender', () => {
  let server: Server;
  let url: string;
  let handler: Handler;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => handler(request, Buffer.concat(chunks).toString('utf8'), response));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('POSTs the body with its headers and returns the answer', async () => {
    let received: { method?: string; headers?: IncomingMessage['headers']; body?: string } = {};
    handler = (request, body, response) => {
      received = { method: request.method, headers: request.headers, body };
      response.writeHead(202, { 'content-type': 'text/plain' }).end('accepted');
    };

    const result = await sender().send({
      url,
      body: '{"type":"trip.started"}',
      headers: { 'content-type': 'application/json', 'x-routemaps-event': 'trip.started' },
    });

    expect(result).toMatchObject({ status: 202, body: 'accepted' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(received.method).toBe('POST');
    expect(received.body).toBe('{"type":"trip.started"}');
    expect(received.headers?.['x-routemaps-event']).toBe('trip.started');
    expect(received.headers?.['content-length']).toBe('23');
  });

  it('keeps only the start of a long answer', async () => {
    handler = (_request, _body, response) => response.writeHead(200).end('x'.repeat(50_000));
    const result = await sender().send({ url, body: '{}', headers: {} });
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(MAX_RESPONSE_BODY);
  });

  it('does not follow redirects', async () => {
    handler = (_request, _body, response) =>
      response.writeHead(302, { location: 'http://169.254.169.254/' }).end();
    const result = await sender().send({ url, body: '{}', headers: {} });
    expect(result.status).toBe(302);
  });

  it('gives up when the receiver does not answer in time', async () => {
    handler = () => undefined;
    const result = await sender({ timeoutMs: 200 }).send({ url, body: '{}', headers: {} });
    expect(result.status).toBeUndefined();
    expect(result.error).toBe('No answer within 200 ms');
    expect(result.durationMs).toBeGreaterThanOrEqual(150);
  });

  it('reports connection errors', async () => {
    const closed = new URL(url);
    closed.port = '1';
    const result = await sender().send({ url: closed.toString(), body: '{}', headers: {} });
    expect(result.status).toBeUndefined();
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('refuses private destinations unless they are allowed', async () => {
    handler = (_request, _body, response) => response.writeHead(200).end();
    const strict = sender({ allowPrivateNetworks: false });
    await expect(strict.send({ url, body: '{}', headers: {} })).resolves.toEqual({
      error: 'The URL must point to a public address',
      durationMs: 0,
    });
    const insecureRefused = sender({ allowInsecure: false });
    await expect(insecureRefused.send({ url, body: '{}', headers: {} })).resolves.toMatchObject({
      error: 'The URL must use https',
    });
  });
});

describe('guardedLookup', () => {
  const lookup = (allowPrivate: boolean, all: boolean) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown }>((resolve) =>
      guardedLookup(allowPrivate)('localhost', { all }, (error, address) =>
        resolve({ error, address }),
      ),
    );

  it('refuses host names that resolve to a non-public address', async () => {
    const { error } = await lookup(false, false);
    expect(error?.code).toBe('EADDRNOTPUBLIC');
    expect(error?.message).toMatch(/localhost resolves to a non-public address/);
  });

  it('resolves them when private networks are allowed', async () => {
    const single = await lookup(true, false);
    expect(single.error).toBeNull();
    expect(typeof single.address).toBe('string');
    const every = await lookup(true, true);
    expect(Array.isArray(every.address)).toBe(true);
  });
});
