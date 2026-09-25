import { BoundingBox } from '../../../common/geo/geojson';

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
