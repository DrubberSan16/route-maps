// Map viewer of the platform: the world base map (Natural Earth) with the prepared regions on top
// (PMTiles, own style), place search (GET /geocoding/search) and routes with stops
// (POST /routes/calculate). No build step: MapLibre GL JS and PMTiles are vendored by the image.
import * as maplibregl from './vendor/maplibre-gl.mjs';

const API = '/api/v1';
const ORIGIN = window.location.origin;
const WORLD_REGION = 'world';
/** The world base map has tiles up to zoom 7 and is drawn up to here; regions add the detail. */
const WORLD_MAX_VISIBLE_ZOOM = 8;
/** Origin, up to 23 stops and destination: the limit of POST /routes/calculate. */
const MAX_POINTS = 25;
const SEARCH_MIN_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 7;
const MAP_POINT_LABEL = 'Punto en el mapa';
const SVG_NS = 'http://www.w3.org/2000/svg';
const NATURAL_EARTH_ATTRIBUTION =
  '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Made with Natural Earth</a>';

const PROFILES = [
  { id: 'CAR', label: 'Auto', icon: 'i-car' },
  { id: 'TRUCK', label: 'Camión', icon: 'i-truck' },
  { id: 'MOTORCYCLE', label: 'Moto', icon: 'i-moto' },
  { id: 'BICYCLE', label: 'Bici', icon: 'i-bike' },
  { id: 'PEDESTRIAN', label: 'A pie', icon: 'i-walk' },
];

const ERROR_MESSAGES = {
  ROUTE_NOT_FOUND:
    'No hay una ruta entre esos puntos. Deben estar en una zona con mapa detallado y cerca de una calle.',
  INVALID_COORDINATES: 'Revisa los puntos: no pueden coincidir ni estar a más de 2.000 km entre sí.',
  ROUTING_PROVIDER_UNAVAILABLE: 'El cálculo de rutas no está disponible ahora. Inténtalo en unos minutos.',
  ROUTING_PROFILE_NOT_SUPPORTED: 'Ese medio de transporte no está disponible.',
  GEOCODING_PROVIDER_UNAVAILABLE: 'La búsqueda no está disponible ahora. Puedes elegir los puntos en el mapa.',
  RATE_LIMIT_EXCEEDED: 'Demasiadas solicitudes seguidas. Espera un momento.',
  HTTP_429: 'Demasiadas solicitudes seguidas. Espera un momento.',
};

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const $ = (id) => document.getElementById(id);
const theme = getComputedStyle(document.documentElement);
const token = (name) => theme.getPropertyValue(name).trim();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const animation = (ms) => (reducedMotion.matches ? 0 : ms);
const canLocate = window.isSecureContext && 'geolocation' in navigator;

// ---------------------------------------------------------------- state

let map;
let regions = [];
let styleTemplate = '';
let profile = 'CAR';
let nextStopId = 1;
const newStop = () => ({ id: nextStopId++, point: null, label: '' });
let stops = [newStop(), newStop()];
let activeStopId = stops[0].id;
let routes = [];
let selectedRoute = 0;
let routeRequest = 0;
let place = null;
let placeMarker = null;
const stopMarkers = new Map();
const searchCache = new Map();

// ---------------------------------------------------------------- helpers

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const error = body?.error ?? { code: `HTTP_${response.status}`, message: response.statusText };
    throw new ApiError(error.code, ERROR_MESSAGES[error.code] ?? error.message ?? 'Error inesperado.');
  }
  return body.data;
}

function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  element.append(...children.filter((child) => child !== null && child !== undefined && child !== ''));
  return element;
}

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

function iconButton(iconName, label, onClick, disabled = false) {
  const button = el('button', { type: 'button', class: 'icon-button', 'aria-label': label, title: label, disabled },
    icon(iconName));
  button.addEventListener('click', onClick);
  return button;
}

const numberFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const formatDistance = (meters) =>
  meters >= 1000 ? `${numberFormat.format(meters / 1000)} km` : `${Math.round(meters)} m`;
const formatSize = (bytes) => `${numberFormat.format(bytes / 1024 / 1024)} MB`;
const formatPoint = ({ lat, lng }) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

