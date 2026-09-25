import { Module } from '@nestjs/common';
import { PlacesModule } from '../places/places.module';
import { RegionsModule } from '../regions/regions.module';
import { RoutingModule } from '../routing/routing.module';
import { TrackingModule } from '../tracking/tracking.module';
import { TripsModule } from '../trips/trips.module';
import { UsersModule } from '../users/users.module';
import { SynchronizationService } from './application/synchronization.service';
import { SynchronizationController } from './presentation/synchronization.controller';

@Module({
  imports: [UsersModule, TripsModule, TrackingModule, RoutingModule, PlacesModule, RegionsModule],
  controllers: [SynchronizationController],
  providers: [SynchronizationService],
})
export class SynchronizationModule {}
