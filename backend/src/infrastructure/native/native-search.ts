import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { NativeGraph } from './native-graph';

/**
 * In-memory search over `search.ndjson` (data pipeline, catalog.py): places, streets, points of
 * interest and administrative units of the region, with their context ("Tarqui, Cuenca, Azuay").
 *
 * Every query word must appear in the name (or an alias) or in the context of an entry, at least
 * one in the name; the last word may be incomplete. Results are ranked by how well the name is
 * covered, the importance of the entry and, when the client sends its position, the distance.
 */

export interface SearchHit {
  index: number;
  name: string;
  detail: string;
  kind: string;
  type: string;
  category: string | null;
  lon: number;
  lat: number;
  bbox: [number, number, number, number] | null;
  parish: string | null;
  score: number;
}

export interface SearchOptions {
  limit: number;
  near?: { latitude: number; longitude: number };
  kinds?: string[];
}

interface RawEntry {
  n: string;
  k: string;
  t: string;
  x: number;
  y: number;
  r: number;
  d?: string;
  c?: string;
  b?: [number, number, number, number];
  p?: string;
  a?: string[];
  pop?: number;
}

const KINDS = ['admin', 'place', 'poi', 'street'];
/** Words that describe a road type or join words: they help ranking but never filter. */
const SOFT_WORDS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'en',
  'y',
  'e',
  'a',
  'al',
  'con',
  'calle',
  'c',
  'cl',
  'avenida',
  'av',
  'avda',
  'pasaje',
  'pje',
  'psje',
  'callejon',
  'cjon',
  'peatonal',
  'paseo',
  'via',
  'carretera',
  'autopista',
  'diagonal',
  'transversal',
  'redondel',
  'sector',
  'barrio',
  'parque',
  'cerca',
]);
const METERS_PER_DEGREE = 111_195.08;
/** Places people search from anywhere: proximity barely changes their order. */
const MAJOR_PLACES = new Set(['city', 'town', 'state', 'county']);
/**
 * Bonus of a place or division named exactly like the query. A city must beat the nearby streets
 * named after it ("Ambato" typed in Guayaquil, where "Av. 1D S-E - Ambato" is 2 km away); a canton
 * or parish only beats them when the street is not close.
 */
const EXACT_PLACE_BONUS: Record<string, number> = {
  city: 100,
  state: 90,
  town: 80,
  county: 70,
  administrative: 40,
};

export const fold = (text: string | null | undefined): string =>
  (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^0-9a-z]+/g, ' ')
    .trim();

export class NativeSearchIndex {
  readonly size: number;
  private readonly names: string[];
  private readonly details: string[];
  private readonly folded: string[];
  private readonly foldedContext: string[];
  private readonly kinds: Uint8Array;
  private readonly types: string[];
  private readonly categories: (string | null)[];
  private readonly lon: Float64Array;
  private readonly lat: Float64Array;
  private readonly boxes: Float32Array;
  private readonly ranks: Uint8Array;
  private readonly parishes: (string | null)[];
  /** Entries by word of their names, and by word of their context. */
  private readonly nameWords: Postings;
  private readonly contextWords: Postings;
  private readonly grid = new Map<number, number[]>();