const area = ([minLng, minLat, maxLng, maxLat]) => (maxLng - minLng) * (maxLat - minLat);
const containsBox = (outer, inner) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
const insideBox = (box, { lng, lat }) => lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
const toBounds = ([minLng, minLat, maxLng, maxLat]) => [[minLng, minLat], [maxLng, maxLat]];
const coordinate = ({ lat, lng }) => ({ latitude: lat, longitude: lng });

function setStatus(message, isError = false) {
  const status = $('route-status');
  status.textContent = message;
  status.classList.toggle('status--error', isError);
}

function showAppError(message) {
  const status = $('app-status');
  status.textContent = message;
  status.hidden = false;
}

// ---------------------------------------------------------------- regions and style

/** World base map below, then the prepared regions; a region inside a bigger one adds nothing. */
function tilesets() {
  const world = regions.find((region) => region.id === WORLD_REGION) ?? null;
  const detailed = regions
    .filter((region) => region.id !== WORLD_REGION && region.bbox)
    .sort((a, b) => area(b.bbox) - area(a.bbox));
  const drawn = detailed.filter(
    (region, index) => !detailed.slice(0, index).some((bigger) => containsBox(bigger.bbox, region.bbox)),
  );
  return { world, detailed, drawn };
}

/**
 * One copy of every style layer per tileset, the same layer of each tileset next to each other, so
 * the detailed regions cover the world base map and labels stay above every fill.
 */
function buildStyle() {
  const template = JSON.parse(styleTemplate.replaceAll('__GLYPHS_URL__', `${ORIGIN}/maps/fonts`));
  const baseSource = Object.values(template.sources)[0];
  const { world, drawn } = tilesets();
  const sets = [...(world ? [{ region: world, isWorld: true }] : []),
    ...drawn.map((region) => ({ region, isWorld: false }))];
  const style = { ...template, sources: {}, layers: [] };
  for (const { region, isWorld } of sets) {
    style.sources[region.id] = {
      ...baseSource,
      url: `pmtiles://${ORIGIN}${region.tilesUrl}`,
      attribution: isWorld ? NATURAL_EARTH_ATTRIBUTION : baseSource.attribution,
    };
  }
  for (const layer of template.layers) {
    if (!layer.source) {
      style.layers.push(layer);
      continue;
    }
    for (const { region, isWorld } of sets) {
      if (isWorld && (layer.minzoom ?? 0) >= WORLD_MAX_VISIBLE_ZOOM) continue;
      const copy = { ...layer, id: `${region.id}/${layer.id}`, source: region.id };
      if (isWorld) copy.maxzoom = Math.min(layer.maxzoom ?? 24, WORLD_MAX_VISIBLE_ZOOM);
      style.layers.push(copy);
    }
  }
  return style;
}

function initMap() {
  const { world, drawn } = tilesets();
  const home = drawn[0]?.bbox ?? world?.bbox;
  map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(),
    bounds: home ? toBounds(home) : undefined,
    fitBoundsOptions: { padding: 24 },
    attributionControl: { compact: false },
    hash: true,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.on('load', () => {
    addRouteLayers();
    drawRoutes();
    updateNotice();
  });
  map.on('moveend', updateNotice);
  map.on('click', onMapClick);
  window.__viewer = { map };
}

function updateNotice() {
  const notice = $('map-notice');
  const center = map.getCenter();
  const detailed = tilesets().drawn.some((region) => insideBox(region.bbox, center));
  const show = map.getZoom() >= WORLD_MAX_VISIBLE_ZOOM - 0.5 && !detailed;
  notice.hidden = !show;
  if (show) {
    notice.textContent = 'Esta zona no tiene mapa detallado. Aleja el mapa o prepara el país con ' +
      'make prepare-region REGION=<país>.';
  }
}

