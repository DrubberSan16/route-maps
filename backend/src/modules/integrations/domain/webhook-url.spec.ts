import { checkWebhookUrl, isPublicAddress, MAX_WEBHOOK_URL_LENGTH } from './webhook-url';

const STRICT = { allowInsecure: false, allowPrivateNetworks: false };
const OPEN = { allowInsecure: true, allowPrivateNetworks: true };

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '1.1.1.1', '200.24.12.5', '2001:4860:4860::8888', '2606:4700::1111'])(
    '%s is public',
    (address) => expect(isPublicAddress(address)).toBe(true),
  );

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::1',
    '::',
    '::7f00:1',
    'fe80::1',
    'fd00::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::10.0.0.1',
    '2002:c0a8:0101::1',
  ])('%s is not public', (address) => expect(isPublicAddress(address)).toBe(false));

  it('treats anything that is not an IP address as not public', () => {
    expect(isPublicAddress('example.com')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});

describe('checkWebhookUrl', () => {
  it('accepts public https URLs and normalises them', () => {
    const result = checkWebhookUrl('https://hooks.example.com/route-maps?team=1', STRICT);
    expect(result.error).toBeUndefined();
    expect(result.url?.toString()).toBe('https://hooks.example.com/route-maps?team=1');
  });

  it('requires https unless insecure URLs are allowed', () => {
    expect(checkWebhookUrl('http://hooks.example.com/x', STRICT).error).toBe(
      'The URL must use https',
    );
    expect(
      checkWebhookUrl('http://hooks.example.com/x', { ...STRICT, allowInsecure: true }).url,
    ).toBeDefined();
    expect(checkWebhookUrl('ftp://hooks.example.com/x', OPEN).error).toBe(
      'The URL must use https or http',
    );
  });

  it('refuses credentials, fragments, garbage and very long URLs', () => {
    expect(checkWebhookUrl('https://user:pass@hooks.example.com/', STRICT).error).toMatch(
      /credentials/,
    );
    expect(checkWebhookUrl('https://hooks.example.com/#x', STRICT).error).toMatch(/fragment/);
    expect(checkWebhookUrl('not a url', STRICT).error).toBe('The URL is not valid');
    const long = `https://hooks.example.com/${'a'.repeat(MAX_WEBHOOK_URL_LENGTH)}`;
    expect(checkWebhookUrl(long, STRICT).error).toMatch(/at most/);
  });

  it.each([
    'https://127.0.0.1/hook',
    'https://localhost/hook',
    'https://intranet/hook',
    'https://api.internal/hook',
    'https://printer.local/hook',
    'https://[::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://0x7f.1/hook',
    'https://2130706433/hook',
    'https://10.0.0.5:8443/hook',
  ])('refuses private destinations: %s', (raw) => {
    expect(checkWebhookUrl(raw, STRICT).error).toMatch(/public/);
  });

  it('accepts private destinations when private networks are allowed', () => {
    expect(checkWebhookUrl('http://127.0.0.1:4000/hook', OPEN).url?.port).toBe('4000');
    expect(checkWebhookUrl('https://erp.internal/hook', OPEN).url).toBeDefined();
  });
});
