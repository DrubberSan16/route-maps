/**
 * The platform's map style in the browser, shared by the viewer and the SDK: builds the MapLibre
 * style from the template (/maps/style/style.json) and the published regions, switches the map
 * type ("Mapa", "Satélite", "Relieve") and draws the traffic. Tiles, imagery, elevation and traffic
 * all come from this installation.
 */

export const WORLD_REGION = 'world';
/** The world base map has tiles up to zoom 7 and is drawn up to here; regions add the detail. */
export const WORLD_MAX_VISIBLE_ZOOM = 8;
/** Measured traffic is requested for city-sized views only (GET /traffic/flow takes 2.5 degrees). */
const TRAFFIC_MIN_ZOOM = 10;
const TRAFFIC_MAX_SPAN = 2.5;
const TRAFFIC_REFRESH_MS = 60_000;
const TRAFFIC_DEBOUNCE_MS = 400;
const TRAFFIC_SOURCE = 'traffic-flow';
const OVERLAYS = 'overlays';
const EMPTY = { type: 'FeatureCollection', features: [] };

export const area = ([minLng, minLat, maxLng, maxLat]) => (maxLng - minLng) * (maxLat - minLat);
export const containsBox = (outer, inner) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

/** Id of the template layer a style layer was copied from ("ecuador/road" -> "road"). */
export const templateId = (id) => id.slice(id.lastIndexOf('/') + 1);

/**
 * Loader of pmtiles:// URLs for maplibregl.addProtocol, built on the pmtiles library (its global
 * build). Chromium's HTTP cache can answer a Range request with only the part of it that an
 * overlapping request just stored, which happens as the map loads many tiles at once; the tile then
 * fails to decompress and stays empty, and the library keeps that failure for the whole directory.
 * So a range that comes back incomplete, or fails on the network, is read again past the cache.
 */
export function pmtilesLoader(library, { attempts = 3, delayMs = 40 } = {}) {
  const protocol = new library.Protocol();
  class CheckedSource {
    constructor(url) {
      this.source = new library.FetchSource(url);
      this.uncached = new library.FetchSource(url);
      this.uncached.chromeWindowsNoCache = true; // the library's switch for fetch(..., { cache: 'no-store' })
    }

    getKey() {
      return this.source.getKey();
    }

    async getBytes(offset, length, signal, etag) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const result = await (attempt === 1 ? this.source : this.uncached).getBytes(offset, length, signal, etag);
          // Only the first read (the header, 16 KiB) may pass the end of a small archive.
          if (offset > 0 && result.data.byteLength < length) throw new TypeError('Incomplete range');
          return result;
        } catch (error) {
          // fetch() rejects with a TypeError on network errors; anything else (HTTP error, abort) is final.
          if (!(error instanceof TypeError) || attempt >= attempts || signal?.aborted) throw error;
          await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        }
      }
    }
  }
  return (params, abortController) => {
    // pmtiles://<archive URL> (TileJSON) or pmtiles://<archive URL>/<z>/<x>/<y>, as the library reads them.
    const url = params.type === 'json'
      ? params.url.slice('pmtiles://'.length)
      : params.url.match(/^pmtiles:\/\/(.+)\/\d+\/\d+\/\d+$/)?.[1];
    if (url && !protocol.get(url)) protocol.add(new library.PMTiles(new CheckedSource(url)));
    return protocol.tile(params, abortController);
  };
}

const assetOf = (region, kind) => region.assets?.find((asset) => asset.kind === kind) ?? null;
const widestFirst = (regions) => [...regions].sort((a, b) => area(b.bbox) - area(a.bbox));

/** Widest first, without the regions that lie inside a bigger one of the list. */
function outermost(regions) {
  const sorted = widestFirst(regions);
  return sorted.filter((region, index) =>
    !sorted.slice(0, index).some((bigger) => containsBox(bigger.bbox, region.bbox)));
}

/** The world base map, the detailed regions (widest first) and those drawn (not inside another). */
export function tilesets(regions) {
  const world = regions.find((region) => region.id === WORLD_REGION) ?? null;
  const detailed = widestFirst(regions.filter((region) => region.id !== WORLD_REGION && region.bbox));
  return { world, detailed, drawn: outermost(detailed) };
}

/** The style template with its glyphs read from this installation. */
export function parseTemplate(text, origin) {
  return JSON.parse(text.replaceAll('__GLYPHS_URL__', `${origin}/maps/fonts`));
}

/**
 * One copy of every template layer per tileset ({ region, isWorld }), the copies of a layer next to
 * each other, so that the regions cover the world base map and labels stay above every fill. The
 * overlays read the region's own archive (only while one is shown), or its map for maps built
 * before the overlays had their own archive.
 */
