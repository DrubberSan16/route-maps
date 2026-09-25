export interface GeocodingAddress {
  road?: string;
  houseNumber?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  countryCode?: string;
}

export interface GeocodingResult {
  displayName: string;
  name: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  type: string | null;
  address: GeocodingAddress;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number] | null;
  /** Provider specific stable id, e.g. "osm:way:123". */
  sourceId: string | null;
}

export interface GeocodingSearchQuery {
  text: string;
  limit: number;
  language?: string;
  countryCodes?: string[];
  /** Results near this point are preferred (not a hard filter). */
  near?: { latitude: number; longitude: number };
}

/** Port for forward/reverse geocoding engines (Nominatim, Photon, Pelias, ...). */
export interface GeocodingProvider {
  readonly name: string;
  readonly enabled: boolean;
  search(query: GeocodingSearchQuery): Promise<GeocodingResult[]>;
  reverse(latitude: number, longitude: number, language?: string): Promise<GeocodingResult | null>;
  health(): Promise<'up' | 'down' | 'disabled'>;
}

export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');

export class GeocodingUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeocodingUnavailableError';
  }
}
