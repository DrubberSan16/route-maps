import { Module } from '@nestjs/common';
import { GeofencesModule } from '../geofences/geofences.module';
import { TripsModule } from '../trips/trips.module';
import { TrackingService } from './application/tracking.service';
import { TrackingController } from './presentation/tracking.controller';

@Module({
  imports: [TripsModule, GeofencesModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
