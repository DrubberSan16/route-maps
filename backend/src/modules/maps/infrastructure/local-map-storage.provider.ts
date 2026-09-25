import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppConfigService } from '../../../config/app-config.service';
import {
  MapStorageProvider,
  RegionManifest,
  StorageKind,
  StoredFileInfo,
} from '../domain/map-storage.provider';

const MANIFEST_SUFFIX = '.region.json';

/** Filesystem implementation (Docker volume mounted at MAP_STORAGE_PATH / ROUTING_STORAGE_PATH). */
@Injectable()
export class LocalMapStorageProvider implements MapStorageProvider {
  private readonly logger = new Logger(LocalMapStorageProvider.name);
  private readonly roots: Record<StorageKind, string>;

  constructor(config: AppConfigService) {
    const maps = config.get('maps');
    this.roots = { map: resolve(maps.storagePath), routing: resolve(maps.routingStoragePath) };
  }

  absolutePath(kind: StorageKind, relativePath: string): string {
    const root = this.roots[kind];
    if (isAbsolute(relativePath)) throw new Error('Storage paths must be relative');
    const target = resolve(root, normalize(relativePath));
    const rel = relative(root, target);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('Path escapes the storage root');
    }
    return target;
  }

  async stat(kind: StorageKind, relativePath: string): Promise<StoredFileInfo | null> {
    try {
      const info = await stat(this.absolutePath(kind, relativePath));
      return info.isFile() ? { size: info.size, modifiedAt: info.mtime } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  createReadStream(
    kind: StorageKind,
    relativePath: string,
    range?: { start: number; end: number },
  ): Readable {
    return createReadStream(this.absolutePath(kind, relativePath), range);
  }

  async sha256(kind: StorageKind, relativePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(this.createReadStream(kind, relativePath), hash);
    return hash.digest('hex');
  }

  async listManifests(): Promise<RegionManifest[]> {
    const files = await this.findManifestFiles(this.roots.map);
    const manifests: RegionManifest[] = [];
    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8')) as RegionManifest;
        if (!parsed.code || !parsed.mapFile || !Array.isArray(parsed.bbox)) {
          this.logger.warn(`Ignoring invalid region manifest ${file}`);
          continue;
        }
        manifests.push(parsed);
      } catch (error) {
        this.logger.warn({ err: error }, `Could not read region manifest ${file}`);
      }
    }
    return manifests;
  }

  private async findManifestFiles(dir: string, depth = 0): Promise<string[]> {
    if (depth > 4) return [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const results: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...(await this.findManifestFiles(full, depth + 1)));
      } else if (entry.isFile() && entry.name.endsWith(MANIFEST_SUFFIX)) {
        results.push(full);
      }
    }
    return results;
  }
}
