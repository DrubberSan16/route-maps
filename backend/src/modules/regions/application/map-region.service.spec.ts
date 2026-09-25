import { HttpStatus, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  MapStorageProvider,
  RegionManifest,
  StorageKind,
  StoredFileInfo,
} from '../../maps/domain/map-storage.provider';
import { MapRegion, MapRegionRepository, UpsertMapRegion } from '../domain/map-region.entity';
import { MapRegionService } from './map-region.service';

class InMemoryRegions implements MapRegionRepository {
  readonly regions = new Map<string, MapRegion>();

  findAll({ includeDisabled }: { includeDisabled: boolean }) {
    return Promise.resolve(
      [...this.regions.values()].filter((region) => includeDisabled || region.enabled),
    );
  }

  findByCodeOrId(idOrCode: string) {
    const region = [...this.regions.values()].find(
      (item) => item.code === idOrCode || item.id === idOrCode,
    );
    return Promise.resolve(region ?? null);
  }

  findContaining(latitude: number, longitude: number) {
    return Promise.resolve(
      [...this.regions.values()].filter(({ bbox, enabled }) => {
        if (!bbox || !enabled) return false;
        const [minLng, minLat, maxLng, maxLat] = bbox;
        return (
          longitude >= minLng && longitude <= maxLng && latitude >= minLat && latitude <= maxLat
        );
      }),
    );
  }

  upsert(data: UpsertMapRegion) {
    const existing = this.regions.get(data.code);
    const region: MapRegion = {
      id: existing?.id ?? randomUUID(),
      downloadUrl: null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
      ...data,
      province: data.province ?? null,
      city: data.city ?? null,
      routingFile: data.routingFile ?? null,
      routingFileSize: data.routingFileSize ?? null,
      routingChecksum: data.routingChecksum ?? null,
    };
    this.regions.set(data.code, region);
    return Promise.resolve(region);
  }

  setEnabled(code: string, enabled: boolean) {
    const region = this.regions.get(code);
    if (region) region.enabled = enabled;
    return Promise.resolve();
  }
}

/** Storage double: files live in memory, SHA-256 calls are counted. */
class MemoryStorage implements MapStorageProvider {
  readonly files = new Map<string, Buffer>();
  manifests: RegionManifest[] = [];
  hashed: string[] = [];

  put(kind: StorageKind, path: string, content: string) {
    this.files.set(`${kind}:${path}`, Buffer.from(content));
  }

  stat(kind: StorageKind, path: string): Promise<StoredFileInfo | null> {
    const file = this.files.get(`${kind}:${path}`);
    return Promise.resolve(file ? { size: file.length, modifiedAt: new Date(0) } : null);
  }

  createReadStream(kind: StorageKind, path: string): Readable {
    return Readable.from(this.files.get(`${kind}:${path}`) ?? Buffer.alloc(0));
  }

  sha256(kind: StorageKind, path: string): Promise<string> {
    this.hashed.push(`${kind}:${path}`);
    return Promise.resolve(sha256(this.files.get(`${kind}:${path}`)!.toString()));
  }

  listManifests(): Promise<RegionManifest[]> {
    return Promise.resolve(structuredClone(this.manifests));
  }

  absolutePath(_kind: StorageKind, path: string): string {
    return `/memory/${path}`;
  }
}

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

const GUAYAQUIL: RegionManifest = {
  code: 'guayaquil',
  name: 'Guayaquil',
  country: 'EC',
  province: 'Guayas',
  city: 'Guayaquil',
  version: '2026.09.25.1830',
  bbox: [-80.1, -2.35, -79.75, -1.95],
  minZoom: 0,
  maxZoom: 14,
  mapFile: 'south-america/ecuador/guayaquil.pmtiles',
  routingFile: 'guayaquil/guayaquil.valhalla.tar',
};

