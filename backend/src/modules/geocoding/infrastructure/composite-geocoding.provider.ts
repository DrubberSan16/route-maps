import { haversineMeters } from '../../../common/geo/geojson';
import {
  GeocodingProvider,
  GeocodingResult,
  GeocodingSearchQuery,
  GeocodingUnavailableError,
} from '../domain/geocoding-provider';
import { normalizeText, WorldPlaceIndex, WorldPlaceMatch } from './world-place-index';

/** Results closer than this with the same name are the same place (a city from both sources). */
const SAME_PLACE_METERS = 25_000;

const samePlace = (a: GeocodingResult, b: GeocodingResult): boolean =>
  normalizeText(a.name ?? a.displayName) === normalizeText(b.name ?? b.displayName) &&
  haversineMeters(a, b) < SAME_PLACE_METERS;

/**
 * Orders the results like a map search: countries, capitals and big cities named like the query first, then the
 * detailed results (streets, addresses, POIs of the prepared countries), then other matching cities of the world.
 */
export const mergeResults = (
  world: WorldPlaceMatch[],
  detailed: GeocodingResult[],
  limit: number,
): GeocodingResult[] => {
  const ordered = [
    ...world.filter((match) => match.important).map((match) => match.result),
    ...detailed,
    ...world.filter((match) => !match.important).map((match) => match.result),
  ];
  const kept: GeocodingResult[] = [];
  for (const result of ordered) {
    if (kept.length >= limit) break;
    if (!kept.some((other) => samePlace(other, result))) kept.push(result);
  }
  return kept;
};

/**
 * Detailed geocoding (Nominatim, only the countries imported into it) plus the world index of countries and cities,
 * so a search also finds "Lima" or "Madrid". Reverse geocoding and health are those of the detailed provider; without
 * a world index the detailed provider answers alone (503 while it is disabled).
 */
export class CompositeGeocodingProvider implements GeocodingProvider {
  constructor(
    private readonly detailed: GeocodingProvider,
    private readonly world: WorldPlaceIndex,
  ) {}

  get name(): string {
    return this.detailed.name;
  }

  get enabled(): boolean {
    return this.detailed.enabled;
  }

  async search(query: GeocodingSearchQuery): Promise<GeocodingResult[]> {
    const world = await this.world.search(query);
    if (!this.detailed.enabled) {
      if (world.length === 0 && !(await this.world.available())) return this.detailed.search(query);
      return world.slice(0, query.limit).map((match) => match.result);
    }
    let detailed: GeocodingResult[] = [];
    try {
      detailed = await this.detailed.search(query);
    } catch (error) {
      if (!(error instanceof GeocodingUnavailableError) || world.length === 0) throw error;
    }
    return mergeResults(world, detailed, query.limit);
  }

  reverse(latitude: number, longitude: number, language?: string): Promise<GeocodingResult | null> {
    return this.detailed.reverse(latitude, longitude, language);
  }

  health(): Promise<'up' | 'down' | 'disabled'> {
    return this.detailed.health();
  }
}
