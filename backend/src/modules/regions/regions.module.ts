import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { MapsModule } from '../maps/maps.module';
import { DownloadedRegionsService } from './application/downloaded-regions.service';
import { MapRegionService } from './application/map-region.service';
import { RegionDownloadService } from './application/region-download.service';
import { MAP_REGION_REPOSITORY } from './domain/map-region.entity';
import { PrismaMapRegionRepository } from './infrastructure/prisma-map-region.repository';
import { RegionsController } from './presentation/regions.controller';

@Module({
  imports: [MapsModule],
  controllers: [RegionsController],
  providers: [
    MapRegionService,
    RegionDownloadService,
    DownloadedRegionsService,
    { provide: MAP_REGION_REPOSITORY, useClass: PrismaMapRegionRepository },
  ],
  exports: [MapRegionService, DownloadedRegionsService],
})
export class RegionsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegionsModule.name);

  constructor(private readonly regions: MapRegionService) {}

  /** Registers prepared regions at startup without delaying the HTTP server. */
  onApplicationBootstrap(): void {
    if (process.env.REGIONS_SYNC_ON_STARTUP === 'false' || process.env.NODE_ENV === 'test') return;
    this.regions
      .syncFromStorage()
      .catch((error: unknown) => this.logger.error({ err: error }, 'Startup region sync failed'));
  }
}
