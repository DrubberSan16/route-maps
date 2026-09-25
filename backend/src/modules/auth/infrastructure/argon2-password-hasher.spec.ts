import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes with Argon2id and the OWASP parameters', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    // PHC string: $argon2id$v=19$<params>$<salt>$<hash>; parameter order is not guaranteed.
    const [, algorithm, version, params] = hash.split('$');
    expect(algorithm).toBe('argon2id');
    expect(version).toBe('v=19');
    expect(Object.fromEntries(params.split(',').map((pair) => pair.split('=')))).toEqual({
      m: '19456',
      t: '2',
      p: '1',
    });
  });

  it('uses a random salt for every hash', async () => {
    const [first, second] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);
    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hasher.hash('S3cure-password');
    await expect(hasher.verify(hash, 'S3cure-password')).resolves.toBe(true);
    await expect(hasher.verify(hash, 's3cure-password')).resolves.toBe(false);
  });

  it('treats a malformed hash as a failed verification', async () => {
    await expect(hasher.verify('not-an-argon2-hash', 'anything')).resolves.toBe(false);
  });
});
