import { BoundingBox } from '../../../common/geo/geojson';
import type { EventsSqlClient } from '../../events/application/platform-events.service';

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

/**
 * Formats of the routing file of a region, told by its extension: the offline pack of the mobile
 * app (road network and search index, written by `region.sh pack`) or the Valhalla tiles of the
 * legacy OSM regions, which no client reads.
 */
export const ROUTING_FORMATS = {
  'route-maps-pack': {
    extension: '.rmpack',
    contentType: 'application/vnd.route-maps.offline-pack',
  },
  'valhalla-tiles': { extension: '.tar', contentType: 'application/x-tar' },
} as const;
export type RoutingFormat = keyof typeof ROUTING_FORMATS;

export const routingFormatOf = (file: string | null): RoutingFormat | null => {
  if (!file) return null;
  const format = (Object.keys(ROUTING_FORMATS) as RoutingFormat[]).find((name) =>
    file.endsWith(ROUTING_FORMATS[name].extension),
  );
  return format ?? null;
};

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
  /** Offline pack of the mobile app (see ROUTING_FORMATS), relative to the routing storage root. */
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

/**
 * Saved with every change of a region, in its transaction and given the region as saved: the
 * event that announces it, so that the change and its event are kept together or not at all.
 */
export type RegionAnnouncement = (region: MapRegion, tx: EventsSqlClient) => Promise<unknown>;

export interface MapRegionRepository {
  findAll(options: { includeDisabled: boolean }): Promise<MapRegion[]>;
  findByCodeOrId(idOrCode: string): Promise<MapRegion | null>;
  findContaining(latitude: number, longitude: number): Promise<MapRegion[]>;
  upsert(region: UpsertMapRegion, announce: RegionAnnouncement): Promise<MapRegion>;
  setEnabled(code: string, enabled: boolean, announce: RegionAnnouncement): Promise<MapRegion>;
}

export const MAP_REGION_REPOSITORY = Symbol('MAP_REGION_REPOSITORY');
