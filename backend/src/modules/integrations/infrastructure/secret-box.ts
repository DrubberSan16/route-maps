import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';

const VERSION = 'v1';
const TAG_LENGTH = 16;

/**
 * Encrypts the webhook signing secrets at rest (AES-256-GCM with a key derived from
 * INTEGRATIONS_SECRET_KEY): a copy of the database alone does not let anyone sign requests.
 * Changing the key makes the stored secrets unreadable; rotate each webhook's secret after that.
 */
@Injectable()
export class SecretBox {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    const material = config.get('integrations').secretKey;
    if (!material) throw new Error('INTEGRATIONS_SECRET_KEY (or JWT_SECRET) is required');
    this.key = Buffer.from(hkdfSync('sha256', material, 'route-maps', 'webhook-secrets', 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_LENGTH });
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, data, cipher.getAuthTag()]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Throws when the value was sealed with another key or was altered. */
  open(sealed: string): string {
    const [version, iv, data, tag] = sealed.split('.');
    if (version !== VERSION || !iv || !data || !tag)
      throw new Error('Unknown sealed secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'), {
      // Only full-length tags: a shortened one would be easier to forge.
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
