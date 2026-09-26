import { Logger } from '@nestjs/common';
import { readFile, stat } from 'node:fs/promises';
import { GeocodingResult, GeocodingSearchQuery } from '../domain/geocoding-provider';

/** One place of world.places.json, written with the world base map (`make prepare-region REGION=world`). */
export interface WorldPlace {
  type: 'country' | 'city';
  name: string;
  nameEs?: string;
  countryCode?: string;
  country?: string;
  countryEs?: string;
  admin1?: string;
  /** "2" national capital, "4" provincial capital. */
  capital?: string;
  lat: number;
  lng: number;
  population: number;
  /** [minLng, minLat, maxLng, maxLat] (countries). */
  bbox?: [number, number, number, number];
}

export interface WorldPlaceMatch {
  result: GeocodingResult;
  /** Countries, national capitals and big cities whose name matches the start of the query. */
  important: boolean;
}

interface IndexedPlace {
  place: WorldPlace;
  /** Normalized name and Spanish name. */
  names: string[];
  /** Normalized country names, country code and province, to narrow "Lima, Perú". */
  context: string[];
}

/** Lower case, without accents or punctuation: "São Paulo" becomes "sao paulo". */
export const normalizeText = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** 0 exact name, 1 name starts with the query, 2 a word of the name does, -1 no match. */
const matchTier = (names: string[], query: string): number => {
  let best = -1;
  for (const name of names) {
    const tier =
      name === query
        ? 0
        : name.startsWith(query)
          ? 1
          : name.split(' ').some((word) => word.startsWith(query)) || name.includes(` ${query}`)
            ? 2
            : -1;
    if (tier >= 0 && (best < 0 || tier < best)) best = tier;
  }
  return best;
};

/** Countries first, then national capitals, provincial capitals and other cities. */
const kindRank = (place: WorldPlace): number =>
  place.type === 'country' ? 0 : place.capital === '2' ? 1 : place.capital === '4' ? 2 : 3;

const BIG_CITY_POPULATION = 1_000_000;

const isValid = (place: WorldPlace): boolean =>
  (place?.type === 'country' || place?.type === 'city') &&
  typeof place.name === 'string' &&
  Number.isFinite(place.lat) &&
  Number.isFinite(place.lng);

const indexPlace = (place: WorldPlace): IndexedPlace => ({
  place,
  names: [
    ...new Set([place.name, place.nameEs].filter(Boolean).map((name) => normalizeText(name!))),
  ],
  context: [place.country, place.countryEs, place.countryCode, place.admin1]
    .filter((value): value is string => Boolean(value))
    .map(normalizeText),
});

/**
 * Countries and cities of the whole world (Natural Earth, built with the world base map), searched in memory: the
 * place search finds "Lima" or "Madrid" even where no detailed geocoding data (Nominatim) is loaded. The file is
 * re-read when it changes.
 */
export class WorldPlaceIndex {
  private readonly logger = new Logger(WorldPlaceIndex.name);
  private places: IndexedPlace[] = [];
  private loadedMtimeMs = -1;
  private checkedAt = -Infinity;
  private loading: Promise<IndexedPlace[]> | null = null;

  constructor(
    private readonly file: string,
    private readonly recheckMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the index file exists and lists places. */
  async available(): Promise<boolean> {
    return (await this.load()).length > 0;
  }

  async search(query: GeocodingSearchQuery): Promise<WorldPlaceMatch[]> {
    const places = await this.load();
    const [name = '', ...context] = query.text.split(',').map(normalizeText);
    if (places.length === 0 || name.length < 2) return [];
    const countryCodes = query.countryCodes?.map((code) => code.toUpperCase());
    let matches = this.match(places, name, context.filter(Boolean).join(' '), countryCodes);
    if (matches.length === 0 && context.length === 0 && name.includes(' ')) {
      // "lima peru": the last word may be the country or the province.
      const words = name.split(' ');
      matches = this.match(places, words.slice(0, -1).join(' '), words.at(-1)!, countryCodes);
    }
    return matches.slice(0, query.limit).map(({ entry, tier }) => ({
      result: toResult(entry.place),
      important:
        tier <= 1 &&
        (entry.place.type === 'country' ||
          entry.place.capital === '2' ||
          entry.place.population >= BIG_CITY_POPULATION),
    }));
  }

  private match(
    places: IndexedPlace[],
    name: string,
    context: string,
    countryCodes?: string[],
  ): { entry: IndexedPlace; tier: number }[] {
    const matches: { entry: IndexedPlace; tier: number }[] = [];
    for (const entry of places) {
      if (countryCodes?.length && !countryCodes.includes(entry.place.countryCode ?? '')) continue;
      if (context && !entry.context.some((value) => value.startsWith(context))) continue;
      const tier = matchTier(entry.names, name);
      if (tier >= 0) matches.push({ entry, tier });
    }
    return matches.sort(
      (a, b) =>
        a.tier - b.tier ||
        kindRank(a.entry.place) - kindRank(b.entry.place) ||
        b.entry.place.population - a.entry.place.population,
    );
  }

  private load(): Promise<IndexedPlace[]> {
    if (this.now() - this.checkedAt < this.recheckMs) return Promise.resolve(this.places);
    this.loading ??= this.reload().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async reload(): Promise<IndexedPlace[]> {
    this.checkedAt = this.now();
    try {
      const info = await stat(this.file);
      if (info.mtimeMs === this.loadedMtimeMs) return this.places;
      const data = JSON.parse(await readFile(this.file, 'utf8')) as { places?: WorldPlace[] };
      this.places = (data.places ?? []).filter(isValid).map(indexPlace);
      this.loadedMtimeMs = info.mtimeMs;
      this.logger.log(`World place index: ${this.places.length} places from ${this.file}`);
    } catch (error) {
      // Missing file: the world base map was not prepared; the previous index (if any) is kept.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn({ err: error }, `Could not read the world place index ${this.file}`);
      }
    }
    return this.places;
  }
}

const toResult = (place: WorldPlace): GeocodingResult => {
  const name = place.nameEs ?? place.name;
  const country = place.countryEs ?? place.country;
  const province =
    place.admin1 && normalizeText(place.admin1) !== normalizeText(name) ? place.admin1 : undefined;
  const parts = place.type === 'country' ? [name] : [name, province, country];
  return {
    displayName: parts.filter(Boolean).join(', '),
    name,
    latitude: place.lat,
    longitude: place.lng,
    category: 'place',
    type: place.type === 'country' ? 'country' : place.capital === '2' ? 'capital' : 'city',
    address: {
      city: place.type === 'city' ? name : undefined,
      state: place.admin1,
      country,
      countryCode: place.countryCode,
    },
    bbox: place.bbox ?? null,
    sourceId:
      place.type === 'country'
        ? `naturalearth:country:${place.countryCode ?? normalizeText(place.name)}`
        : `naturalearth:city:${place.lat.toFixed(4)},${place.lng.toFixed(4)}`,
  };
};