function renderCoverage() {
  const { world, detailed } = tilesets();
  const item = (name, meta, bbox) => {
    const button = el('button', { type: 'button', class: 'coverage__item' },
      el('span', {}, name), el('span', { class: 'coverage__meta' }, meta));
    button.addEventListener('click', () =>
      map.fitBounds(toBounds(bbox), { padding: 24, duration: animation(900) }));
    return el('li', {}, button);
  };
  const items = detailed.map((region) => item(region.name, formatSize(region.mapSize), region.bbox));
  if (world) items.push(item('Mundo (mapa base)', formatSize(world.mapSize), [-170, -58, 170, 75]));
  $('coverage-list').replaceChildren(...items);
}

// ---------------------------------------------------------------- search

async function searchPlaces(text) {
  const params = new URLSearchParams({ q: text, limit: String(SEARCH_LIMIT), lang: 'es' });
  if (map && map.getZoom() >= 4) {
    // Results near the visible area first (rounded so nearby views share the cache).
    const center = map.getCenter();
    params.set('lat', center.lat.toFixed(2));
    params.set('lng', center.lng.toFixed(2));
  }
  const key = params.toString();
  if (!searchCache.has(key)) {
    searchCache.set(key, api(`/geocoding/search?${key}`).catch((error) => {
      searchCache.delete(key);
      throw error;
    }));
  }
  return searchCache.get(key);
}

async function reverseGeocode({ lat, lng }) {
  try {
    return await api(`/geocoding/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&lang=es`);
  } catch {
    return null;
  }
}

/** Name and secondary line of a search result. */
function describe(result) {
  const name = result.name ?? result.displayName.split(',')[0].trim();
  const detail = result.displayName.startsWith(name)
    ? result.displayName.slice(name.length).replace(/^\s*,\s*/, '')
    : result.displayName;
  return { name, detail };
}

/** Short address of a reverse geocoding result: "Avenida 9 de Octubre 412". */
function describeReverse(result) {
  const address = result.address ?? {};
  const name = address.road
    ? [address.road, address.houseNumber].filter(Boolean).join(' ')
    : result.name ?? result.displayName.split(',')[0].trim();
  const detail = [address.suburb ?? address.neighbourhood, address.city, address.country]
    .filter((part) => part && part !== name)
    .join(', ');
  return { name, detail };
}

function resultIcon(result) {
  if (result.type === 'country') return 'i-globe';
  if (['capital', 'city', 'town', 'village', 'administrative'].includes(result.type)) return 'i-city';
  return 'i-pin';
}

const pointOf = (result) => ({ lng: result.longitude, lat: result.latitude });

let comboboxCount = 0;

