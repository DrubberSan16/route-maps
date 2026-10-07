import { Injectable } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { AppConfigService } from '../../../config/app-config.service';
import { checkWebhookUrl, isPublicAddress, WebhookUrlPolicy } from '../domain/webhook-url';

/** Start of the receiver's answer kept with the delivery. */
export const MAX_RESPONSE_BODY = 1024;

export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

export interface WebhookResponse {
  /** HTTP status, absent when no answer arrived (timeout, refused address, network error). */
  status?: number;
  body?: string;
  error?: string;
  durationMs: number;
}

/**
 * DNS lookup that refuses names resolving to non-public addresses (unless private networks are
 * allowed), checked when connecting so that a name cannot point elsewhere after validation.
 */
export function guardedLookup(allowPrivateNetworks: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, '', 0);
        return;
      }
      const refused = allowPrivateNetworks
        ? undefined
        : addresses.find((address) => !isPublicAddress(address.address));
      if (refused || addresses.length === 0) {
        const reason = refused
          ? `${hostname} resolves to a non-public address (${refused.address})`
          : `${hostname} has no address`;
        callback(Object.assign(new Error(reason), { code: 'EADDRNOTPUBLIC' }), '', 0);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * POSTs webhook payloads. Redirects are not followed, the answer is cut at MAX_RESPONSE_BODY and
 * the whole exchange is limited to WEBHOOK_TIMEOUT_MS.
 */
@Injectable()
export class WebhookSender {
  private readonly policy: WebhookUrlPolicy;
  private readonly timeoutMs: number;
  private readonly lookup: LookupFunction;

  constructor(config: AppConfigService) {
    const webhooks = config.get('integrations').webhooks;
    this.policy = webhooks;
    this.timeoutMs = webhooks.timeoutMs;
    this.lookup = guardedLookup(webhooks.allowPrivateNetworks);
  }

  send(request: WebhookRequest): Promise<WebhookResponse> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const checked = checkWebhookUrl(request.url, this.policy);
    if (checked.error !== undefined) {
      return Promise.resolve({ error: checked.error, durationMs: 0 });
    }
    const url = checked.url;
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: Omit<WebhookResponse, 'durationMs'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve({ ...result, durationMs: elapsed() });
      };
      const outgoing = send(
        url,
        {
          method: 'POST',
          headers: { ...request.headers, 'content-length': Buffer.byteLength(request.body) },
          lookup: this.lookup,
          agent: false,
        },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          const done = () =>
            finish({
              status: response.statusCode,
              body: Buffer.concat(chunks).toString('utf8').slice(0, MAX_RESPONSE_BODY),
            });
          response.on('data', (chunk: Buffer) => {
            if (size >= MAX_RESPONSE_BODY) return;
            chunks.push(chunk);
            size += chunk.length;
            // The rest of a long answer is not needed.
            if (size >= MAX_RESPONSE_BODY) {
              done();
              response.destroy();
            }
          });
          response.on('end', done);
          response.on('error', done);
          response.on('close', done);
        },
      );
      const deadline = setTimeout(
        () => outgoing.destroy(new Error(`No answer within ${this.timeoutMs} ms`)),
        this.timeoutMs,
      );
      outgoing.on('error', (error: Error) => finish({ error: error.message }));
      outgoing.end(request.body);
    });
  }
}
