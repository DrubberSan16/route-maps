import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { text } from 'node:stream/consumers';
import { AppConfigService } from '../../../config/app-config.service';
import { LocalMapStorageProvider } from './local-map-storage.provider';

describe('LocalMapStorageProvider', () => {
  let root: string;
  let storage: LocalMapStorageProvider;

  const put = async (path: string, content: string) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };

  const manifest = (code: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      code,
      name: code,
      country: 'Ecuador',
      version: '2026.09.25.1830',
      bbox: [-80.1, -2.35, -79.75, -1.95],
      mapFile: `${code}.pmtiles`,
      ...extra,
    });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'maps-storage-'));
    const config = {
      get: () => ({ storagePath: join(root, 'maps'), routingStoragePath: join(root, 'routing') }),
    } as unknown as AppConfigService;
    storage = new LocalMapStorageProvider(config);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  describe('absolutePath', () => {
    it('resolves paths inside the root of each kind', () => {
      expect(storage.absolutePath('map', 'ecuador/guayaquil.pmtiles')).toBe(
        join(root, 'maps', 'ecuador', 'guayaquil.pmtiles'),
      );
      expect(storage.absolutePath('routing', 'guayaquil/guayaquil.valhalla.tar')).toBe(
        join(root, 'routing', 'guayaquil', 'guayaquil.valhalla.tar'),
      );
    });

    it.each(['../routing/secret.tar', 'ecuador/../../etc/passwd', '..'])(
      'refuses to escape the root with %s',
      (path) => {
        expect(() => storage.absolutePath('map', path)).toThrow('Path escapes the storage root');
      },
    );

    it('refuses absolute paths', () => {
      expect(() => storage.absolutePath('map', '/etc/passwd')).toThrow(
        'Storage paths must be relative',
      );
    });
  });

  describe('files', () => {
    beforeEach(() => put('maps/ecuador/guayaquil.pmtiles', '0123456789'));

    it('returns size and mtime of a file, null for missing files and directories', async () => {
      const info = await storage.stat('map', 'ecuador/guayaquil.pmtiles');
      expect(info?.size).toBe(10);
      // fs returns Dates from Node's realm, so compare the value rather than the prototype.
      expect(Math.abs(info!.modifiedAt.getTime() - Date.now())).toBeLessThan(60_000);
      await expect(storage.stat('map', 'ecuador/quito.pmtiles')).resolves.toBeNull();
      await expect(storage.stat('map', 'ecuador')).resolves.toBeNull();
    });

    it('streams a byte range (inclusive end)', async () => {
      await expect(
        text(storage.createReadStream('map', 'ecuador/guayaquil.pmtiles', { start: 2, end: 5 })),
      ).resolves.toBe('2345');
    });

    it('computes the SHA-256 of a file', async () => {
      await expect(storage.sha256('map', 'ecuador/guayaquil.pmtiles')).resolves.toBe(
        createHash('sha256').update('0123456789').digest('hex'),
      );
    });
  });

  describe('listManifests', () => {
    it('finds manifests in nested folders and skips invalid or hidden ones', async () => {
      await put('maps/guayaquil.region.json', manifest('guayaquil'));
      await put('maps/south-america/ecuador.region.json', manifest('ecuador'));
      await put('maps/europe/monaco/monaco.region.json', manifest('monaco'));
      await put('maps/.building/partial.region.json', manifest('partial'));
      await put('maps/broken.region.json', '{ not json');
      await put('maps/incomplete.region.json', JSON.stringify({ code: 'incomplete' }));
      await put('maps/notes.json', manifest('not-a-manifest'));

      const manifests = await storage.listManifests();

      expect(manifests.map((item) => item.code).sort()).toEqual(['ecuador', 'guayaquil', 'monaco']);
      expect(Logger.prototype.warn).toHaveBeenCalledTimes(2);
    });

    it('returns an empty list while no region has been prepared', async () => {
      await expect(storage.listManifests()).resolves.toEqual([]);
    });
  });
});
