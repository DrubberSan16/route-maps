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
/** A detailed place this close to the map (anywhere in the prepared country) beats its namesakes abroad. */
const PREFERRED_PLACE_METERS = 1_500_000;
const PLACE_TYPES = new Set(['capital', 'city', 'town', 'state', 'county', 'administrative']);

const samePlace = (a: GeocodingResult, b: GeocodingResult): boolean =>
  normalizeText(a.name ?? a.displayName) === normalizeText(b.name ?? b.displayName) &&
  haversineMeters(a, b) < SAME_PLACE_METERS;

/**
 * Orders the results like a map search: the places of the prepared country that its index ranks first, then
 * countries, capitals and big cities of the world named like the query, then the other detailed results (streets,
 * neighbourhoods, points of interest), then other matching cities of the world.
 */
export const mergeResults = (
  world: WorldPlaceMatch[],
  detailed: GeocodingResult[],
  limit: number,
  query?: GeocodingSearchQuery,
): GeocodingResult[] => {
  // The detailed index already ranks by name, popular name, importance and distance: the places it
  // puts first ("Santo Domingo de los Colorados" for "Santo Domingo") go before their namesakes of
  // the world when the map shows the prepared country; its order is never changed.
  const preferred: GeocodingResult[] = [];
  if (query?.near) {
    for (const result of detailed) {
      if (
        !PLACE_TYPES.has(result.type ?? '') ||
        haversineMeters(result, query.near) > PREFERRED_PLACE_METERS
      ) {
        break;
      }
      preferred.push(result);
    }
  }
  const ordered = [
    ...preferred,
    ...world.filter((match) => match.important).map((match) => match.result),
    ...detailed.slice(preferred.length),
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
 * Detailed geocoding (the native index of the prepared country) plus the world index of countries and cities, so a
 * search also finds "Lima" or "Madrid". Reverse geocoding and health are those of the detailed provider; without a
 * world index the detailed provider answers alone (503 while it is disabled).
 */
export class CompositeGeocodingProvider implements GeocodingProvider {
  /** After a failure of the detailed provider, answers are partial for this long. */
  static readonly DEGRADED_MS = 60_000;

  private degradedUntil = 0;

  constructor(
    private readonly detailed: GeocodingProvider,
    private readonly world: WorldPlaceIndex,
    private readonly now: () => number = Date.now,
  ) {}

  get name(): string {
    return this.detailed.name;
  }

  get enabled(): boolean {
    return this.detailed.enabled;
  }

  /** True while the detailed provider failed recently: world-only answers must not be cached. */
  get degraded(): boolean {
    return this.now() < this.degradedUntil;
  }

  async dataVersion(): Promise<string> {
    // Both indexes: a rebuilt world index must not leave old answers in the cache.
    const detailed = (await this.detailed.dataVersion?.()) ?? '';
    return `${detailed}|world:${await this.world.version()}`;
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
      this.degradedUntil = this.now() + CompositeGeocodingProvider.DEGRADED_MS;
    }
    return mergeResults(world, detailed, query.limit, query);
  }

  reverse(latitude: number, longitude: number, language?: string): Promise<GeocodingResult | null> {
    return this.detailed.reverse(latitude, longitude, language);
  }

  health(): Promise<'up' | 'down' | 'disabled'> {
    return this.detailed.health();
  }
}
