import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { buildLoggerParams } from './infrastructure/logging/logger.config';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { GeofencesModule } from './modules/geofences/geofences.module';
import { HealthModule } from './modules/health/health.module';
import { MapsModule } from './modules/maps/maps.module';
import { PlacesModule } from './modules/places/places.module';
import { RegionsModule } from './modules/regions/regions.module';
import { RoutingModule } from './modules/routing/routing.module';
import { SynchronizationModule } from './modules/synchronization/synchronization.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TripsModule } from './modules/trips/trips.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({ inject: [AppConfigService], useFactory: buildLoggerParams }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        {
          name: 'default',
          ttl: config.get('rateLimit').ttlMs,
          limit: config.get('rateLimit').limit,
        },
      ],
    }),
    PrismaModule,
    CacheModule,
    AuthModule,
    UsersModule,
    MapsModule,
    RegionsModule,
    RoutingModule,
    GeocodingModule,
    PlacesModule,
    TripsModule,
    TrackingModule,
    GeofencesModule,
    SynchronizationModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
