import { Module } from '@nestjs/common';
import { PlacesService } from './application/places.service';
import { PLACE_REPOSITORY } from './domain/place.entity';
import { PrismaPlaceRepository } from './infrastructure/prisma-place.repository';
import { PlacesController } from './presentation/places.controller';

@Module({
  controllers: [PlacesController],
  providers: [PlacesService, { provide: PLACE_REPOSITORY, useClass: PrismaPlaceRepository }],
  exports: [PlacesService],
})
export class PlacesModule {}
