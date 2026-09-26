import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { GeocodingService } from './application/geocoding.service';
import { GEOCODING_PROVIDER, GeocodingProvider } from './domain/geocoding-provider';
import { CompositeGeocodingProvider } from './infrastructure/composite-geocoding.provider';
import { DisabledGeocodingProvider } from './infrastructure/disabled-geocoding.provider';
import { NominatimGeocodingProvider } from './infrastructure/nominatim-geocoding.provider';
import { WorldPlaceIndex } from './infrastructure/world-place-index';
import { GeocodingController } from './presentation/geocoding.controller';

const geocodingProviderFactory = (config: AppConfigService): GeocodingProvider => {
  const geocoding = config.get('geocoding');
  const detailed =
    geocoding.provider === 'nominatim'
      ? new NominatimGeocodingProvider({
          baseUrl: geocoding.nominatimUrl,
          timeoutMs: geocoding.timeoutMs,
          defaultCountryCodes: geocoding.defaultCountryCodes,
        })
      : new DisabledGeocodingProvider();
  return new CompositeGeocodingProvider(detailed, new WorldPlaceIndex(geocoding.placesFile));
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
