import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppConfigService } from '../../../config/app-config.service';
import {
  MAP_STORAGE_PROVIDER,
  type MapStorageProvider,
  StorageKind,
} from '../../maps/domain/map-storage.provider';
import { MapRegion } from '../domain/map-region.entity';
import { parseRangeHeader } from './http-range';

const CONTENT_TYPES: Record<StorageKind, string> = {
  map: 'application/vnd.pmtiles',
  routing: 'application/x-tar',
};

/**
 * Serves region artefacts with resumable (Range) downloads. Behind Nginx the
 * transfer is delegated with X-Accel-Redirect; otherwise the file is streamed
 * by Node with the same Range semantics.
 */
@Injectable()
export class RegionDownloadService {
  private readonly logger = new Logger(RegionDownloadService.name);

  constructor(
    @Inject(MAP_STORAGE_PROVIDER) private readonly storage: MapStorageProvider,
    private readonly config: AppConfigService,
  ) {}

  async send(region: MapRegion, kind: StorageKind, req: Request, res: Response): Promise<void> {
    const relativePath = kind === 'map' ? region.fileName : region.routingFile;
    const checksum = kind === 'map' ? region.checksum : region.routingChecksum;
    if (!relativePath) {
      throw AppException.notFound(
        ErrorCode.MAP_REGION_FILE_NOT_AVAILABLE,
        `Region ${region.code} has no ${kind} package`,
      );
    }
    const file = await this.storage.stat(kind, relativePath);
    if (!file) {
      throw AppException.notFound(
        ErrorCode.MAP_REGION_FILE_NOT_AVAILABLE,
        `The ${kind} file of region ${region.code} is not available on the server`,
      );
    }

    const fileName = relativePath.split('/').pop() ?? `${region.code}.bin`;
    const etag = checksum ? `"${checksum}"` : `"${file.size}-${file.modifiedAt.getTime()}"`;
    res.setHeader('Content-Type', CONTENT_TYPES[kind]);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', file.modifiedAt.toUTCString());
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Region-Version', region.version);
    if (checksum) res.setHeader('X-Checksum-Sha256', checksum);

    const maps = this.config.get('maps');
    if (maps.accelRedirect) {
      const prefix = kind === 'map' ? maps.accelMapsPrefix : maps.accelRoutingPrefix;
      res.setHeader('X-Accel-Redirect', `${prefix}${encodeURI(relativePath)}`);
      res.status(HttpStatus.OK).end();
      return;
    }

    if (req.headers['if-none-match'] === etag) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    const ifRange = req.headers['if-range'];
    const rangeHeader = ifRange && ifRange !== etag ? undefined : req.headers.range;
    const parsed = parseRangeHeader(rangeHeader, file.size);
    if (parsed.type === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${file.size}`);
      throw new AppException(
        ErrorCode.INVALID_RANGE,
        'Requested range not satisfiable',
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }

    if (parsed.type === 'range') {
      const { start, end } = parsed.range;
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
    } else {
      res.status(HttpStatus.OK);
      res.setHeader('Content-Length', String(file.size));
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = this.storage.createReadStream(
      kind,
      relativePath,
      parsed.type === 'range' ? parsed.range : undefined,
    );
    try {
      await pipeline(stream, res);
    } catch (error) {
      // Client aborted or disk error mid-transfer: headers are already sent,
      // so the only thing left is to log; the client resumes with Range.
      this.logger.warn({ err: error, region: region.code, kind }, 'Region download interrupted');
    }
  }
}
