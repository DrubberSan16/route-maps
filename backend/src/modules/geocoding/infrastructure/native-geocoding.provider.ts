import { NativeGraph, CLASS } from '../../../infrastructure/native/native-graph';
import { NativeGraphStore } from '../../../infrastructure/native/native-graph.store';
import { NativeSearchStore } from '../../../infrastructure/native/native-search.store';
import {
  NativeSearchIndex,
  SearchHit,
  fold,
  intersections,
} from '../../../infrastructure/native/native-search';
import {
  GeocodingProvider,
  GeocodingResult,
  GeocodingSearchQuery,
  GeocodingUnavailableError,
} from '../domain/geocoding-provider';

/** "Av. 9 de Octubre y Boyacá", "Amazonas & Naciones Unidas", "10 de Agosto esquina Colón". */
const INTERSECTION = /^(.+?)\s+(?:y|e|&|esq\.?|esquina|con|interseccion|intersección)\s+(.+)$/i;
/** A tap farther than this from any street keeps its coordinates as the name. */
const REVERSE_STREET_METERS = 60;
const REVERSE_POI_METERS = 25;
/** Country of the native data. */
const COUNTRY_CODE = 'EC';

/**
 * Geocoding built only from the platform's own data: the national search index (places, streets,
 * points of interest) and the road graph (street intersections and reverse geocoding).
 */
export class NativeGeocodingProvider implements GeocodingProvider {
  readonly name = 'native';
  readonly enabled = true;

  constructor(
    private readonly index: NativeSearchStore,
    private readonly graph: NativeGraphStore,
  ) {}

  async health(): Promise<'up' | 'down'> {
    return (await this.index.available()) ? 'up' : 'down';
  }

  async dataVersion(): Promise<string> {
    return `${await this.index.fingerprint()}|${await this.graph.fingerprint()}`;
  }

  async search(query: GeocodingSearchQuery): Promise<GeocodingResult[]> {
    // The country filter is strict, as in the other providers.
    const countries = query.countryCodes?.map((code) => code.trim().toUpperCase());
    if (countries?.length && !countries.includes(COUNTRY_CODE)) return [];
    const index = await this.load();
    const text = query.text.trim();
    const results: GeocodingResult[] = [];
    const crossing = INTERSECTION.exec(text);
    if (crossing && (await this.graph.available())) {
      results.push(...(await this.intersections(index, crossing[1], crossing[2], query)));
    }
    for (const hit of index.search(text, { limit: query.limit, near: query.near })) {
      if (results.length >= query.limit) break;
      results.push(toResult(hit));
    }
    return results.slice(0, query.limit);
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodingResult | null> {
    const index = await this.load();
    let graph: NativeGraph | null = null;
    try {
      graph = await this.graph.get();
    } catch {
      graph = null;
    }
    const poi = index.nearest(longitude, latitude, REVERSE_POI_METERS, (hit) => hit.kind === 'poi');
    const street = graph
      ?.nearestEdges(
        longitude,
        latitude,
        REVERSE_STREET_METERS,
        (edge) => graph.edgeName[edge] >= 0 && graph.edgeClass[edge] !== CLASS.connector,
        1,
      )
      .at(0);
    if (!poi && !street) {
      const place = index.nearest(longitude, latitude, 3000, (hit) => hit.kind === 'place');
      if (!place) return null;
      const result = toResult(place);
      return { ...result, latitude, longitude, bbox: null };
    }
    const road = street && graph ? graph.nameOf(street.edge) : null;
    const parish = street && graph ? graph.parishOf(street.edge) : null;
    const city = parish?.canton ?? undefined;
    const context = [
      parish?.parish !== parish?.canton ? parish?.parish : null,
      city,
      parish?.province,
    ].filter((value): value is string => Boolean(value));
    const name = poi?.name ?? road ?? null;
    const displayName = [name, poi && road ? road : null, ...context, 'Ecuador']
      .filter((value): value is string => Boolean(value))
      .filter(
        (value, position, all) =>
          all.findIndex((other) => fold(other) === fold(value)) === position,
      )
      .join(', ');
    return {
      displayName,
      name,
      latitude,
      longitude,
      category: poi ? (poi.category ?? 'poi') : 'highway',
      type: poi ? poi.type : 'street',
      address: {
        road: road ?? undefined,
        suburb: parish?.parish && parish.parish !== parish.canton ? parish.parish : undefined,
        city,
        state: parish?.province,
        country: 'Ecuador',
        countryCode: COUNTRY_CODE,
      },
      bbox: null,
      sourceId: poi ? `native:poi:${poi.index}` : street ? `native:edge:${street.edge}` : null,
    };
  }

  private async load(): Promise<NativeSearchIndex> {
    try {
      return await this.index.get();
    } catch (error) {
      throw new GeocodingUnavailableError('The native search index is not available', {
        cause: error,
      });
    }
  }

  private async intersections(
    index: NativeSearchIndex,
    first: string,
    second: string,
    query: GeocodingSearchQuery,
  ): Promise<GeocodingResult[]> {
    const graph = await this.graph.get();
    const a = index.streets(first, { limit: 25, near: query.near });
    const b = index.streets(second, { limit: 25, near: query.near });
    const found: { score: number; result: GeocodingResult }[] = [];
    const seen = new Set<string>();
    for (const left of a) {
      for (const right of b) {
        if (left.name === right.name) continue;
        for (const point of intersections(graph, left.name, right.name)) {
          const key = `${point.lon.toFixed(4)},${point.lat.toFixed(4)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const parish = graph.parishOf(point.edge);
          const context = [parish?.canton, parish?.province].filter(Boolean).join(', ');
          const name = `${left.name} y ${right.name}`;
          let score = left.score + right.score;
          if (query.near) {
            const km =
              Math.hypot(
                (point.lon - query.near.longitude) * Math.cos((point.lat * Math.PI) / 180),
                point.lat - query.near.latitude,
              ) * 111.2;
            score += 60 * Math.exp(-km / 10);
          }
          found.push({
            score,
            result: {
              displayName: context ? `${name}, ${context}` : name,
              name,
              latitude: point.lat,
              longitude: point.lon,
              category: 'highway',
              type: 'intersection',
              address: {
                road: left.name,
                city: parish?.canton,
                state: parish?.province,
                country: 'Ecuador',
                countryCode: COUNTRY_CODE,
              },
              bbox: null,
              sourceId: `native:intersection:${key}`,
            },
          });
        }
      }
    }
    return found
      .sort((x, y) => y.score - x.score)
      .slice(0, 3)
      .map((item) => item.result);
  }
}

function toResult(hit: SearchHit): GeocodingResult {
  const context = hit.detail;
  const parts = context.split(' · ');
  const place = parts[parts.length - 1] ?? '';
  const [first, second, third] = place.split(', ');
  const city = third ? second : first;
  const state = third ?? second;
  return {
    displayName: context ? `${hit.name}, ${context}` : hit.name,
    name: hit.name,
    latitude: hit.lat,
    longitude: hit.lon,
    category:
      hit.kind === 'street' ? 'highway' : hit.kind === 'poi' ? (hit.category ?? 'poi') : 'place',
    type: hit.kind === 'street' ? 'street' : hit.type,
    address: {
      road: hit.kind === 'street' ? hit.name : undefined,
      city: hit.kind === 'place' ? undefined : city,
      state: state || undefined,
      country: 'Ecuador',
      countryCode: COUNTRY_CODE,
    },
    bbox: hit.bbox,
    sourceId: `native:${hit.kind}:${hit.index}`,
  };
}
