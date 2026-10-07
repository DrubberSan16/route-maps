import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AccountAccessService } from './account-access.service';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'ana@example.com',
  role: 'USER',
  active: true,
  serviceAccount: false,
  sessionsRevokedAt: null,
  ...overrides,
});

describe('AccountAccessService', () => {
  let findUnique: jest.Mock;
  let service: AccountAccessService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-07T12:00:00Z') });
    findUnique = jest.fn().mockResolvedValue(row());
    service = new AccountAccessService({ user: { findUnique } } as unknown as PrismaService);
  });

  afterEach(() => jest.useRealTimers());

  it('returns the state of the account with the closing of sessions in milliseconds', async () => {
    const closedAt = new Date('2026-10-01T10:00:00.250Z');
    findUnique.mockResolvedValueOnce(row({ sessionsRevokedAt: closedAt }));
    await expect(service.get('user-1')).resolves.toEqual({
      ...row(),
      sessionsRevokedAt: closedAt.getTime(),
    });
  });

  it('reads an account once for concurrent requests and reuses it for a few seconds', async () => {
    await Promise.all([service.get('user-1'), service.get('user-1'), service.get('user-1')]);
    await service.get('user-1');
    expect(findUnique).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10_001);
    await service.get('user-1');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('remembers unknown accounts too', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.get('ghost')).resolves.toBeNull();
    await expect(service.get('ghost')).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads again right after an invalidation', async () => {
    await service.get('user-1');
    findUnique.mockResolvedValueOnce(row({ active: false }));

    service.invalidate('user-1');

    await expect(service.get('user-1')).resolves.toMatchObject({ active: false });
  });

  it('does not keep a value read while the account was being changed', async () => {
    let finish!: (value: unknown) => void;
    findUnique.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const stale = service.get('user-1');

    service.invalidate('user-1');
    finish(row({ role: 'USER' }));
    await stale;

    findUnique.mockResolvedValueOnce(row({ role: 'ADMIN' }));
    await expect(service.get('user-1')).resolves.toMatchObject({ role: 'ADMIN' });
  });

  it('does not cache failures', async () => {
    findUnique.mockRejectedValueOnce(new Error('database down'));
    await expect(service.get('user-1')).rejects.toThrow('database down');
    await expect(service.get('user-1')).resolves.toMatchObject({ id: 'user-1' });
  });
});
