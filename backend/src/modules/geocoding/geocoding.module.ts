import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  NATIVE_GRAPH_STORE,
  NativeGraphStore,
} from '../../infrastructure/native/native-graph.store';
import {
  NATIVE_SEARCH_STORE,
  NativeSearchStore,
} from '../../infrastructure/native/native-search.store';
import { GeocodingService } from './application/geocoding.service';
import { GEOCODING_PROVIDER, GeocodingProvider } from './domain/geocoding-provider';
import { CompositeGeocodingProvider } from './infrastructure/composite-geocoding.provider';
import { DisabledGeocodingProvider } from './infrastructure/disabled-geocoding.provider';
import { NominatimGeocodingProvider } from './infrastructure/nominatim-geocoding.provider';
import { NativeGeocodingProvider } from './infrastructure/native-geocoding.provider';
import { WorldPlaceIndex } from './infrastructure/world-place-index';
import { GeocodingController } from './presentation/geocoding.controller';

const geocodingProviderFactory = (
  config: AppConfigService,
  graph: NativeGraphStore,
  search: NativeSearchStore,
): GeocodingProvider => {
  const geocoding = config.get('geocoding');
  const detailed =
    geocoding.provider === 'native'
      ? new NativeGeocodingProvider(search, graph)
      : geocoding.provider === 'nominatim'
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
      inject: [AppConfigService, NATIVE_GRAPH_STORE, NATIVE_SEARCH_STORE],
    },
  ],
  exports: [GEOCODING_PROVIDER],
})
export class GeocodingModule {}
