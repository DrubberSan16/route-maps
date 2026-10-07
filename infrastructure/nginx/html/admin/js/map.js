// Maps of the panel (live fleet, tracks, geofences, places, routes) with the platform's own style
// and regions, drawn as in the viewer (sdk/map-style.js). MapLibre GL JS and PMTiles are served by
// this installation (/vendor) and load the first time a screen needs a map. The geometry helpers
// at the top are pure (tested in infrastructure/nginx/tests).

const EARTH_RADIUS_METERS = 6_371_008.8;
/** Mainland Ecuador: the first view when a region covers it. */
const HOME_BOUNDS = [-81.1, -5.05, -75.2, 1.5];

// ---------------------------------------------------------------- geometry (pure)

/** [minLng, minLat, maxLng, maxLat] of any GeoJSON object (or a list of them); null when empty. */
export function bboxOf(value) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      if (typeof node[0] === 'number') {
        box[0] = Math.min(box[0], node[0]);
        box[1] = Math.min(box[1], node[1]);
        box[2] = Math.max(box[2], node[0]);
        box[3] = Math.max(box[3], node[1]);
      } else {
        node.forEach(visit);
      }
      return;
    }
    if (node.type === 'FeatureCollection') node.features.forEach(visit);
    else if (node.type === 'Feature') visit(node.geometry);
    else if (node.type === 'GeometryCollection') node.geometries.forEach(visit);
    else if (node.coordinates) visit(node.coordinates);
  };
  visit(value);
  return Number.isFinite(box[0]) ? box : null;
}

/** Circle as a polygon of `steps` vertices (the API stores circles the same way, 64 vertices). */
export function circlePolygon({ latitude, longitude }, radiusMeters, steps = 64) {
  const lat = (latitude * Math.PI) / 180;
  const lng = (longitude * Math.PI) / 180;
  const angular = radiusMeters / EARTH_RADIUS_METERS;
  const ring = [];
  for (let index = 0; index < steps; index += 1) {
    const bearing = (index / steps) * 2 * Math.PI;
    const pointLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
    const pointLng = lng + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * Math.sin(pointLat));
    ring.push([round((pointLng * 180) / Math.PI), round((pointLat * 180) / Math.PI)]);
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

const round = (value) => Math.round(value * 1e7) / 1e7;

/** Polygon from the vertices drawn ([lng, lat] each), closed; null with fewer than 3 vertices. */
export function polygonFrom(vertices) {
  if (vertices.length < 3) return null;
  const ring = vertices.map(([x, y]) => [round(x), round(y)]);
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}

/** Distance in meters between two [lng, lat] positions (haversine). */
export function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const point = (longitude, latitude, properties = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
  properties,
});

export const collection = (features) => ({ type: 'FeatureCollection', features });

// ---------------------------------------------------------------- MapLibre

export class MapUnavailableError extends Error {
  constructor(reason) {
    super(reason === 'no-regions' ? 'No regions published' : 'Map could not be loaded');
    this.reason = reason;
  }
}

let library = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', resolve);
    script.addEventListener('error', () => reject(new MapUnavailableError('library')));
    document.head.append(script);
  });
}

/** MapLibre, the style template and the published regions, loaded once. */
function mapLibrary() {
  library ??= (async () => {
    const [maplibregl, styleModule, icons, , regions, styleText] = await Promise.all([
      import('/vendor/maplibre-gl.mjs'),
      import('/sdk/map-style.js'),
      import('/sdk/map-icons.js'),
      globalThis.pmtiles ? null : loadScript('/vendor/pmtiles.js'),
      fetch('/api/v1/maps/regions').then((response) => response.json()).then((body) => body?.data ?? []),
      fetch('/maps/style/style.json').then((response) => {
        if (!response.ok) throw new MapUnavailableError('style');
        return response.text();
      }),
    ]);
    maplibregl.addProtocol('pmtiles', styleModule.pmtilesLoader(globalThis.pmtiles));
    return {
      maplibregl,
      styleModule,
      icons,
      regions,
      template: styleModule.parseTemplate(styleText, window.location.origin),
    };
  })();
  library.catch(() => {
    library = null; // the next screen tries again
  });
  return library;
}

/** Value of a colour token of admin.css (the map layers use the same palette as the page). */
export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * A map in `container` (which must have a size), resolved once its style has loaded.
 * Throws MapUnavailableError when the server has no published region yet.
 */
export async function createMap(container, { bounds, onClick } = {}) {
  let parts;
  try {
    parts = await mapLibrary();
  } catch (error) {
    throw error instanceof MapUnavailableError ? error : new MapUnavailableError('library');
  }
  const { maplibregl, styleModule, icons, regions, template } = parts;
  const { world, drawn } = styleModule.tilesets(regions);
  if (!world && drawn.length === 0) throw new MapUnavailableError('no-regions');
  const ecuador = drawn.find((region) => styleModule.containsBox(region.bbox, HOME_BOUNDS));
  const home = bounds ?? (ecuador ? HOME_BOUNDS : drawn[0]?.bbox ?? world?.bbox);
  const map = new maplibregl.Map({
    container,
    style: styleModule.buildStyle(template, window.location.origin, [
      ...(world ? [{ region: world, isWorld: true }] : []),
      ...drawn.map((region) => ({ region, isWorld: false })),
    ]),
    bounds: home ? [[home[0], home[1]], [home[2], home[3]]] : undefined,
    fitBoundsOptions: { padding: 32 },
    attributionControl: { compact: true, customAttribution: '<a href="/fuentes.html">Fuentes de datos</a>' },
    dragRotate: false,
    pitchWithRotate: false,
    cooperativeGestures: false,
  });
  map.touchZoomRotate.disableRotation();
  icons.registerPoiIcons(map, template.metadata?.['maps-platform:poi-colors'] ?? {});
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  if (onClick) map.on('click', onClick);
  await new Promise((resolve) => {
    if (map.loaded()) resolve();
    else map.once('load', resolve);
  });
  return { map, maplibregl };
}

/** Sets the data of a GeoJSON source, adding it the first time. */
export function setData(map, id, data) {
  const source = map.getSource(id);
  if (source) source.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

export function addLayers(map, layers) {
  for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
}

/** Moves the camera to show the geometry (no animation). */
export function fitTo(map, geometry, { padding = 48, maxZoom = 16 } = {}) {
  const box = bboxOf(geometry);
  if (!box) return;
  if (box[0] === box[2] && box[1] === box[3]) {
    map.jumpTo({ center: [box[0], box[1]], zoom: Math.min(maxZoom, 15) });
  } else {
    map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding, maxZoom, duration: 0 });
  }
}

/** Text for a map that cannot be shown. */
export function mapUnavailableText(error) {
  if (error?.reason === 'no-regions') {
    return 'No hay mapas publicados en este servidor. Prepara una región (make prepare-region REGION=ecuador) para ver el mapa aquí.';
  }
  return 'No se pudo cargar el mapa. Revisa la conexión con el servidor y vuelve a abrir esta pantalla.';
}
