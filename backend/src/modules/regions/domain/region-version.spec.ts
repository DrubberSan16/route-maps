import { buildVersionStatus, compareVersions } from './region-version';

describe('compareVersions', () => {
  it.each([
    ['2026.09', '2026.09.0', 0],
    ['2026.09.01', '2026.09', 1],
    ['2026.10', '2026.9', 1],
    ['2026.09.25.0900', '2026.09.25.1830', -1],
    ['2027.01', '2026.12.31', 1],
    ['2026-09-25', '2026.09.25', 0],
    ['2026_09_26', '2026.09.25', 1],
    [' 2026.09 ', '2026.09', 0],
    ['2026.09.beta', '2026.09.alpha', 1],
  ])('compare(%s, %s) = %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
    expect(compareVersions(b, a)).toBe(-expected || 0);
  });

  it('sorts pipeline versions chronologically', () => {
    const versions = ['2026.09.25.1830', '2026.9.1', '2026.09.25.0900', '2025.12.31.2359'];
    expect([...versions].sort(compareVersions)).toEqual([
      '2025.12.31.2359',
      '2026.9.1',
      '2026.09.25.0900',
      '2026.09.25.1830',
    ]);
  });
});

describe('buildVersionStatus', () => {
  const region = { code: 'guayaquil', version: '2026.09.25.1830', checksum: 'a'.repeat(64) };

  it('reports an update when the device has an older version', () => {
    expect(buildVersionStatus(region, '2026.08.01.0000')).toEqual({
      region: 'guayaquil',
      localVersion: '2026.08.01.0000',
      latestVersion: '2026.09.25.1830',
      checksum: 'a'.repeat(64),
      updateAvailable: true,
    });
  });

  it('reports no update for the same or a newer local version', () => {
    expect(buildVersionStatus(region, '2026.09.25.1830').updateAvailable).toBe(false);
    expect(buildVersionStatus(region, '2026.10.01.0000').updateAvailable).toBe(false);
  });

  it('treats a missing or blank local version as "not downloaded"', () => {
    for (const local of [undefined, null, '', '   ']) {
      expect(buildVersionStatus(region, local)).toMatchObject({
        localVersion: null,
        updateAvailable: false,
      });
    }
  });
});
