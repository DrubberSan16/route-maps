import {
  GeocodingProvider,
  GeocodingResult,
  GeocodingUnavailableError,
} from '../domain/geocoding-provider';

/**
 * Used when GEOCODING_PROVIDER=none (Nominatim not deployed). The rest of the
 * platform keeps working; geocoding endpoints answer 503 with a clear code.
 */
export class DisabledGeocodingProvider implements GeocodingProvider {
  readonly name = 'none';
  readonly enabled = false;

  search(): Promise<GeocodingResult[]> {
    return Promise.reject(
      new GeocodingUnavailableError(
        'Geocoding is disabled on this server (start the "geocoding" compose profile)',
      ),
    );
  }

  reverse(): Promise<GeocodingResult | null> {
    return this.search().then(() => null);
  }

  health(): Promise<'disabled'> {
    return Promise.resolve('disabled');
  }
}
