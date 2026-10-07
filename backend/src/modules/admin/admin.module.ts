import { Module } from '@nestjs/common';
import { GeofencesModule } from '../geofences/geofences.module';
import { PlacesModule } from '../places/places.module';
import { RegionsModule } from '../regions/regions.module';
import { RoutingModule } from '../routing/routing.module';
import { TripsModule } from '../trips/trips.module';
import { UsersModule } from '../users/users.module';
import { AdminGeodataService } from './application/admin-geodata.service';
import { AdminOperationsService } from './application/admin-operations.service';
import { AdminOverviewService } from './application/admin-overview.service';
import { AdminUsersService } from './application/admin-users.service';
import { AdminController } from './presentation/admin.controller';
import {
  AdminGeofencesController,
  AdminPlacesController,
  AdminRoutesController,
} from './presentation/admin-geodata.controllers';
import { AdminTripsController } from './presentation/admin-trips.controller';
import { AdminUsersController } from './presentation/admin-users.controller';

/**
 * API of the administration panel (`/admin/*`): accounts, operation across every account,
 * geographic data, events and the audit log. Integrations have their own module.
 */
@Module({
  imports: [UsersModule, TripsModule, GeofencesModule, PlacesModule, RoutingModule, RegionsModule],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminTripsController,
    AdminGeofencesController,
    AdminPlacesController,
    AdminRoutesController,
  ],
  providers: [AdminOverviewService, AdminUsersService, AdminOperationsService, AdminGeodataService],
})
export class AdminModule {}
