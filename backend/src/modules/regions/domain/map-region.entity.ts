import { BoundingBox } from '../../../common/geo/geojson';

/** Archives a region may have next to its vector map. */
export const REGION_ASSET_KINDS = ['terrain', 'satellite', 'overlays'] as const;
export type RegionAssetKind = (typeof REGION_ASSET_KINDS)[number];

/**
 * An extra PMTiles archive of the region: relief (elevation tiles), satellite imagery or the
 * hidden-by-default overlays (population, climate), read on demand like the map itself.
 */
export interface RegionAsset {
  kind: RegionAssetKind;
  /** Relative to the map storage root. */
  file: string;
  size: number;
  /** SHA-256 (hex). */
  checksum: string;
  minZoom: number;
  maxZoom: number;
  /** Tile format: webp, png, jpg or pbf. */
  format: string;
}

export interface MapRegion {
  id: string;
  code: string;
  name: string;
  country: string;
  province: string | null;
  city: string | null;
  version: string;
  fileName: string;
  fileSize: number;
  checksum: string;
  bbox: BoundingBox | null;
  minZoom: number;
  maxZoom: number;
  downloadUrl: string | null;
  routingFile: string | null;
  routingFileSize: number | null;
  routingChecksum: string | null;
  assets: RegionAsset[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertMapRegion {
  code: string;
  name: string;
  country: string;
  province?: string | null;
  city?: string | null;
  version: string;
  fileName: string;
  fileSize: number;
  checksum: string;
  bbox: BoundingBox;
  minZoom: number;
  maxZoom: number;
  routingFile?: string | null;
  routingFileSize?: number | null;
  routingChecksum?: string | null;
  assets?: RegionAsset[];
  enabled: boolean;
}

export interface MapRegionRepository {
  findAll(options: { includeDisabled: boolean }): Promise<MapRegion[]>;
  findByCodeOrId(idOrCode: string): Promise<MapRegion | null>;
  findContaining(latitude: number, longitude: number): Promise<MapRegion[]>;
  upsert(region: UpsertMapRegion): Promise<MapRegion>;
  setEnabled(code: string, enabled: boolean): Promise<void>;
}

export const MAP_REGION_REPOSITORY = Symbol('MAP_REGION_REPOSITORY');
