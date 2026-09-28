import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Coordinate, haversineMeters } from '../../../common/geo/geojson';
import {
  GeocodingProvider,
  GeocodingResult,
  GeocodingSearchQuery,
} from '../domain/geocoding-provider';
import { normalizeText } from './world-place-index';

interface NativePlace {
  result: GeocodingResult;
  searchable: string;
}

interface PointFeature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}

const LAYERS = [
  { file: 'places.geojson', category: 'place', type: 'locality', names: ['n_loc'] },
  { file: 'poi-health.geojson', category: 'health', type: 'hospital', names: ['uni_nombre'] },
  { file: 'poi-education.geojson', category: 'education', type: 'school', names: ['nom_instit'] },
  {
    file: 'poi-tourism.geojson',
    category: 'tourism',
    type: 'attraction',
    names: ['nombre', 'na2'],
  },
] as const;

/** In-memory geocoder built only from locally cached official point datasets. */
export class NativeGeocodingProvider implements GeocodingProvider {
  readonly name = 'native';
  readonly enabled = true;
  private places: NativePlace[] | null = null;
  private loading: Promise<NativePlace[]> | null = null;

  constructor(private readonly dataPath: string) {}

  async health(): Promise<'up' | 'down'> {
    try {
      return (await stat(join(this.dataPath, 'places.geojson'))).isFile() ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async search(query: GeocodingSearchQuery): Promise<GeocodingResult[]> {
    const text = normalizeText(query.text);
    if (text.length < 2) return [];
    const near = query.near;
    return (await this.load())
      .map((place) => {
        const at = place.searchable.indexOf(text);
        const tier = at === 0 ? 0 : at > 0 ? 1 : 2;
        const matches = at >= 0 || text.split(' ').every((word) => place.searchable.includes(word));
        const distance = near
          ? haversineMeters(near, {
              latitude: place.result.latitude,
              longitude: place.result.longitude,
            })
          : 0;
        return { place, matches, tier, distance };
      })
      .filter((item) => item.matches)
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          a.distance - b.distance ||
          a.place.result.name!.localeCompare(b.place.result.name!),
      )
      .slice(0, query.limit)
      .map((item) => item.place.result);
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodingResult | null> {
    const target: Coordinate = { latitude, longitude };
    let nearest: { place: NativePlace; meters: number } | null = null;
    for (const place of await this.load()) {
      const meters = haversineMeters(target, {
        latitude: place.result.latitude,
        longitude: place.result.longitude,
      });
      if (!nearest || meters < nearest.meters) nearest = { place, meters };
    }
    // A distant point should keep its coordinates instead of receiving an unrelated POI name.
    return nearest && nearest.meters <= 25_000 ? nearest.place.result : null;
  }

  private load(): Promise<NativePlace[]> {
    if (this.places) return Promise.resolve(this.places);
    this.loading ??= this.readAll().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async readAll(): Promise<NativePlace[]> {
    const places: NativePlace[] = [];
    for (const layer of LAYERS) {
      try {
        const collection = JSON.parse(await readFile(join(this.dataPath, layer.file), 'utf8')) as {
          features?: PointFeature[];
        };
        for (const feature of collection.features ?? []) {
          const coordinates = feature.geometry?.coordinates;
          if (
            feature.geometry?.type !== 'Point' ||
            !Array.isArray(coordinates) ||
            !Number.isFinite(coordinates[0]) ||
            !Number.isFinite(coordinates[1])
          )
            continue;
          const properties = feature.properties ?? {};
          const name = layer.names
            .map((key) => properties[key])
            .find((value) => typeof value === 'string' && value.trim());
          if (typeof name !== 'string') continue;
          const state = string(
            properties.dpa_despro ?? properties.provincia ?? properties.nom_provin,
          );
          const city = string(properties.dpa_descan ?? properties.canton ?? properties.nom_canton);
          const context = [city, state, 'Ecuador'].filter(Boolean);
          const rawId = properties.objectid ?? properties.objectid_1 ?? properties.fid;
          const id = scalarString(rawId) ?? `${coordinates[0]},${coordinates[1]}`;
          const result: GeocodingResult = {
            displayName: [name, ...context].join(', '),
            name,
            latitude: Number(coordinates[1]),
            longitude: Number(coordinates[0]),
            category: layer.category,
            type: layer.type,
            address: { city, state, country: 'Ecuador', countryCode: 'EC' },
            bbox: null,
            sourceId: `native:${layer.file.replace('.geojson', '')}:${id}`,
          };
          places.push({ result, searchable: normalizeText([name, ...context].join(' ')) });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    this.places = places;
    return places;
  }
}

const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const scalarString = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
