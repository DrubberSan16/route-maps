import { apiKeyMatches, apiKeyPrefix, generateApiKey, hashApiKey } from './api-key';

describe('API keys', () => {
  it('generates a well-formed key whose prefix finds it and whose hash verifies it', () => {
    const generated = generateApiKey();

    expect(generated.key).toMatch(/^rmk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(apiKeyPrefix(generated.key)).toBe(generated.prefix);
    expect(generated.key.startsWith(`${generated.prefix}_`)).toBe(true);
    expect(generated.hash).toBe(hashApiKey(generated.key));
    expect(generated.hash).not.toContain(generated.key.slice(generated.prefix.length + 1));
    expect(generated.lastFour).toBe(generated.key.slice(-4));
    expect(apiKeyMatches(generated.key, generated.hash)).toBe(true);
  });

  it('produces a different key every time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().key));
    expect(keys.size).toBe(50);
  });

  it('rejects malformed keys before looking them up', () => {
    const { key } = generateApiKey();
    expect(apiKeyPrefix(`${key}x`)).toBeNull();
    expect(apiKeyPrefix(key.replace('rmk_', 'rmx_'))).toBeNull();
    expect(apiKeyPrefix('rmk_0123456789ab')).toBeNull();
    expect(apiKeyPrefix('')).toBeNull();
  });

  it('does not match another key or a damaged hash', () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(apiKeyMatches(second.key, first.hash)).toBe(false);
    expect(apiKeyMatches(first.key, first.hash.slice(0, 10))).toBe(false);
    expect(apiKeyMatches(first.key, '')).toBe(false);
  });
});