  private constructor(entries: RawEntry[]) {
    const size = entries.length;
    this.size = size;
    this.names = new Array<string>(size);
    this.details = new Array<string>(size);
    this.folded = new Array<string>(size);
    this.foldedContext = new Array<string>(size);
    this.kinds = new Uint8Array(size);
    this.types = new Array<string>(size);
    this.categories = new Array<string | null>(size);
    this.lon = new Float64Array(size);
    this.lat = new Float64Array(size);
    this.boxes = new Float32Array(size * 4).fill(Number.NaN);
    this.ranks = new Uint8Array(size);
    this.parishes = new Array<string | null>(size);
    const nameWords = new Map<string, number[]>();
    const contextWords = new Map<string, number[]>();
    const add = (postings: Map<string, number[]>, token: string, index: number) => {
      const list = postings.get(token);
      if (list) list.push(index);
      else postings.set(token, [index]);
    };
    entries.forEach((entry, index) => {
      this.names[index] = entry.n;
      this.details[index] = entry.d ?? '';
      const allNames = [entry.n, ...(entry.a ?? [])].map(fold).filter(Boolean);
      this.folded[index] = allNames.join(' | ');
      this.foldedContext[index] = fold(entry.d);
      this.kinds[index] = Math.max(0, KINDS.indexOf(entry.k));
      this.types[index] = entry.t;
      this.categories[index] = entry.c ?? null;
      this.lon[index] = entry.x;
      this.lat[index] = entry.y;
      if (entry.b) this.boxes.set(entry.b, index * 4);
      this.ranks[index] = Math.max(0, Math.min(255, entry.r));
      this.parishes[index] = entry.p ?? null;
      for (const token of new Set(allNames.join(' ').split(' '))) {
        if (token && token !== '|') add(nameWords, token, index);
      }
      for (const token of new Set(this.foldedContext[index].split(' '))) {
        if (token) add(contextWords, token, index);
      }
      if (entry.k === 'poi' || entry.k === 'place') {
        const key = gridKey(entry.x, entry.y);
        const list = this.grid.get(key);
        if (list) list.push(index);
        else this.grid.set(key, [index]);
      }
    });
    this.nameWords = postingsOf(nameWords);
    this.contextWords = postingsOf(contextWords);
  }

