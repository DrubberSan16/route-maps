import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { GeocodingService } from './application/geocoding.service';
import { GEOCODING_PROVIDER, GeocodingProvider } from './domain/geocoding-provider';
import { DisabledGeocodingProvider } from './infrastructure/disabled-geocoding.provider';
import { NominatimGeocodingProvider } from './infrastructure/nominatim-geocoding.provider';
import { GeocodingController } from './presentation/geocoding.controller';

const geocodingProviderFactory = (config: AppConfigService): GeocodingProvider => {
  const geocoding = config.get('geocoding');
  if (geocoding.provider === 'nominatim') {
    return new NominatimGeocodingProvider({
      baseUrl: geocoding.nominatimUrl,
      timeoutMs: geocoding.timeoutMs,
      defaultCountryCodes: geocoding.defaultCountryCodes,
    });
  }
  return new DisabledGeocodingProvider();
};

@Module({
  controllers: [GeocodingController],
  providers: [
    GeocodingService,
    {
      provide: GEOCODING_PROVIDER,
      useFactory: geocodingProviderFactory,
      inject: [AppConfigService],
    },
  ],
  exports: [GEOCODING_PROVIDER],
})
export class GeocodingModule {}
