import { Module } from '@nestjs/common';
import { GeofencesService } from './application/geofences.service';
import { GEOFENCE_REPOSITORY } from './domain/geofence.entity';
import { PrismaGeofenceRepository } from './infrastructure/prisma-geofence.repository';
import { GeofencesController } from './presentation/geofences.controller';

@Module({
  controllers: [GeofencesController],
  providers: [
    GeofencesService,
    { provide: GEOFENCE_REPOSITORY, useClass: PrismaGeofenceRepository },
  ],
  exports: [GeofencesService],
})
export class GeofencesModule {}
