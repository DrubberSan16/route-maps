import { RoutingProfile } from '../../modules/routing/domain/value-objects/routing-profile';

/**
 * Questions asked to the server's engines and to the device engine on the fixture city
 * (fixture-city.ts): their answers must be the same. Points are [longitude, latitude].
 */

export interface RouteQuery {
  name: string;
  profile: RoutingProfile;
  /** Origin, waypoints and destination. */
  stops: [number, number][];
  alternatives: number;
  language: string;
}

export interface SearchQuery {
  text: string;
  near?: [number, number];
  limit: number;
}

const LON0 = -79.89;
const LAT0 = -2.185;
const STEP = 0.001;

/** A point near the crossing of grid column `col` and row `row` (rows go south). */
const at = (col: number, row: number, dLon = 0, dLat = 0): [number, number] => [
  Number((LON0 + col * STEP + dLon).toFixed(7)),
  Number((LAT0 - row * STEP + dLat).toFixed(7)),
];

const DOWNTOWN = at(3, 3);
const DURAN: [number, number] = [-79.834, -2.197];

export const ROUTE_QUERIES: RouteQuery[] = [
  {
    name: 'downtown by car, with alternatives',
    profile: 'CAR',
    stops: [at(0, 0, 0.00003, -0.00012), at(6, 6, 0.00015, 0.00002)],
    alternatives: 2,
    language: 'es-ES',
  },
  {
    name: 'downtown to Durán through the roundabout and the E40',
    profile: 'CAR',
    stops: [at(2, 4, 0.0004, 0.00003), [-79.8336, -2.1961]],
    alternatives: 2,
    language: 'es-ES',
  },
  {
    name: 'the same trip in English',
    profile: 'CAR',
    stops: [at(2, 4, 0.0004, 0.00003), [-79.8336, -2.1961]],
    alternatives: 0,
    language: 'en',
  },
  {
    name: 'to the village over the approximate link',
    profile: 'CAR',
    stops: [
      [-79.8345, -2.1965],
      [-79.8187, -2.2059],
    ],
    alternatives: 1,
    language: 'es-ES',
  },
  {
    name: 'to the village in English',
    profile: 'MOTORCYCLE',
    stops: [
      [-79.8345, -2.1965],
      [-79.8187, -2.2059],
    ],
    alternatives: 0,
    language: 'en-US',
  },
  {
    name: 'out of the roundabout to the north',
    profile: 'CAR',
    stops: [at(5, 2, 0.0002, 0.00004), [-79.8792, -2.1834]],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'walking along the pedestrian street',
    profile: 'PEDESTRIAN',
    stops: [at(5, 1, 0.00004, -0.0003), at(5, 5, -0.00003, 0.0002)],
    alternatives: 1,
    language: 'es-ES',
  },
  {
    name: 'walking up the steps to the lighthouse',
    profile: 'PEDESTRIAN',
    stops: [at(7, 2, 0.00002, 0.0003), [-79.8832, -2.1834]],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'cycling to the lighthouse (no steps)',
    profile: 'BICYCLE',
    stops: [at(7, 2, 0.00002, 0.0003), [-79.8832, -2.1834]],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'driving to the lighthouse by the service lane',
    profile: 'CAR',
    stops: [at(4, 1, 0.0003, 0.00004), [-79.8832, -2.1834]],
    alternatives: 0,
    language: 'en',
  },
  {
    name: 'truck from the unpaved track',
    profile: 'TRUCK',
    stops: [[-79.8965, -2.1883], at(4, 7, 0.0005, -0.00005)],
    alternatives: 2,
    language: 'es-ES',
  },
  {
    name: 'bicycle through the tunnel',
    profile: 'BICYCLE',
    stops: [[-79.8941, -2.1795], at(3, 6, 0.0002, 0.00003)],
    alternatives: 1,
    language: 'es-ES',
  },
  {
    name: 'stops along the way',
    profile: 'CAR',
    stops: [at(0, 7, 0.0003, 0.00004), at(4, 3, 0.00003, 0.0002), at(7, 0, -0.0004, -0.00003)],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'stops in English, walking',
    profile: 'PEDESTRIAN',
    stops: [at(1, 1, 0.0002, 0.00003), at(5, 3, 0.00002, 0.0004), at(6, 6, 0.0003, -0.00002)],
    alternatives: 0,
    language: 'en',
  },
  {
    name: 'start and end on the same block',
    profile: 'CAR',
    stops: [at(2, 6, 0.0001, 0.00004), at(2, 6, 0.0008, -0.00003)],
    alternatives: 2,
    language: 'es-ES',
  },
  {
    name: 'backwards on the same block',
    profile: 'PEDESTRIAN',
    stops: [at(2, 6, 0.0008, -0.00003), at(2, 6, 0.0001, 0.00004)],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'to the island: the nearest mainland road',
    profile: 'CAR',
    stops: [DOWNTOWN, [-79.8845, -2.2201]],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'on the island on foot',
    profile: 'PEDESTRIAN',
    stops: [
      [-79.8858, -2.2199],
      [-79.8829, -2.2213],
    ],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'destination far from any road',
    profile: 'CAR',
    stops: [DOWNTOWN, [-79.4, -2.6]],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'origin far from any road',
    profile: 'PEDESTRIAN',
    stops: [[-80.3, -1.8], DOWNTOWN],
    alternatives: 0,
    language: 'es-ES',
  },
  {
    name: 'motorcycle across downtown with alternatives',
    profile: 'MOTORCYCLE',
    stops: [at(1, 7, 0.0002, 0.00003), at(6, 0, 0.0004, -0.00002)],
    alternatives: 2,
    language: 'es-ES',
  },
];