  static async load(file: string): Promise<NativeSearchIndex> {
    const entries: RawEntry[] = [];
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim()) entries.push(JSON.parse(line) as RawEntry);
    }
    return new NativeSearchIndex(entries);
  }

  static fromEntries(entries: RawEntry[]): NativeSearchIndex {
    return new NativeSearchIndex(entries);
  }

  search(text: string, options: SearchOptions): SearchHit[] {
    const query = fold(text);
    const words = query.split(' ').filter(Boolean);
    if (words.length === 0) return [];
    const partialLast = !/\s$/.test(text);
    let required = words.filter((word) => !SOFT_WORDS.has(word));
    if (required.length === 0) required = words;
    const lastWord = words[words.length - 1];
    const matchers = required.map((word) => {
      const prefix = partialLast && word === lastWord && word.length >= 2;
      const inNames = lookup(this.nameWords, word, prefix);
      const inContexts = lookup(this.contextWords, word, prefix);
      const size = [...inNames, ...inContexts].reduce((sum, list) => sum + list.length, 0);
      return { word, prefix, variants: variants(word), inNames, inContexts, size };
    });
    // Every word is in the name or the context of a result, and at least one in the name.
    if (matchers.some((matcher) => matcher.size === 0)) return [];
    if (matchers.every((matcher) => matcher.inNames.length === 0)) return [];
    // Candidates: the entries with the rarest word, in their name or in their context.
    const driver = matchers.reduce((rarest, matcher) =>
      matcher.size < rarest.size ? matcher : rarest,
    );
    const kinds = options.kinds ? new Set(options.kinds.map((kind) => KINDS.indexOf(kind))) : null;
    const near = options.near;
    const kx = near ? METERS_PER_DEGREE * Math.cos((near.latitude * Math.PI) / 180) : 0;
    const hits: SearchHit[] = [];
    const seen = new Set<number>();
    for (const list of [...driver.inNames, ...driver.inContexts]) {
      for (let i = 0; i < list.length; i += 1) {
        const index = list[i];
        if (seen.has(index)) continue;
        seen.add(index);
        if (kinds && !kinds.has(this.kinds[index])) continue;
        const nameWords = this.folded[index].split(' ').filter((word) => word && word !== '|');
        const contextWords = this.foldedContext[index].split(' ');
        let nameMatches = 0;
        let contextOnly = 0;
        let ok = true;
        const covered = new Set<string>();
        for (const matcher of matchers) {
          const hit = nameWords.find((word) => matches(word, matcher));
          if (hit) {
            nameMatches += 1;
            covered.add(hit);
            continue;
          }
          if (contextWords.some((word) => matches(word, matcher))) {
            contextOnly += 1;
            continue;
          }
          ok = false;
          break;
        }
        if (!ok || nameMatches === 0) continue;
        const names = this.folded[index].split(' | ');
        // Coverage of the meaningful words of the best name ("de", "calle"… do not count).
        let coverage = 0;
        for (const name of names) {
          const meaningful = name.split(' ').filter((word) => !SOFT_WORDS.has(word));
          if (meaningful.length === 0) continue;
          const share = meaningful.filter((word) => covered.has(word)).length / meaningful.length;
          if (share > coverage) coverage = share;
        }
        const exact = names.includes(query);
        const startsWith = names.some((name) => name.startsWith(query));
        const kind = KINDS[this.kinds[index]];
        const type = this.types[index];
        const exactPlace =
          exact && (kind === 'admin' || kind === 'place') ? (EXACT_PLACE_BONUS[type] ?? 0) : 0;
        let score =
          this.ranks[index] +
          coverage * 60 +
          (exact ? 20 : 0) +
          exactPlace +
          (startsWith ? 10 : 0) -
          contextOnly * 6;
        if (near) {
          const dx = (this.lon[index] - near.longitude) * kx;
          const dy = (this.lat[index] - near.latitude) * METERS_PER_DEGREE;
          const km = Math.sqrt(dx * dx + dy * dy) / 1000;
          // What is near matters most for streets, places of interest and neighbourhoods, less for
          // villages and parishes, little for cities.
          score +=
            kind === 'poi' || kind === 'street' || type === 'suburb'
              ? 80 * Math.exp(-km / 15) + 15 * Math.exp(-km / 150)
              : MAJOR_PLACES.has(type)
                ? 15 * Math.exp(-km / 50)
                : 40 * Math.exp(-km / 15) + 10 * Math.exp(-km / 150);
        }
        hits.push(this.hit(index, score));
      }
    }
    hits.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
    const kept: SearchHit[] = [];
    for (const hit of hits) {
      if (kept.length >= options.limit) break;
      // The same name close by is one place: a city and its canton or parish, or a
      // landmark listed by two sources.
      const area = hit.kind === 'admin' || hit.kind === 'place' ? 0.2 : 0.003;
      const duplicate = kept.some(
        (other) =>
          fold(other.name) === fold(hit.name) &&
          (other.kind === 'admin' || other.kind === 'place') ===
            (hit.kind === 'admin' || hit.kind === 'place') &&
          Math.abs(other.lon - hit.lon) < area &&
          Math.abs(other.lat - hit.lat) < area,
      );
      if (!duplicate) kept.push(hit);
    }
    return kept;
  }

  /** Street entries whose name matches the text (for intersections). */
  streets(text: string, options: SearchOptions): SearchHit[] {
    return this.search(text, { ...options, kinds: ['street'] });
  }

  /** Nearest point of interest or place within `meters`. */
  nearest(
    lon: number,
    lat: number,
    meters: number,
    accept?: (hit: SearchHit) => boolean,
  ): SearchHit | null {
    const kx = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    const span = Math.ceil(meters / (GRID * METERS_PER_DEGREE)) + 1;
    const cx = Math.floor(lon / GRID);
    const cy = Math.floor(lat / GRID);
    let best: { index: number; distance: number } | null = null;
    for (let dx = -span; dx <= span; dx += 1) {
      for (let dy = -span; dy <= span; dy += 1) {
        for (const index of this.grid.get(key(cx + dx, cy + dy)) ?? []) {
          const distance = Math.hypot(
            (this.lon[index] - lon) * kx,
            (this.lat[index] - lat) * METERS_PER_DEGREE,
          );
          if (distance > meters || (best && distance >= best.distance)) continue;
          if (accept && !accept(this.hit(index, 0))) continue;
          best = { index, distance };
        }
      }
    }
    return best ? this.hit(best.index, 0) : null;
  }

  private hit(index: number, score: number): SearchHit {
    const box = this.boxes.subarray(index * 4, index * 4 + 4);
    return {
      index,
      name: this.names[index],
      detail: this.details[index],
      kind: KINDS[this.kinds[index]],
      type: this.types[index],
      category: this.categories[index],
      lon: this.lon[index],
      lat: this.lat[index],
      bbox: Number.isNaN(box[0]) ? null : [box[0], box[1], box[2], box[3]],
      parish: this.parishes[index],
      score,
    };
  }
}