describe('MapRegionService', () => {
  let regions: InMemoryRegions;
  let storage: MemoryStorage;
  let service: MapRegionService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    regions = new InMemoryRegions();
    storage = new MemoryStorage();
    storage.put('map', GUAYAQUIL.mapFile, 'pmtiles v1');
    storage.put('routing', GUAYAQUIL.routingFile!, 'valhalla tiles v1');
    storage.manifests = [GUAYAQUIL];
    service = new MapRegionService(regions, storage);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('syncFromStorage', () => {
    it('registers a prepared region with sizes and SHA-256 checksums', async () => {
      const report = await service.syncFromStorage();

      expect(report).toEqual({
        registered: ['guayaquil'],
        unchanged: [],
        disabled: [],
        errors: [],
      });
      expect(regions.regions.get('guayaquil')).toMatchObject({
        name: 'Guayaquil',
        country: 'EC',
        province: 'Guayas',
        version: '2026.09.25.1830',
        fileName: GUAYAQUIL.mapFile,
        fileSize: 'pmtiles v1'.length,
        checksum: sha256('pmtiles v1'),
        bbox: GUAYAQUIL.bbox,
        routingFile: GUAYAQUIL.routingFile,
        routingFileSize: 'valhalla tiles v1'.length,
        routingChecksum: sha256('valhalla tiles v1'),
        enabled: true,
      });
    });

    it('is cheap on restart: unchanged files are not hashed again', async () => {
      await service.syncFromStorage();
      storage.hashed = [];

      const report = await service.syncFromStorage();

      expect(report.unchanged).toEqual(['guayaquil']);
      expect(storage.hashed).toEqual([]);
    });

    it('re-registers a new version of the data', async () => {
      await service.syncFromStorage();
      storage.put('map', GUAYAQUIL.mapFile, 'pmtiles v2 (new OSM extract)');
      storage.manifests = [{ ...GUAYAQUIL, version: '2026.10.01.0600' }];

      const report = await service.syncFromStorage();

      expect(report.registered).toEqual(['guayaquil']);
      expect(regions.regions.get('guayaquil')).toMatchObject({
        version: '2026.10.01.0600',
        checksum: sha256('pmtiles v2 (new OSM extract)'),
      });
    });

    it('recomputes every checksum when forced', async () => {
      await service.syncFromStorage();
      storage.hashed = [];

      await service.syncFromStorage({ force: true });

      expect(storage.hashed.sort()).toEqual([
        `map:${GUAYAQUIL.mapFile}`,
        `routing:${GUAYAQUIL.routingFile}`,
      ]);
    });

    it('accepts a manifest checksum that matches the file', async () => {
      storage.manifests = [{ ...GUAYAQUIL, mapChecksum: sha256('pmtiles v1') }];
      await expect(service.syncFromStorage()).resolves.toMatchObject({
        registered: ['guayaquil'],
      });
    });

    it('refuses a file whose checksum does not match its manifest', async () => {
      storage.manifests = [{ ...GUAYAQUIL, mapChecksum: sha256('something else') }];

      const report = await service.syncFromStorage();

      expect(report.registered).toEqual([]);
      expect(report.errors).toEqual([
        {
          code: 'guayaquil',
          message: `Checksum of ${GUAYAQUIL.mapFile} does not match its manifest`,
        },
      ]);
      expect(regions.regions.size).toBe(0);
    });

    it.each([
      ['an invalid code', { code: '../etc' }, 'Invalid region code "../etc"'],
      [
        'a country name instead of its ISO code',
        { country: 'Ecuador' },
        'Invalid country "Ecuador": use an ISO 3166-1 alpha-2 code',
      ],
      ['an inverted bbox', { bbox: [-79.75, -1.95, -80.1, -2.35] }, 'Invalid bounding box'],
      ['a missing map file', { mapFile: 'missing.pmtiles' }, 'Map file missing.pmtiles not found'],
    ])('reports %s without stopping the sync', async (_label, override, message) => {
      const other: RegionManifest = { ...GUAYAQUIL, code: 'monaco', name: 'Monaco' };
      storage.manifests = [{ ...GUAYAQUIL, ...override } as RegionManifest, other];

      const report = await service.syncFromStorage();

      expect(report.errors).toEqual([{ code: expect.any(String), message }]);
      expect(report.registered).toEqual(['monaco']);
    });

    it('registers the map even when the routing package is not built yet', async () => {
      storage.files.delete(`routing:${GUAYAQUIL.routingFile}`);

      await service.syncFromStorage();

      expect(regions.regions.get('guayaquil')).toMatchObject({
        routingFile: null,
        routingFileSize: null,
        routingChecksum: null,
      });
    });

    it('disables regions whose files were removed from storage', async () => {
      await service.syncFromStorage();
      storage.manifests = [];
      storage.files.delete(`map:${GUAYAQUIL.mapFile}`);

      const report = await service.syncFromStorage();

      expect(report.disabled).toEqual(['guayaquil']);
      expect(regions.regions.get('guayaquil')?.enabled).toBe(false);
    });

    it('re-enables a region disabled by an administrator when it is synced again', async () => {
      await service.syncFromStorage();
      await service.setEnabled('guayaquil', false);

      await expect(service.syncFromStorage()).resolves.toMatchObject({
        registered: ['guayaquil'],
      });
      expect(regions.regions.get('guayaquil')?.enabled).toBe(true);
    });
  });

  describe('queries', () => {
    beforeEach(() => service.syncFromStorage());

    it('finds a region by code or id', async () => {
      const byCode = await service.get('guayaquil');
      await expect(service.get(byCode.id)).resolves.toEqual(byCode);
    });

    it('answers MAP_REGION_NOT_FOUND for unknown or disabled regions', async () => {
      await regions.setEnabled('guayaquil', false);
      for (const promise of [service.get('quito'), service.getEnabled('guayaquil')]) {
        const error = await promise.catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).code).toBe(ErrorCode.MAP_REGION_NOT_FOUND);
        expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });

    it('compares the version stored on the device', async () => {
      await expect(service.version('guayaquil', '2026.08.01.0000')).resolves.toMatchObject({
        latestVersion: '2026.09.25.1830',
        checksum: sha256('pmtiles v1'),
        updateAvailable: true,
      });
    });

    it('checks updates in batch, ignoring regions the server does not know', async () => {
      const statuses = await service.checkUpdates([
        { id: 'guayaquil', version: '2026.09.25.1830' },
        { id: 'atlantis', version: '1.0' },
      ]);
      expect(statuses).toEqual([
        expect.objectContaining({ region: 'guayaquil', updateAvailable: false }),
      ]);
    });

    it('locates the regions covering a GPS position', async () => {
      await expect(service.locate(-2.19, -79.89)).resolves.toEqual([
        expect.objectContaining({ code: 'guayaquil' }),
      ]);
      await expect(service.locate(-0.18, -78.47)).resolves.toEqual([]);
    });
  });
});