export const SEARCH_QUERIES: SearchQuery[] = [
  { text: 'malecon', near: DOWNTOWN, limit: 10 },
  { text: 'Malecón 2000', limit: 10 },
  { text: 'hospital', near: DOWNTOWN, limit: 10 },
  { text: 'hospitales', limit: 10 },
  { text: 'hosp', near: DURAN, limit: 10 },
  { text: 'parque de las iguanas', limit: 10 },
  { text: 'iguanas', near: DOWNTOWN, limit: 10 },
  { text: 'guayaquil', limit: 10 },
  { text: 'guayaquil', near: DURAN, limit: 10 },
  { text: 'duran', limit: 10 },
  { text: 'el paraiso', near: DURAN, limit: 10 },
  { text: '9 de octubre y boyaca', near: DOWNTOWN, limit: 10 },
  { text: 'Boyacá esquina Av. 9 de Octubre', limit: 10 },
  { text: 'chimborazo & luque', near: DOWNTOWN, limit: 10 },
  { text: 'pedro moncayo con ballen', limit: 5 },
  { text: 'sucre y rocafuerte', near: DURAN, limit: 10 },
  { text: 'rocafuerte', near: DOWNTOWN, limit: 10 },
  { text: 'calle rocafuerte duran', limit: 10 },
  { text: 'mercado', near: DOWNTOWN, limit: 10 },
  { text: 'maac', limit: 10 },
  { text: 'av quito', near: DOWNTOWN, limit: 10 },
  { text: 'de la', limit: 10 },
  { text: 'xyz', limit: 10 },
  { text: 'bolivar', near: DOWNTOWN, limit: 10 },
  { text: 'bolivar', near: DURAN, limit: 10 },
  { text: 'terminal', near: DURAN, limit: 10 },
  { text: 'unidad educativa', limit: 10 },
  { text: 'C. Boyacá', limit: 10 },
  { text: 'gasolinera', near: DOWNTOWN, limit: 10 },
  { text: 'urdesa', limit: 10 },
  { text: 'las peñas', limit: 10 },
  { text: 'catedral metropolitana guayaquil', limit: 10 },
  { text: '  hospital   luis  ', limit: 10 },
  { text: 'avenida nueve', near: DOWNTOWN, limit: 3 },
  { text: 'sendero', limit: 10 },
  { text: 'calle', near: DOWNTOWN, limit: 10 },
  { text: 'c', limit: 10 },
  { text: 'faro', near: DOWNTOWN, limit: 10 },
  { text: 'ÁGUIRRE', limit: 10 },
  { text: 'vía durán tambo', limit: 10 },
  { text: 'guayas', near: DURAN, limit: 2 },
];

/** Points tapped on the map. */
export const REVERSE_QUERIES: [number, number][] = [
  at(1, 2, 0.0005, 0.00003),
  at(6, 1, 0.00021, -0.00028),
  at(5, 3, 0.00002, 0.0004),
  at(2, 1, 0.0005, -0.0001),
  [-79.8838, -2.2208],
  [-79.875, -2.1955],
  [-79.8332, -2.1981],
  [-79.8186, -2.2058],
  [-79.86, -2.191],
  [-79.85, -2.15],
  [-79.2, -2.9],
  at(7, 0, -0.0002, 0.0016),
];

/** Texts folded like the server does before matching them. */
export const FOLD_CASES: string[] = [
  'Malecón Simón-Bolívar',
  'ÁÉÍÓÚ áéíóú Üü Ññ',
  'Çà ìõ Ŷ ǅ',
  'Straße Æsir Øre',
  'İstanbul',
  'áè combining',
  '  9 de Octubre  &  Boyacá ',
  'Ｆｕｌｌｗｉｄｔｈ ① ²',
  'Ελλάδα и Россия',
  '😀 emoji 😀',
  '',
];
