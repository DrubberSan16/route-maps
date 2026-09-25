import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  MAP_STORAGE_PROVIDER,
  type MapStorageProvider,
  RegionManifest,
} from '../../maps/domain/map-storage.provider';
import {
  MAP_REGION_REPOSITORY,
  MapRegion,
  type MapRegionRepository,
} from '../domain/map-region.entity';
import { buildVersionStatus, VersionStatus } from '../domain/region-version';

export interface RegionSyncReport {
  registered: string[];
  unchanged: string[];
  disabled: string[];
  errors: { code: string; message: string }[];
}

const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

@Injectable()
export class MapRegionService {
  private readonly logger = new Logger(MapRegionService.name);

  constructor(
    @Inject(MAP_REGION_REPOSITORY) private readonly regions: MapRegionRepository,
    @Inject(MAP_STORAGE_PROVIDER) private readonly storage: MapStorageProvider,
  ) {}

  list(includeDisabled = false): Promise<MapRegion[]> {
    return this.regions.findAll({ includeDisabled });
  }

  async get(idOrCode: string): Promise<MapRegion> {
    const region = await this.regions.findByCodeOrId(idOrCode);
    if (!region) {
      throw AppException.notFound(
        ErrorCode.MAP_REGION_NOT_FOUND,
        `Map region ${idOrCode} not found`,
      );
    }
    return region;
  }

  async getEnabled(idOrCode: string): Promise<MapRegion> {
    const region = await this.get(idOrCode);
    if (!region.enabled) {
      throw AppException.notFound(
        ErrorCode.MAP_REGION_NOT_FOUND,
        `Map region ${idOrCode} not found`,
      );
    }
    return region;
  }

  async version(idOrCode: string, localVersion?: string): Promise<VersionStatus> {
    return buildVersionStatus(await this.getEnabled(idOrCode), localVersion);
  }

  /** Batch update check for the regions stored on a device. */
  async checkUpdates(local: { id: string; version: string }[]): Promise<VersionStatus[]> {
    const all = await this.regions.findAll({ includeDisabled: false });
    const byCode = new Map(all.map((region) => [region.code, region]));
    return local
      .filter((item) => byCode.has(item.id))
      .map((item) => buildVersionStatus(byCode.get(item.id)!, item.version));
  }

  /** Regions covering a GPS position, smallest area first (city before country). */
  locate(latitude: number, longitude: number): Promise<MapRegion[]> {
    return this.regions.findContaining(latitude, longitude);
  }

  async setEnabled(idOrCode: string, enabled: boolean): Promise<MapRegion> {
    const region = await this.get(idOrCode);
    await this.regions.setEnabled(region.code, enabled);
    return this.get(region.code);
  }

  /**
   * Registers every region manifest found in map storage. Checksums are only
   * recomputed when the file size or version changed, so the sync is cheap
   * to run on every startup. Regions whose files disappeared are disabled.
   */
  async syncFromStorage(options: { force?: boolean } = {}): Promise<RegionSyncReport> {
    const report: RegionSyncReport = { registered: [], unchanged: [], disabled: [], errors: [] };
    const manifests = await this.storage.listManifests();
    const seen = new Set<string>();

    for (const manifest of manifests) {
      try {
        const outcome = await this.syncManifest(manifest, options.force ?? false);
        seen.add(manifest.code);
        report[outcome].push(manifest.code);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error({ err: error }, `Could not register region ${manifest.code}`);
        report.errors.push({ code: manifest.code, message });
      }
    }

    for (const region of await this.regions.findAll({ includeDisabled: false })) {
      if (seen.has(region.code)) continue;
      const file = await this.storage.stat('map', region.fileName);
      if (!file) {
        await this.regions.setEnabled(region.code, false);
        report.disabled.push(region.code);
      }
    }
    this.logger.log(
      `Region sync: ${report.registered.length} registered, ${report.unchanged.length} unchanged, ` +
        `${report.disabled.length} disabled, ${report.errors.length} errors`,
    );
    return report;
  }

  private async syncManifest(
    manifest: RegionManifest,
    force: boolean,
  ): Promise<'registered' | 'unchanged'> {
    if (!CODE_PATTERN.test(manifest.code))
      throw new Error(`Invalid region code "${manifest.code}"`);
    const [minLng, minLat, maxLng, maxLat] = manifest.bbox;
    if (!(minLng < maxLng && minLat < maxLat)) throw new Error('Invalid bounding box');

    const mapFile = await this.storage.stat('map', manifest.mapFile);
    if (!mapFile) throw new Error(`Map file ${manifest.mapFile} not found`);
    const routingFile = manifest.routingFile
      ? await this.storage.stat('routing', manifest.routingFile)
      : null;

    const existing = await this.regions.findByCodeOrId(manifest.code);
    const mapUnchanged =
      !force &&
      existing !== null &&
      existing.enabled &&
      existing.version === manifest.version &&
      existing.fileName === manifest.mapFile &&
      existing.fileSize === mapFile.size &&
      existing.checksum.length === 64;
    const routingUnchanged =
      !force &&
      existing !== null &&
      (existing.routingFile ?? null) === (routingFile ? manifest.routingFile : null) &&
      (existing.routingFileSize ?? null) === (routingFile?.size ?? null);

    if (mapUnchanged && routingUnchanged) return 'unchanged';

    const checksum = mapUnchanged
      ? existing.checksum
      : await this.storage.sha256('map', manifest.mapFile);
    if (manifest.mapChecksum && manifest.mapChecksum !== checksum) {
      throw new AppException(
        ErrorCode.CHECKSUM_MISMATCH,
        `Checksum of ${manifest.mapFile} does not match its manifest`,
      );
    }
    const routingChecksum =
      routingFile && manifest.routingFile
        ? routingUnchanged && existing?.routingChecksum
          ? existing.routingChecksum
          : await this.storage.sha256('routing', manifest.routingFile)
        : null;

    await this.regions.upsert({
      code: manifest.code,
      name: manifest.name,
      country: manifest.country,
      province: manifest.province ?? null,
      city: manifest.city ?? null,
      version: manifest.version,
      fileName: manifest.mapFile,
      fileSize: mapFile.size,
      checksum,
      bbox: manifest.bbox,
      minZoom: manifest.minZoom ?? 0,
      maxZoom: manifest.maxZoom ?? 14,
      routingFile: routingFile ? manifest.routingFile : null,
      routingFileSize: routingFile?.size ?? null,
      routingChecksum,
      enabled: true,
    });
    return 'registered';
  }
}
