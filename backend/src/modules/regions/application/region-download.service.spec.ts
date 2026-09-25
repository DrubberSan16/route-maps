import { Controller, Get, INestApplication, Param, Req, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { AppConfigService } from '../../../config/app-config.service';
import { MAP_STORAGE_PROVIDER, StorageKind } from '../../maps/domain/map-storage.provider';
import { LocalMapStorageProvider } from '../../maps/infrastructure/local-map-storage.provider';
import { MapRegion } from '../domain/map-region.entity';
import { RegionDownloadService } from './region-download.service';

const MAP_BYTES = randomBytes(64 * 1024);
const MAP_SHA256 = createHash('sha256').update(MAP_BYTES).digest('hex');

const REGION: MapRegion = {
  id: '6a4c3f7e-8a51-4a57-9d0e-2f0a8c6f1b11',
  code: 'guayaquil',
  name: 'Guayaquil',
  country: 'Ecuador',
  province: 'Guayas',
  city: 'Guayaquil',
  version: '2026.09.25.1830',
  fileName: 'ecuador/guayaquil.pmtiles',
  fileSize: MAP_BYTES.length,
  checksum: MAP_SHA256,
  bbox: [-80.1, -2.35, -79.75, -1.95],
  minZoom: 0,
  maxZoom: 14,
  downloadUrl: null,
  routingFile: null,
  routingFileSize: null,
  routingChecksum: null,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

@Controller('regions')
class DownloadController {
  constructor(private readonly downloads: RegionDownloadService) {}

  @Get(':kind')
  async download(@Param('kind') kind: StorageKind, @Req() req: Request, @Res() res: Response) {
    await this.downloads.send(REGION, kind, req, res);
  }
}

describe('RegionDownloadService', () => {
  let root: string;
  let app: INestApplication;
  let accelRedirect: boolean;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'maps-download-'));
    await mkdir(join(root, 'maps', 'ecuador'), { recursive: true });
    await writeFile(join(root, 'maps', REGION.fileName), MAP_BYTES);

    const maps = () => ({
      storagePath: join(root, 'maps'),
      routingStoragePath: join(root, 'routing'),
      accelRedirect,
      accelMapsPrefix: '/_protected/maps/',
      accelRoutingPrefix: '/_protected/routing/',
    });
    const config = { get: maps } as unknown as AppConfigService;
    const moduleRef = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        RegionDownloadService,
        { provide: AppConfigService, useValue: config },
        { provide: MAP_STORAGE_PROVIDER, useValue: new LocalMapStorageProvider(config) },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  beforeEach(() => {
    accelRedirect = false;
  });

  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const get = (path = '/regions/map') =>
    request(app.getHttpServer())
      .get(path)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  it('serves the whole file with integrity and cache headers', async () => {
    const response = await get().expect(200);

    expect(Buffer.compare(response.body as Buffer, MAP_BYTES)).toBe(0);
    expect(response.headers).toMatchObject({
      'content-type': 'application/vnd.pmtiles',
      'content-length': String(MAP_BYTES.length),
      'content-disposition': 'attachment; filename="guayaquil.pmtiles"',
      'accept-ranges': 'bytes',
      etag: `"${MAP_SHA256}"`,
      'x-checksum-sha256': MAP_SHA256,
      'x-region-version': '2026.09.25.1830',
    });
  });

  it('resumes an interrupted download with Range and the result matches the SHA-256', async () => {
    const alreadyDownloaded = 40_000;

    const response = await get().set('Range', `bytes=${alreadyDownloaded}-`).expect(206);

    expect(response.headers['content-range']).toBe(
      `bytes ${alreadyDownloaded}-${MAP_BYTES.length - 1}/${MAP_BYTES.length}`,
    );
    const resumed = Buffer.concat([
      MAP_BYTES.subarray(0, alreadyDownloaded),
      response.body as Buffer,
    ]);
    expect(createHash('sha256').update(resumed).digest('hex')).toBe(MAP_SHA256);
  });

  it('serves a suffix range (PMTiles directory reads)', async () => {
    const response = await get().set('Range', 'bytes=-16').expect(206);
    expect(Buffer.compare(response.body as Buffer, MAP_BYTES.subarray(-16))).toBe(0);
    expect(response.headers['content-length']).toBe('16');
  });

  it('answers 416 with the file size for a range past the end', async () => {
    const response = await request(app.getHttpServer())
      .get('/regions/map')
      .set('Range', `bytes=${MAP_BYTES.length}-`)
      .expect(416);

    expect(response.headers['content-range']).toBe(`bytes */${MAP_BYTES.length}`);
    expect(response.body).toMatchObject({ success: false, error: { code: 'INVALID_RANGE' } });
  });

  it('ignores the range when If-Range does not match the current version', async () => {
    const response = await get()
      .set('Range', 'bytes=100-')
      .set('If-Range', '"checksum-of-an-older-version"')
      .expect(200);
    expect((response.body as Buffer).length).toBe(MAP_BYTES.length);
  });

  it('keeps honouring the range when If-Range matches', async () => {
    await get().set('Range', 'bytes=100-').set('If-Range', `"${MAP_SHA256}"`).expect(206);
  });

  it('answers 304 when the device already has this version', async () => {
    await request(app.getHttpServer())
      .get('/regions/map')
      .set('If-None-Match', `"${MAP_SHA256}"`)
      .expect(304);
  });

  it('answers HEAD with the headers only', async () => {
    const response = await request(app.getHttpServer()).head('/regions/map').expect(200);
    expect(response.headers['content-length']).toBe(String(MAP_BYTES.length));
  });

  it('delegates the transfer to Nginx with X-Accel-Redirect when enabled', async () => {
    accelRedirect = true;
    const response = await get().expect(200);
    expect(response.headers['x-accel-redirect']).toBe('/_protected/maps/ecuador/guayaquil.pmtiles');
    expect(response.headers['x-checksum-sha256']).toBe(MAP_SHA256);
    expect((response.body as Buffer).length).toBe(0);
  });

  it('answers 404 when the region has no routing package', async () => {
    const response = await request(app.getHttpServer()).get('/regions/routing').expect(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'MAP_REGION_FILE_NOT_AVAILABLE' },
    });
  });
});
