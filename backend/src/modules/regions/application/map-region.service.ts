import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { PlatformEventsService } from '../../events/application/platform-events.service';
import {
  MAP_STORAGE_PROVIDER,
  type MapStorageProvider,
  RegionManifest,
} from '../../maps/domain/map-storage.provider';
import {
  MAP_REGION_REPOSITORY,
  MapRegion,
  type MapRegionRepository,
  REGION_ASSET_KINDS,
  RegionAnnouncement,
  RegionAsset,
  RegionAssetKind,
} from '../domain/map-region.entity';
import { buildVersionStatus, VersionStatus } from '../domain/region-version';

export interface RegionSyncReport {
  registered: string[];
  unchanged: string[];
  disabled: string[];
  errors: { code: string; message: string }[];
}

const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** `data` of the region.published and region.disabled events. */
export const regionEventData = (region: MapRegion): Record<string, unknown> => ({
  region: {
    id: region.id,
    code: region.code,
    name: region.name,
    country: region.country,
    province: region.province,
    city: region.city,
    version: region.version,
    enabled: region.enabled,
    mapFileSize: region.fileSize,
    mapChecksum: region.checksum,
    routing: region.routingFile !== null,
    assets: region.assets.map((asset) => asset.kind),
    bbox: region.bbox,
  },
});
const FORMAT_PATTERN = /^[a-z0-9]{2,8}$/;

/** Field by field: JSONB does not keep the key order the assets were written with. */
const sameAssets = (a: RegionAsset[], b: RegionAsset[]): boolean =>
  a.length === b.length &&
  a.every((asset) => {
    const other = b.find((item) => item.kind === asset.kind);
    return (
      other !== undefined &&
      other.file === asset.file &&
      other.size === asset.size &&
      other.checksum === asset.checksum &&
      other.minZoom === asset.minZoom &&
      other.maxZoom === asset.maxZoom &&
      other.format === asset.format
    );
  });

@Injectable()
export class MapRegionService {
  private readonly logger = new Logger(MapRegionService.name);

  constructor(
    @Inject(MAP_REGION_REPOSITORY) private readonly regions: MapRegionRepository,
    @Inject(MAP_STORAGE_PROVIDER) private readonly storage: MapStorageProvider,
    private readonly events: PlatformEventsService,
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

  /** An extra archive of an enabled region, e.g. its satellite imagery. */
  async getAsset(
    idOrCode: string,
    kind: string,
  ): Promise<{ region: MapRegion; asset: RegionAsset }> {
    const region = await this.getEnabled(idOrCode);
    const asset = region.assets.find((item) => item.kind === kind);
    if (!asset) {
      throw AppException.notFound(
        ErrorCode.MAP_REGION_FILE_NOT_AVAILABLE,
        `Region ${region.code} has no ${kind} layer`,
      );
    }
    return { region, asset };
  }

  /** Enables or disables a region; integrations hear about it (region.published / disabled). */
  async setEnabled(idOrCode: string, enabled: boolean): Promise<MapRegion> {
    const region = await this.get(idOrCode);
    if (region.enabled === enabled) return region;
    return this.regions.setEnabled(region.code, enabled, this.announce);
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
        await this.regions.setEnabled(region.code, false, this.announce);
        report.disabled.push(region.code);
      }
    }
    this.logger.log(
      `Region sync: ${report.registered.length} registered, ${report.unchanged.length} unchanged, ` +
        `${report.disabled.length} disabled, ${report.errors.length} errors`,
    );
    return report;
  }

  /** Stored with each change of a region (registered, updated, enabled or disabled). */
  private readonly announce: RegionAnnouncement = (region, tx) =>
    this.events.emit(
      {
        type: region.enabled ? 'region.published' : 'region.disabled',
        accountId: null,
        data: regionEventData(region),
      },
      tx,
    );

  private async syncManifest(
    manifest: RegionManifest,
    force: boolean,
  ): Promise<'registered' | 'unchanged'> {
    if (!CODE_PATTERN.test(manifest.code))
      throw new Error(`Invalid region code "${manifest.code}"`);
    if (!/^[A-Z]{2}$/.test(manifest.country ?? '')) {
      throw new Error(`Invalid country "${manifest.country}": use an ISO 3166-1 alpha-2 code`);
    }
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
      existing.checksum.length === 64 &&
      // A rebuild of the same size under the same version: only its manifest checksum tells.
      (!manifest.mapChecksum || manifest.mapChecksum === existing.checksum);
    const routingUnchanged =
      !force &&
      existing !== null &&
      (existing.routingFile ?? null) === (routingFile ? manifest.routingFile : null) &&
      (existing.routingFileSize ?? null) === (routingFile?.size ?? null);

    const assets = await this.syncAssets(manifest, existing, force);
    const assetsUnchanged = existing !== null && sameAssets(existing.assets, assets);

    if (mapUnchanged && routingUnchanged && assetsUnchanged) return 'unchanged';

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

    await this.regions.upsert(
      {
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
        assets,
        enabled: true,
      },
      this.announce,
    );
    return 'registered';
  }

  /**
   * Relief, satellite and overlay archives listed in the manifest. A missing file is left out (the
   * region still works without it); a checksum that does not match fails the whole region.
   */
  private async syncAssets(
    manifest: RegionManifest,
    existing: MapRegion | null,
    force: boolean,
  ): Promise<RegionAsset[]> {
    const assets: RegionAsset[] = [];
    for (const item of manifest.assets ?? []) {
      if (!REGION_ASSET_KINDS.includes(item.kind as RegionAssetKind)) {
        throw new Error(`Unknown asset kind "${item.kind}"`);
      }
      const kind = item.kind as RegionAssetKind;
      if (assets.some((asset) => asset.kind === kind)) throw new Error(`Duplicate ${kind} asset`);
      const file = await this.storage.stat('map', item.file);
      if (!file) {
        this.logger.warn(`Region ${manifest.code}: ${kind} file ${item.file} not found, skipped`);
        continue;
      }
      const previous = existing?.assets.find((asset) => asset.kind === kind);
      const checksum =
        !force &&
        previous &&
        existing?.version === manifest.version &&
        previous.file === item.file &&
        previous.size === file.size &&
        (!item.checksum || item.checksum === previous.checksum)
          ? previous.checksum
          : await this.storage.sha256('map', item.file);
      if (item.checksum && item.checksum !== checksum) {
        throw new AppException(
          ErrorCode.CHECKSUM_MISMATCH,
          `Checksum of ${item.file} does not match its manifest`,
        );
      }
      const format = (item.format ?? '').toLowerCase();
      assets.push({
        kind,
        file: item.file,
        size: file.size,
        checksum,
        minZoom: item.minZoom ?? 0,
        maxZoom: item.maxZoom ?? manifest.maxZoom ?? 14,
        format: FORMAT_PATTERN.test(format) ? format : 'unknown',
      });
    }
    return assets;
  }
}