interface Postings {
  /** Entries of each word. */
  lists: Map<string, Int32Array>;
  /** The words, sorted (for the words starting with a prefix). */
  vocabulary: string[];
}

const postingsOf = (lists: Map<string, number[]>): Postings => {
  const typed = new Map([...lists].map(([token, list]) => [token, Int32Array.from(list)]));
  return { lists: typed, vocabulary: [...typed.keys()].sort() };
};

/** Lists of the entries with the word (or a word starting with it). */
function lookup(postings: Postings, word: string, prefix: boolean): Int32Array[] {
  const lists: Int32Array[] = [];
  for (const variant of variants(word)) {
    const exact = postings.lists.get(variant);
    if (exact) lists.push(exact);
  }
  if (prefix) {
    const { vocabulary } = postings;
    let low = 0;
    let high = vocabulary.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (vocabulary[middle] < word) low = middle + 1;
      else high = middle;
    }
    let taken = 0;
    for (let i = low; i < vocabulary.length && vocabulary[i].startsWith(word); i += 1) {
      if (vocabulary[i] === word) continue;
      lists.push(postings.lists.get(vocabulary[i])!);
      if (++taken >= 400) break;
    }
  }
  return lists;
}

/** Singular forms of a Spanish plural, so "hospitales" also finds "hospital". */
function variants(word: string): string[] {
  const out = [word];
  if (word.length > 4 && word.endsWith('es')) out.push(word.slice(0, -2));
  if (word.length > 3 && word.endsWith('s')) out.push(word.slice(0, -1));
  return out;
}

function matches(
  word: string,
  matcher: { word: string; prefix: boolean; variants: string[] },
): boolean {
  if (matcher.variants.includes(word)) return true;
  return matcher.prefix && word.startsWith(matcher.word);
}

const GRID = 0.002;
const key = (cx: number, cy: number) => (cy + 100_000) * 400_000 + (cx + 200_000);
const gridKey = (lon: number, lat: number) => key(Math.floor(lon / GRID), Math.floor(lat / GRID));

/** Junctions where two named streets meet ("Av. 9 de Octubre y Boyacá"). */
export function intersections(
  graph: NativeGraph,
  first: string,
  second: string,
): { lon: number; lat: number; edge: number }[] {
  const a = graph.nameId(first);
  const b = graph.nameId(second);
  if (a === undefined || b === undefined || a === b) return [];
  const nodes = new Map<number, number>();
  for (const edge of graph.edgesNamed(a)) {
    nodes.set(graph.edgeU[edge], edge);
    nodes.set(graph.edgeV[edge], edge);
  }
  const found: { lon: number; lat: number; edge: number }[] = [];
  const seen = new Set<number>();
  for (const edge of graph.edgesNamed(b)) {
    for (const node of [graph.edgeU[edge], graph.edgeV[edge]]) {
      if (nodes.has(node) && !seen.has(node)) {
        seen.add(node);
        found.push({ lon: graph.nodeLon[node], lat: graph.nodeLat[node], edge });
      }
    }
  }
  return found;
}
