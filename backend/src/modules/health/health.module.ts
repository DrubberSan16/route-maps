import { Module } from '@nestjs/common';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { RoutingModule } from '../routing/routing.module';
import { HealthService } from './application/health.service';
import { HealthController } from './presentation/health.controller';

@Module({
  imports: [RoutingModule, GeocodingModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
