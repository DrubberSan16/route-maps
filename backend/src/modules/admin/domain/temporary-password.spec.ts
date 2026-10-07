import { generateTemporaryPassword } from './temporary-password';

describe('generateTemporaryPassword', () => {
  it('reads as four groups of unambiguous letters and digits', () => {
    for (let index = 0; index < 100; index++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{4}(-[A-HJ-NP-Za-km-np-z2-9]{4}){3}$/);
      expect(password).not.toMatch(/[0O1lIo]/);
    }
  });

  it('is long enough for the password rules and different every time', () => {
    const passwords = new Set(Array.from({ length: 200 }, generateTemporaryPassword));
    expect(passwords.size).toBe(200);
    expect([...passwords][0].length).toBeGreaterThanOrEqual(8);
  });
});
