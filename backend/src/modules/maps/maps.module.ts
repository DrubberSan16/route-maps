import { Module } from '@nestjs/common';
import { MAP_STORAGE_PROVIDER } from './domain/map-storage.provider';
import { LocalMapStorageProvider } from './infrastructure/local-map-storage.provider';

/**
 * Map artefact storage (PMTiles + routing packages). Visual map data and routing
 * data are kept in separate roots: a PMTiles file is never a routing graph.
 */
@Module({
  providers: [{ provide: MAP_STORAGE_PROVIDER, useClass: LocalMapStorageProvider }],
  exports: [MAP_STORAGE_PROVIDER],
})
export class MapsModule {}