/** Accessible autocomplete (combobox + listbox) over the place search. */
function createCombobox(input, listbox, { onSelect }) {
  const prefix = `option-${++comboboxCount}`;
  let results = [];
  let active = -1;
  let timer = 0;
  let request = 0;

  const setOpen = (open) => {
    listbox.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) {
      active = -1;
      input.removeAttribute('aria-activedescendant');
    }
  };
  const close = () => {
    clearTimeout(timer);
    request++;
    setOpen(false);
  };
  const info = (text) => {
    results = [];
    listbox.replaceChildren(el('li', { class: 'option option--info', role: 'option', 'aria-disabled': 'true' }, text));
    setOpen(true);
  };
  const highlight = (index) => {
    active = index;
    [...listbox.children].forEach((child, i) => child.setAttribute('aria-selected', String(i === index)));
    input.setAttribute('aria-activedescendant', `${prefix}-${index}`);
    listbox.children[index]?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (index) => {
    const result = results[index];
    if (!result) return;
    close();
    onSelect(result);
  };
  const render = () => {
    if (results.length === 0) {
      info('Sin resultados. Prueba con otro nombre o haz clic en el mapa.');
      return;
    }
    listbox.replaceChildren(...results.map((result, index) => {
      const { name, detail } = describe(result);
      const option = el('li', { id: `${prefix}-${index}`, class: 'option', role: 'option', 'aria-selected': 'false' },
        icon(resultIcon(result)),
        el('span', { class: 'option__text' },
          el('span', { class: 'option__name' }, name),
          detail ? el('span', { class: 'option__detail' }, detail) : null));
      // Keep the focus in the input so the click reaches the option.
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => choose(index));
      return option;
    }));
    active = -1;
    setOpen(true);
  };
  const run = async (text) => {
    const id = ++request;
    if (listbox.hidden) info('Buscando…');
    try {
      const found = await searchPlaces(text);
      if (id !== request) return;
      results = found;
      render();
    } catch (error) {
      if (id === request) info(error.message);
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < SEARCH_MIN_LENGTH) {
      close();
      return;
    }
    timer = setTimeout(() => run(text), SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (event) => {
    const open = !listbox.hidden && results.length > 0;
    if (event.key === 'ArrowDown' && open) {
      event.preventDefault();
      highlight((active + 1) % results.length);
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      highlight((active - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open) {
        choose(Math.max(active, 0));
      } else if (input.value.trim().length >= 2) {
        clearTimeout(timer);
        run(input.value.trim());
      }
    } else if (event.key === 'Escape' && !listbox.hidden) {
      event.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', close);
}

// ---------------------------------------------------------------- place card

function markerElement(role, text, label) {
  return el('div', { class: `marker marker--${role}`, role: 'img', 'aria-label': label, title: label },
    el('span', {}, text));
}

function showPlace(next, { move = true } = {}) {
  place = next;
  $('place-name').textContent = next.name;
  $('place-detail').textContent = next.detail ?? '';
  $('place-detail').hidden = !next.detail;
  $('place-stop').hidden = $('directions').hidden;
  $('place-card').hidden = false;
  placeMarker?.remove();
  placeMarker = new maplibregl.Marker({
    element: markerElement('place', '', next.name), anchor: 'bottom', offset: [0, -6],
  }).setLngLat(next.point).addTo(map);
  if (move) moveToPlace(next);
}

function moveToPlace({ point, bbox, type }) {
  // Outside the prepared regions only the world base map exists: do not zoom past it.
  const detailed = tilesets().drawn.some((region) => insideBox(region.bbox, point));
  const maxZoom = detailed ? 16 : WORLD_MAX_VISIBLE_ZOOM - 1;
  const box = bbox && bbox[2] - bbox[0] > 0.0005 && bbox[3] - bbox[1] > 0.0005 ? bbox : null;
  if (box) {
    map.fitBounds(toBounds(box), { padding: 48, maxZoom, duration: animation(900) });
    return;
  }
  const zoom = type === 'country' ? 5 : ['capital', 'city', 'town'].includes(type) ? 11 : 16;
  map.flyTo({ center: point, zoom: Math.min(zoom, maxZoom), duration: animation(900) });
}

function hidePlace() {
  place = null;
  $('place-card').hidden = true;
  placeMarker?.remove();
  placeMarker = null;
}

const placeFromResult = (result) => ({ point: pointOf(result), ...describe(result), bbox: result.bbox, type: result.type });

// ---------------------------------------------------------------- directions and stops

const stopRole = (index) => (index === 0 ? 'origin' : index === stops.length - 1 ? 'destination' : 'stop');
const stopName = (index) =>
  ({ origin: 'Origen', destination: 'Destino', stop: `Parada ${index}` })[stopRole(index)];
const stopBadge = (index) => ({ origin: 'A', destination: 'B', stop: String(index) })[stopRole(index)];
const PLACEHOLDERS = { origin: 'Punto de partida', destination: 'Destino', stop: 'Parada' };
const stopInput = (id) => $('stops').querySelector(`input[data-stop-id="${id}"]`);
const focusStop = (id) => stopInput(id)?.focus();

function renderStops() {
  const focusedId = document.activeElement?.dataset?.stopId;
  $('stops').replaceChildren(...stops.map(stopRow));
  if (focusedId) focusStop(focusedId);
  $('add-stop').disabled = stops.length >= MAX_POINTS;
}

function stopRow(stop, index) {
  const role = stopRole(index);
  const name = stopName(index);
  const inputId = `stop-input-${stop.id}`;
  const listId = `stop-list-${stop.id}`;
  const input = el('input', {
    id: inputId, class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', role: 'combobox',
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
    placeholder: PLACEHOLDERS[role], 'data-stop-id': stop.id,
  });
  input.value = stop.label;
  const listbox = el('ul', { id: listId, class: 'listbox', role: 'listbox', 'aria-label': `Sugerencias para ${name}`,
    hidden: true });
  createCombobox(input, listbox, {
    onSelect: (result) => setStop(stop.id, pointOf(result), describe(result).name, { focusNext: true }),
  });
  input.addEventListener('focus', () => setActiveStop(stop.id));
  input.addEventListener('input', () => {
    if (!input.value.trim() && stop.point) {
      stop.point = null;
      stop.label = '';
      syncMarkers();
      calculate();
    }
  });
  // Typed text that was not chosen from the suggestions does not replace the point.
  input.addEventListener('blur', () => {
    if (stop.point) input.value = stop.label;
  });

  const actions = el('div', { class: 'stop__actions' });
  if (role === 'origin' && canLocate) actions.append(iconButton('i-locate', 'Usar mi ubicación', () => locate(stop.id)));
  actions.append(
    iconButton('i-up', `Subir ${name}`, () => moveStop(index, -1), index === 0),
    iconButton('i-down', `Bajar ${name}`, () => moveStop(index, 1), index === stops.length - 1),
    iconButton('i-x', stops.length > 2 ? `Quitar ${name}` : `Borrar ${name}`, () => removeStop(index)),
  );
  return el('li', { class: `stop${stop.id === activeStopId ? ' stop--active' : ''}`, 'data-stop-id': stop.id },
    el('span', { class: `stop__badge stop__badge--${role}`, 'aria-hidden': 'true' }, stopBadge(index)),
    el('div', { class: 'combobox' }, el('label', { class: 'sr-only', for: inputId }, name), input, listbox),
    actions);
}

function setActiveStop(id) {
  activeStopId = id;
  for (const row of $('stops').children) row.classList.toggle('stop--active', row.dataset.stopId === String(id));
}

function update() {
  renderStops();
  syncMarkers();
  calculate();
}

function setStop(id, point, label, { focusNext = false } = {}) {
  const stop = stops.find((item) => item.id === id);
  if (!stop) return;
  stop.point = point;
  stop.label = label;
  const next = stops.find((item) => !item.point);
  activeStopId = next?.id ?? id;
  update();
  if (focusNext && next) focusStop(next.id);
}

/** Replaces "Punto en el mapa" with the address once the reverse geocoding answers. */
async function nameFromMap(stopId, point) {
  const result = await reverseGeocode(point);
  const stop = stops.find((item) => item.id === stopId);
  if (!result || !stop || stop.point !== point) return;
  stop.label = describeReverse(result).name;
  const input = stopInput(stopId);
  if (input && document.activeElement !== input) input.value = stop.label;
}

function moveStop(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= stops.length) return;
  [stops[index], stops[target]] = [stops[target], stops[index]];
  const moved = stops[target].id;
  update();
  focusStop(moved);
}

function removeStop(index) {
  if (stops.length > 2) {
    const [removed] = stops.splice(index, 1);
    if (removed.id === activeStopId) activeStopId = stops[Math.min(index, stops.length - 1)].id;
  } else {
    Object.assign(stops[index], { point: null, label: '' });
    activeStopId = stops[index].id;
  }
  update();
  focusStop(stops[Math.min(index, stops.length - 1)].id);
}

function addStop(point = null, label = '') {
  if (stops.length >= MAX_POINTS) return null;
  const stop = { ...newStop(), point, label };
  stops.splice(stops.length - 1, 0, stop);
  activeStopId = point ? stops.find((item) => !item.point)?.id ?? stop.id : stop.id;
  update();
  return stop;
}

function locate(stopId) {
  setStatus('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setStatus('');
      setStop(stopId, { lng: position.coords.longitude, lat: position.coords.latitude }, 'Tu ubicación',
        { focusNext: true });
    },
    (error) => setStatus(error.code === error.PERMISSION_DENIED
      ? 'No hay permiso para usar tu ubicación.' : 'No se pudo obtener tu ubicación.', true),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

function syncMarkers() {
  if (!map) return;
  for (const marker of stopMarkers.values()) marker.remove();
  stopMarkers.clear();
  stops.forEach((stop, index) => {
    if (!stop.point) return;
    const marker = new maplibregl.Marker({
      element: markerElement(stopRole(index), stopBadge(index), `${stopName(index)}: ${stop.label}`),
      anchor: 'bottom', offset: [0, -6], draggable: true,
    }).setLngLat(stop.point).addTo(map);
    marker.on('dragend', () => {
      const { lng, lat } = marker.getLngLat();
      const point = { lng, lat };
      setStop(stop.id, point, MAP_POINT_LABEL);
      nameFromMap(stop.id, point);
    });
    stopMarkers.set(stop.id, marker);
  });
}

function openDirections({ focus = true } = {}) {
  $('directions').hidden = false;
  $('place-stop').hidden = !place;
  renderStops();
  if (focus) focusStop(stops.find((stop) => !stop.point)?.id ?? activeStopId);
}

function closeDirections() {
  $('directions').hidden = true;
  $('place-stop').hidden = true;
  stops = [newStop(), newStop()];
  activeStopId = stops[0].id;
  update();
  $('open-directions').focus();
}

async function onMapClick(event) {
  if (event.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
  const point = { lng: event.lngLat.lng, lat: event.lngLat.lat };
  if (!$('directions').hidden) {
    const target = stops.find((stop) => stop.id === activeStopId && !stop.point) ?? stops.find((stop) => !stop.point);
    if (target) {
      setStop(target.id, point, MAP_POINT_LABEL);
      nameFromMap(target.id, point);
      return;
    }
  }
  // Like a dropped pin: show what is there and offer the route.
  showPlace({ point, name: MAP_POINT_LABEL, detail: formatPoint(point) }, { move: false });
  const result = await reverseGeocode(point);
  if (!result || place?.point !== point) return;
  Object.assign(place, describeReverse(result));
  $('place-name').textContent = place.name;
  $('place-detail').textContent = place.detail;
  $('place-detail').hidden = !place.detail;
}

// ---------------------------------------------------------------- routes

function renderProfiles() {
  for (const option of PROFILES) {
    const input = el('input', { type: 'radio', name: 'profile', value: option.id, class: 'sr-only',
      checked: option.id === profile });
    input.addEventListener('change', () => {
      profile = option.id;
      calculate();
    });
    $('profiles').append(el('label', { class: 'profile' }, input, icon(option.icon), el('span', {}, option.label)));
  }
}

async function calculate() {
  const request = ++routeRequest;
  if (stops.some((stop) => !stop.point)) {
    routes = [];
    drawRoutes();
    renderRoutes();
    setStatus(stops.some((stop) => stop.point) ? 'Completa los puntos vacíos para calcular la ruta.' : '');
    return;
  }
  setStatus('Calculando ruta…');
  const [origin, ...rest] = stops;
  const destination = rest.pop();
  try {
    const result = await api('/routes/calculate', {
      method: 'POST',
      body: JSON.stringify({
        origin: coordinate(origin.point),
        destination: coordinate(destination.point),
        ...(rest.length ? { waypoints: rest.map((stop) => coordinate(stop.point)) } : { alternatives: true }),
        profile,
      }),
    });
    if (request !== routeRequest) return;
    routes = result.routes;
    selectedRoute = 0;
    drawRoutes();
    renderRoutes();
    fitRoute();
    setStatus(rest.length
      ? `Ruta con ${rest.length} ${rest.length === 1 ? 'parada' : 'paradas'}.`
      : routes.length > 1 ? `${routes.length} rutas encontradas.` : 'Ruta encontrada.');
  } catch (error) {
    if (request !== routeRequest) return;
    routes = [];
    drawRoutes();
    renderRoutes();
    setStatus(error.message, true);
  }
}

function routeLabel(index) {
  const waypoints = stops.length - 2;
  if (waypoints > 0) return `Pasa por ${waypoints} ${waypoints === 1 ? 'parada' : 'paradas'}`;
  return index === 0 ? 'Ruta recomendada' : `Alternativa ${index}`;
}

function renderRoutes() {
  $('routes-list').replaceChildren(...routes.map((route, index) => {
    const input = el('input', { type: 'radio', name: 'route', value: index, class: 'sr-only',
      checked: index === selectedRoute });
    input.addEventListener('change', () => {
      selectedRoute = index;
      drawRoutes();
      renderSteps();
    });
    return el('label', { class: 'route-option' }, input,
      el('span', { class: 'route-option__time' }, formatDuration(route.durationSeconds)),
      el('span', { class: 'route-option__distance' }, formatDistance(route.distanceMeters)),
      el('span', { class: 'route-option__label' }, routeLabel(index)));
  }));
  $('routes').hidden = routes.length === 0;
  renderSteps();
}

function renderSteps() {
  const steps = routes[selectedRoute]?.steps ?? [];
  $('steps').replaceChildren(...steps.map((step) =>
    el('li', {}, `${step.instruction} `, el('span', { class: 'step__distance' }, `· ${formatDistance(step.distanceMeters)}`))));
  $('steps-details').hidden = steps.length === 0;
}

function fitRoute() {
  const bbox = routes[selectedRoute]?.bbox;
  if (bbox) map.fitBounds(toBounds(bbox), { padding: 64, maxZoom: 16, duration: animation(700) });
}

function addRouteLayers() {
  if (map.getSource('route')) return;
  // Under the labels, above the roads.
  const firstLabel = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const layout = { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['case', ['get', 'selected'], 1, 0] };
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route', layout,
    paint: { 'line-color': token('--color-route-casing'), 'line-width': 9 },
  }, firstLabel);
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route', layout,
    paint: {
      'line-color': ['case', ['get', 'selected'], token('--color-route'), token('--color-route-alternative')],
      'line-width': 5,
    },
  }, firstLabel);
}

function drawRoutes() {
  const source = map?.getSource('route');
  if (!source) return; // added on load, which draws the current routes
  source.setData({
    type: 'FeatureCollection',
    features: routes.map((route, index) => ({
      type: 'Feature', properties: { selected: index === selectedRoute }, geometry: route.geometry,
    })),
  });
}

// ---------------------------------------------------------------- start

function wireControls() {
  createCombobox($('search-input'), $('search-results'), {
    onSelect: (result) => showPlace(placeFromResult(result)),
  });
  $('open-directions').addEventListener('click', () => openDirections());
  $('close-directions').addEventListener('click', closeDirections);
  $('place-close').addEventListener('click', hidePlace);
  $('place-to').addEventListener('click', () => {
    if (!place) return;
    const destination = stops.at(-1);
    Object.assign(destination, { point: place.point, label: place.name });
    activeStopId = stops.find((stop) => !stop.point)?.id ?? destination.id;
    hidePlace();
    openDirections();
    update();
  });
  $('place-from').addEventListener('click', () => {
    if (!place) return;
    Object.assign(stops[0], { point: place.point, label: place.name });
    activeStopId = stops.find((stop) => !stop.point)?.id ?? stops[0].id;
    hidePlace();
    openDirections();
    update();
  });
  $('place-stop').addEventListener('click', () => {
    if (!place) return;
    const empty = stops.find((stop) => !stop.point);
    if (empty) {
      setStop(empty.id, place.point, place.name);
    } else if (!addStop(place.point, place.name)) {
      setStatus(`Se admiten hasta ${MAX_POINTS - 2} paradas.`, true);
      return;
    }
    hidePlace();
  });
  $('add-stop').addEventListener('click', () => {
    const stop = addStop();
    if (stop) focusStop(stop.id);
  });
  $('swap-stops').addEventListener('click', () => {
    stops.reverse();
    update();
  });
}

async function main() {
  renderProfiles();
  renderStops();
  wireControls();
  try {
    [regions, styleTemplate] = await Promise.all([
      api('/maps/regions'),
      fetch('/maps/style/style.json').then((response) => {
        if (!response.ok) throw new Error(`style.json: HTTP ${response.status}`);
        return response.text();
      }),
    ]);
  } catch (error) {
    showAppError(`No se pudo cargar el mapa: ${error.message}`);
    return;
  }
  if (regions.length === 0) {
    showAppError('No hay mapas preparados. Ejecuta make prepare-region REGION=world (mapa mundial) ' +
      'y REGION=<país> (detalle).');
    return;
  }
  initMap();
  renderCoverage();
}

main();
