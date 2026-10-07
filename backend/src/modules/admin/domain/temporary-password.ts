import { randomInt } from 'node:crypto';

/** Letters and digits that cannot be mistaken for one another when read aloud or copied. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * Password an administrator hands over when creating an account or resetting its password,
 * e.g. "Xk7p-Q2mr-9vTa-hW4n" (about 90 bits of entropy).
 */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group++) {
    let text = '';
    for (let index = 0; index < GROUP_LENGTH; index++) {
      text += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(text);
  }
  return groups.join('-');
}
