import { MapRegion } from '../../domain/map-region.entity';
import { toRegionResponse } from './region.dto';

const REGION: MapRegion = {
  id: '6a4c3f7e-8a51-4a57-9d0e-2f0a8c6f1b11',
  code: 'guayaquil',
  name: 'Guayaquil',
  country: 'EC',
  province: 'Guayas',
  city: 'Guayaquil',
  version: '2026.09.30.1200',
  fileName: 'ecuador/guayaquil.pmtiles',
  fileSize: 1000,
  checksum: 'a'.repeat(64),
  bbox: [-80.1, -2.33, -79.78, -2],
  minZoom: 0,
  maxZoom: 14,
  downloadUrl: null,
  routingFile: null,
  routingFileSize: null,
  routingChecksum: null,
  assets: [
    {
      kind: 'satellite',
      file: 'ecuador/guayaquil.satellite.pmtiles',
      size: 5422330,
      checksum: 'b'.repeat(64),
      minZoom: 0,
      maxZoom: 14,
      format: 'webp',
    },
  ],
  enabled: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('toRegionResponse', () => {
  it('names the tile URLs by content so that a new build is never hidden by a cache', () => {
    const response = toRegionResponse(REGION, '/maps/');

    expect(response.tilesUrl).toBe(`/maps/ecuador/guayaquil.pmtiles?v=${'a'.repeat(16)}`);
    expect(response.assets).toEqual([
      {
        kind: 'satellite',
        format: 'webp',
        minZoom: 0,
        maxZoom: 14,
        size: 5422330,
        checksum: 'b'.repeat(64),
        tilesUrl: `/maps/ecuador/guayaquil.satellite.pmtiles?v=${'b'.repeat(16)}`,
        downloadUrl: '/api/v1/maps/regions/guayaquil/assets/satellite/download',
      },
    ]);
  });

  it('publishes the offline pack of the phone with its format', () => {
    expect(toRegionResponse(REGION, '/maps')).toMatchObject({
      routingDownloadUrl: null,
      routingFormat: null,
    });
    const withPack = toRegionResponse(
      {
        ...REGION,
        routingFile: 'guayaquil/guayaquil.rmpack',
        routingFileSize: 41800000,
        routingChecksum: 'c'.repeat(64),
      },
      '/maps',
    );
    expect(withPack).toMatchObject({
      routingDownloadUrl: '/api/v1/maps/regions/guayaquil/routing/download',
      routingFormat: 'route-maps-pack',
      routingSize: 41800000,
      routingChecksum: 'c'.repeat(64),
    });
  });

  it('tells the legacy Valhalla tiles apart, so the app does not take them for a pack', () => {
    const legacy = toRegionResponse(
      { ...REGION, routingFile: 'guayaquil/guayaquil.valhalla.tar', routingFileSize: 1 },
      '/maps',
    );
    expect(legacy.routingFormat).toBe('valhalla-tiles');
    expect(
      toRegionResponse({ ...REGION, routingFile: 'guayaquil/graph.bin' }, '/maps').routingFormat,
    ).toBeNull();
  });

  it('falls back to the region version for a checksum that is not a SHA-256', () => {
    const response = toRegionResponse({ ...REGION, checksum: 'pending' }, '/maps');

    expect(response.tilesUrl).toBe('/maps/ecuador/guayaquil.pmtiles?v=2026.09.30.1200');
  });
});