export function buildStyle(template, origin, sets) {
  const base = template.sources.basemap ?? Object.values(template.sources)[0];
  const style = { ...template, sources: {}, layers: [] };
  const overlaySource = new Map();
  for (const { region, isWorld } of sets) {
    style.sources[region.id] = {
      ...base,
      url: `pmtiles://${origin}${region.tilesUrl}`,
      attribution: isWorld ? '' : base.attribution,
    };
    const overlays = assetOf(region, OVERLAYS);
    if (overlays) {
      const id = `${region.id}:${OVERLAYS}`;
      style.sources[id] = { type: 'vector', url: `pmtiles://${origin}${overlays.tilesUrl}`, attribution: '' };
      overlaySource.set(region.id, id);
    }
  }
  for (const layer of template.layers) {
    if (!layer.source) {
      style.layers.push(layer);
      continue;
    }
    for (const { region, isWorld } of sets) {
      if (isWorld && ((layer.minzoom ?? 0) >= WORLD_MAX_VISIBLE_ZOOM || layer.source === OVERLAYS)) continue;
      const source = layer.source === OVERLAYS ? overlaySource.get(region.id) ?? region.id : region.id;
      const copy = { ...layer, id: `${region.id}/${layer.id}`, source };
      if (isWorld) copy.maxzoom = Math.min(layer.maxzoom ?? 24, WORLD_MAX_VISIBLE_ZOOM);
      style.layers.push(copy);
    }
  }
  return style;
}

// ---------------------------------------------------------------- map types

/** Map types of the template (map, satellite, relief) and whether a region has their data. */
export function mapTypes(template, regions) {
  const types = template.metadata?.['maps-platform:map-types'] ?? { map: { label: 'Mapa' } };
  return Object.entries(types).map(([id, spec]) => ({
    id,
    label: spec.label ?? id,
    available: !spec.asset || regions.some((region) => region.bbox && assetOf(region, spec.asset)),
  }));
}

/** First style layer copied from template layer `name` or, if it has none, from a later one. */
function firstLayerFrom(map, template, name) {
  const order = template.layers.map((layer) => layer.id);
  const start = order.indexOf(name);
  if (start < 0) return undefined;
  const wanted = new Set(order.slice(start));
  return map.getStyle().layers.find((layer) => layer.id.includes('/') && wanted.has(templateId(layer.id)))?.id;
}

const typeState = new WeakMap();

/** Map type shown by setMapType ('map' until another one is set). */
export const currentMapType = (map) => typeState.get(map)?.type ?? 'map';

/**
 * Shows a map type on a map made with buildStyle, undoing the previous one: adds the raster source
 * and layers of every region with the data (all of them for imagery, the most detailed on top; the
 * outermost ones for elevation, so that nothing is shaded twice) and hides or restyles the base
 * layers. Returns false, leaving the plain map, when no region has the data.
 */
export function setMapType(map, template, regions, origin, type) {
  const state = typeState.get(map) ?? { type: 'map', layers: [], sources: [], restore: [] };
  typeState.set(map, state);
  for (const id of state.layers) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of state.sources) if (map.getSource(id)) map.removeSource(id);
  for (const { id, kind, name, value } of state.restore.reverse()) {
    if (!map.getLayer(id)) continue;
    if (kind === 'layout') map.setLayoutProperty(id, name, value);
    else map.setPaintProperty(id, name, value);
  }
  Object.assign(state, { type: 'map', layers: [], sources: [], restore: [] });
  if (type === 'map') return true;

  const spec = template.metadata?.['maps-platform:map-types']?.[type];
  if (!spec) return false;
  const withData = regions.filter((region) => region.bbox && assetOf(region, spec.asset));
  const regionsDrawn = spec.source?.type === 'raster' ? widestFirst(withData) : outermost(withData);
  if (spec.asset && regionsDrawn.length === 0) return false;

  for (const { before, ...layer } of spec.layers ?? []) {
    const beforeId = firstLayerFrom(map, template, before);
    for (const region of regionsDrawn) {
      const source = `${region.id}:${spec.asset}`;
      if (!map.getSource(source)) {
        map.addSource(source, { ...spec.source, url: `pmtiles://${origin}${assetOf(region, spec.asset).tilesUrl}` });
        state.sources.push(source);
      }
      const id = `${region.id}/${layer.id}`;
      map.addLayer({ ...layer, id, source }, beforeId);
      state.layers.push(id);
    }
  }
  const hide = new Set(spec.hide ?? []);
  for (const { id } of map.getStyle().layers) {
    if (!id.includes('/')) continue; // added by the application
    const name = templateId(id);
    if (hide.has(name)) {
      state.restore.push({ id, kind: 'layout', name: 'visibility', value: map.getLayoutProperty(id, 'visibility') ?? 'visible' });
      map.setLayoutProperty(id, 'visibility', 'none');
    }
    for (const [property, value] of Object.entries(spec.paint?.[name] ?? {})) {
      state.restore.push({ id, kind: 'paint', name: property, value: map.getPaintProperty(id, property) });
      map.setPaintProperty(id, property, value);
    }
  }
  state.type = type;
  return true;
}

