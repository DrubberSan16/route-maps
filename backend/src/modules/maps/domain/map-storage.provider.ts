import type { Readable } from 'node:stream';

/** Kind of artefact: the visual map (PMTiles) or the routing package (Valhalla tiles). */
export type StorageKind = 'map' | 'routing';

export interface StoredFileInfo {
  size: number;
  modifiedAt: Date;
}

/** Region description written by the data pipeline next to each PMTiles file. */
export interface RegionManifest {
  code: string;
  name: string;
  country: string;
  province?: string;
  city?: string;
  version: string;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  minZoom?: number;
  maxZoom?: number;
  /** Relative to the map storage root. */
  mapFile: string;
  /** Relative to the routing storage root. */
  routingFile?: string;
  /** Optional SHA-256 values computed by the pipeline. */
  mapChecksum?: string;
  routingChecksum?: string;
}

/**
 * Port over the storage holding map artefacts. The initial adapter uses the
 * local filesystem (a Docker volume); an object-storage adapter (S3/MinIO)
 * can implement the same contract later.
 */
export interface MapStorageProvider {
  stat(kind: StorageKind, relativePath: string): Promise<StoredFileInfo | null>;
  createReadStream(
    kind: StorageKind,
    relativePath: string,
    range?: { start: number; end: number },
  ): Readable;
  sha256(kind: StorageKind, relativePath: string): Promise<string>;
  listManifests(): Promise<RegionManifest[]>;
  /** Absolute path, only for adapters backed by a filesystem. */
  absolutePath(kind: StorageKind, relativePath: string): string;
}

export const MAP_STORAGE_PROVIDER = Symbol('MAP_STORAGE_PROVIDER');
