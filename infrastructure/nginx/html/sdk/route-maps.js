/**
 * Route Maps browser SDK.
 *
 * This module, the renderer and the PMTiles reader are all served by the same
 * Route Maps installation. An integrating application does not need a CDN or
 * an account with a third-party map provider.
 */
import * as maplibregl from '../vendor/maplibre-gl.mjs';
import { registerPoiIcons } from './map-icons.js';
import {
  buildStyle, currentMapType, mapTypes, parseTemplate, setMapType, setOverlay, TrafficLayer, WORLD_REGION,
} from './map-style.js';

const SDK_URL = new URL(import.meta.url);
const DEFAULT_BASE_URL = SDK_URL.origin;
let protocolReady;

export class RouteMapsError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'RouteMapsError';
    this.code = code;
    this.status = status;
  }
}

function baseUrl(value) {
  return new URL(value || DEFAULT_BASE_URL, window.location.href).origin;
}

function loadStylesheet(href) {
  if (document.querySelector(`link[data-route-maps-sdk="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.routeMapsSdk = href;
  document.head.append(link);
}

function loadScript(src) {
  const existing = document.querySelector(`script[data-route-maps-sdk="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      if (window.pmtiles) resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.routeMapsSdk = src;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), {
      once: true,
    });
    document.head.append(script);
  });
}

async function ensureRuntime(origin) {
  loadStylesheet(`${origin}/vendor/maplibre-gl.css`);
  if (!protocolReady) {
    protocolReady = (async () => {
      if (!window.pmtiles) await loadScript(`${origin}/vendor/pmtiles.js`);
      const protocol = new window.pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
    })();
  }
  await protocolReady;
}

async function request(origin, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${origin}/api/v1${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const error = body?.error;
    throw new RouteMapsError(
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `La plataforma respondió HTTP ${response.status}`,
      response.status,
    );
  }
  return body.data;
}

const bounds = ([minLng, minLat, maxLng, maxLat]) => [
  [minLng, minLat],
  [maxLng, maxLat],
];

function selectTilesets(regions, selectedRegion) {
  const world = regions.find((region) => region.id === WORLD_REGION);
  if (!selectedRegion || selectedRegion === WORLD_REGION) return world ? [{ region: world, isWorld: true }] : [];
  const selected = regions.find((region) => region.id === selectedRegion);
  if (!selected) throw new RouteMapsError('MAP_REGION_NOT_FOUND', `No existe la región ${selectedRegion}`);
  return [...(world ? [{ region: world, isWorld: true }] : []), { region: selected, isWorld: false }];
}

/** Returns the currently published map regions. */
export function getRegions(options = {}) {
  return request(baseUrl(options.baseUrl), '/maps/regions');
}

/** Search addresses, places, countries and cities through this installation. */
export function searchPlaces(query, options = {}) {
  const params = new URLSearchParams({ q: query });
  if (options.limit) params.set('limit', String(options.limit));
  if (options.language) params.set('lang', options.language);
  if (options.near) {
    params.set('lat', String(options.near.latitude));
    params.set('lng', String(options.near.longitude));
  }
  return request(baseUrl(options.baseUrl), `/geocoding/search?${params}`);
}

/** Calculate a route. Coordinates use { latitude, longitude }. */
export function calculateRoute(input, options = {}) {
  return request(baseUrl(options.baseUrl), '/routes/calculate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Absolute, resumable download URL for a region's offline PMTiles archive. */
export function offlineMapUrl(regionId, options = {}) {
  return `${baseUrl(options.baseUrl)}/api/v1/maps/regions/${encodeURIComponent(regionId)}/download`;
}

/**
 * Creates an interactive map from this installation.
 *
 * Required: { container } (element or element id).
 * Optional: baseUrl, region (default: ecuador), center [lng, lat], zoom,
 * minZoom, maxZoom, navigationControl, mapType ('map', 'satellite' or
 * 'relief') and traffic (true to start with traffic shown).
 */
export async function createMap(options) {
  if (!options?.container) throw new TypeError('createMap requires a container');
  const origin = baseUrl(options.baseUrl);
  await ensureRuntime(origin);
  const [regions, templateText] = await Promise.all([
    request(origin, '/maps/regions'),
    fetch(`${origin}/maps/style/style.json`).then((response) => {
      if (!response.ok) throw new RouteMapsError('STYLE_UNAVAILABLE', 'No se pudo cargar el estilo', response.status);
      return response.text();
    }),
  ]);
  const selected = options.region ?? 'ecuador';
  const sets = selectTilesets(regions, selected);
  if (sets.length === 0) throw new RouteMapsError('NO_MAPS_AVAILABLE', 'No hay mapas publicados');
  const detailed = [...sets].reverse().find((set) => !set.isWorld)?.region;
  const home = detailed?.bbox ?? sets[0].region.bbox;
  const template = parseTemplate(templateText, origin);
  const drawnRegions = sets.map((set) => set.region);
  const map = new maplibregl.Map({
    container: options.container,
    style: buildStyle(template, origin, sets),
    ...(options.center ? { center: options.center, zoom: options.zoom ?? 11 } : { bounds: bounds(home) }),
    minZoom: options.minZoom,
    maxZoom: options.maxZoom,
    // Satellite imagery and elevation carry the citation their licences ask for.
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  registerPoiIcons(map, template.metadata?.['maps-platform:poi-colors'] ?? {});
  if (options.navigationControl !== false) {
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  }
  const traffic = new TrafficLayer(map, template, {
    fetchFlow: (bbox) => request(origin, `/traffic/flow?bbox=${bbox}`),
    onStatus: options.onTrafficStatus,
  });
  // Changes asked for before the style loads are applied once it has.
  const pending = { mapType: options.mapType ?? 'map', traffic: Boolean(options.traffic), overlays: new Map() };
  map.once('load', () => {
    traffic.install();
    setMapType(map, template, drawnRegions, origin, pending.mapType);
    if (pending.traffic) traffic.setVisible(true);
    for (const [kind, visible] of pending.overlays) setOverlay(map, template, kind, visible);
  });
  return {
    map,
    regions,
    /** Map types of this installation: [{ id, label, available }]. */
    mapTypes: mapTypes(template, drawnRegions),
    /**
     * Shows 'map', 'satellite' or 'relief'. Returns false (and keeps the plain map) when the
     * region has no imagery or elevation published.
     */
    setMapType: (type) => {
      pending.mapType = type;
      if (!map.isStyleLoaded()) return mapTypes(template, drawnRegions).some((item) => item.id === type && item.available);
      return setMapType(map, template, drawnRegions, origin, type);
    },
    /** The map type shown. */
    getMapType: () => currentMapType(map),
    /** Shows or hides traffic: main roads in green without reported delays, measured segments on top. */
    setTraffic: (visible) => {
      pending.traffic = Boolean(visible);
      if (map.isStyleLoaded()) traffic.setVisible(Boolean(visible));
    },
    /** Shows or hides a map overlay: 'precipitation', 'temperature' or 'population'. */
    setOverlay: (kind, visible) => {
      pending.overlays.set(kind, visible);
      if (map.isStyleLoaded()) setOverlay(map, template, kind, visible);
    },
    calculateRoute: (input) => calculateRoute(input, { baseUrl: origin }),
    searchPlaces: (query, searchOptions = {}) =>
      searchPlaces(query, { ...searchOptions, baseUrl: origin }),
    offlineMapUrl: (regionId) => offlineMapUrl(regionId, { baseUrl: origin }),
  };
}

export const RouteMaps = {
  createMap,
  getRegions,
  searchPlaces,
  calculateRoute,
  offlineMapUrl,
};