/** Shows or hides an overlay of the template ('precipitation', 'temperature' or 'population'). */
export function setOverlay(map, template, kind, visible) {
  const names = new Set(template.metadata?.['maps-platform:overlays']?.[kind] ?? []);
  for (const { id } of map.getStyle().layers) {
    if (id.includes('/') && names.has(templateId(id))) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

// ---------------------------------------------------------------- traffic

/** Outward to a 0.01 degree grid: nearby views share the request (and the server cache). */
const gridBox = (bounds) => [
  Math.floor(bounds.getWest() * 100) / 100, Math.floor(bounds.getSouth() * 100) / 100,
  Math.ceil(bounds.getEast() * 100) / 100, Math.ceil(bounds.getNorth() * 100) / 100,
].map((value) => value.toFixed(2)).join(',');

/**
 * Traffic on a map made with buildStyle: the main roads in green (no delays reported) and, for
 * city-sized views, the segments measured by the platform's own trips on top (GET /traffic/flow),
 * live or usual for the hour, refreshed every minute while shown.
 *
 * fetchFlow(bbox) returns the flow of "minLng,minLat,maxLng,maxLat"; onStatus(text) receives a
 * short description of what is shown ('' when hidden).
 */
export class TrafficLayer {
  constructor(map, template, { fetchFlow, onStatus = () => {} }) {
    this.map = map;
    this.spec = template.metadata?.['maps-platform:traffic'] ?? { network: [], layers: [] };
    this.fetchFlow = fetchFlow;
    this.onStatus = onStatus;
    this.visible = false;
    this.request = 0;
    this.lastBox = '';
    this.lastFetch = 0;
    this.timer = 0;
    this.debounce = 0;
    this.onMove = () => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.refresh(), TRAFFIC_DEBOUNCE_MS);
    };
  }

  /** Adds the (empty) measured segments under the labels; call once the style is loaded. */
  install() {
    if (this.map.getSource(TRAFFIC_SOURCE)) return;
    this.map.addSource(TRAFFIC_SOURCE, { type: 'geojson', data: EMPTY });
    const firstLabel = this.map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    for (const layer of this.spec.layers) {
      this.map.addLayer({
        ...layer, source: TRAFFIC_SOURCE, layout: { ...layer.layout, visibility: this.visible ? 'visible' : 'none' },
      }, firstLabel);
    }
  }

  setVisible(visible) {
    this.visible = visible;
    this.install();
    const network = new Set(this.spec.network);
    const ids = [
      ...this.map.getStyle().layers.map((layer) => layer.id)
        .filter((id) => id.includes('/') && network.has(templateId(id))),
      ...this.spec.layers.map((layer) => layer.id),
    ];
    for (const id of ids) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.map.off('moveend', this.onMove);
    if (!visible) {
      this.request++;
      this.onStatus('');
      return;
    }
    this.map.on('moveend', this.onMove);
    this.timer = setInterval(() => {
      if (!document.hidden) this.refresh({ force: true });
    }, TRAFFIC_REFRESH_MS);
    this.refresh({ force: true });
  }

  async refresh({ force = false } = {}) {
    if (!this.visible) return;
    const bounds = this.map.getBounds();
    const span = Math.max(bounds.getEast() - bounds.getWest(), bounds.getNorth() - bounds.getSouth());
    if (this.map.getZoom() < TRAFFIC_MIN_ZOOM || span > TRAFFIC_MAX_SPAN) {
      this.request++;
      this.lastBox = '';
      this.map.getSource(TRAFFIC_SOURCE)?.setData(EMPTY);
      this.onStatus('Las vías principales en verde no tienen demoras reportadas. Acércate a una ciudad ' +
        'para ver los tramos medidos.');
      return;
    }
    const box = gridBox(bounds);
    if (!force && box === this.lastBox && Date.now() - this.lastFetch < TRAFFIC_REFRESH_MS) return;
    const request = ++this.request;
    try {
      const flow = await this.fetchFlow(box);
      if (request !== this.request || !this.visible) return;
      this.lastBox = box;
      this.lastFetch = Date.now();
      this.map.getSource(TRAFFIC_SOURCE)?.setData(flow);
      this.onStatus(describeFlow(flow));
    } catch (error) {
      if (request === this.request) this.onStatus(error.message);
    }
  }
}

function describeFlow(flow) {
  const live = flow.features.filter((feature) => feature.properties.source !== 'typical').length;
  const typical = flow.features.length - live;
  if (flow.features.length === 0) {
    return 'Sin recorridos recientes ni habituales en esta zona: las vías en verde no tienen demoras reportadas.';
  }
  const parts = [];
  if (live) parts.push(`${live} en vivo (últimos ${flow.windowMinutes} min)`);
  if (typical) parts.push(`${typical} con lo habitual a esta hora (más tenues)`);
  return `Tramos medidos: ${parts.join(' y ')}. El resto de vías en verde no tiene demoras reportadas.`;
}
