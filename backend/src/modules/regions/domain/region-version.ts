/**
 * Compares dotted, numeric data versions such as "2026.09" or "2026.09.01".
 * Missing segments count as 0, so "2026.09" == "2026.09.0" < "2026.09.01".
 * Non-numeric segments fall back to a lexicographic comparison.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.trim().split(/[.\-_]/);
  const right = b.trim().split(/[.\-_]/);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? '0';
    const r = right[i] ?? '0';
    const ln = Number(l);
    const rn = Number(r);
    const diff = Number.isFinite(ln) && Number.isFinite(rn) ? ln - rn : l.localeCompare(r, 'en');
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export interface VersionStatus {
  region: string;
  localVersion: string | null;
  latestVersion: string;
  checksum: string;
  updateAvailable: boolean;
}

export function buildVersionStatus(
  region: { code: string; version: string; checksum: string },
  localVersion?: string | null,
): VersionStatus {
  const local = localVersion?.trim() ? localVersion.trim() : null;
  return {
    region: region.code,
    localVersion: local,
    latestVersion: region.version,
    checksum: region.checksum,
    updateAvailable: local === null ? false : compareVersions(region.version, local) > 0,
  };
}
