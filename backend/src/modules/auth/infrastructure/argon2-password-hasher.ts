import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PasswordHasher } from '../domain/password-hasher';

/** Argon2id with OWASP recommended parameters (19 MiB, t=2, p=1). */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private readonly options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed hash is treated as a failed verification, never as success.
      return false;
    }
  }
}
