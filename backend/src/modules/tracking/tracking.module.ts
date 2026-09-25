import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module';
import { TrackingService } from './application/tracking.service';
import { TrackingController } from './presentation/tracking.controller';

@Module({
  imports: [TripsModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
