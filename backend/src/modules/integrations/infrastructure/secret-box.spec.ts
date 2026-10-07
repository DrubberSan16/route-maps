import { AppConfigService } from '../../../config/app-config.service';
import { SecretBox } from './secret-box';

const box = (secretKey: string | undefined) =>
  new SecretBox({ get: () => ({ secretKey }) } as unknown as AppConfigService);

describe('SecretBox', () => {
  const secret = 'whsec_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

  it('seals and opens a secret, never storing it in clear', () => {
    const sealed = box('k'.repeat(32)).seal(secret);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain(secret);
    expect(box('k'.repeat(32)).open(sealed)).toBe(secret);
  });

  it('uses a new nonce every time', () => {
    const sealer = box('k'.repeat(32));
    expect(sealer.seal(secret)).not.toBe(sealer.seal(secret));
  });

  it('cannot open values sealed with another key or altered', () => {
    const sealed = box('k'.repeat(32)).seal(secret);
    expect(() => box('z'.repeat(32)).open(sealed)).toThrow();

    const [version, iv, data, tag] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() =>
      box('k'.repeat(32)).open([version, iv, flipped.toString('base64url'), tag].join('.')),
    ).toThrow();
    // A shortened authentication tag is refused, not checked with fewer bits.
    const short = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => box('k'.repeat(32)).open([version, iv, data, short].join('.'))).toThrow();
    expect(() => box('k'.repeat(32)).open('plain-text')).toThrow('Unknown sealed secret format');
  });

  it('requires key material', () => {
    expect(() => box(undefined)).toThrow(/INTEGRATIONS_SECRET_KEY/);
    expect(() => box('')).toThrow(/INTEGRATIONS_SECRET_KEY/);
  });
});
