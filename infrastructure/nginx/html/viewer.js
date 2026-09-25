// Developer map viewer: renders a prepared region from its PMTiles archive with
// the platform style and draws routes returned by POST /api/v1/routes/calculate.
import * as maplibregl from './vendor/maplibre-gl.mjs';

const API = '/api/v1';
const ORIGIN = window.location.origin;

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const ui = {
  region: document.getElementById('region'),
  regionInfo: document.getElementById('region-info'),
  profile: document.getElementById('profile'),
  clear: document.getElementById('clear'),
  status: document.getElementById('status'),
  routes: document.getElementById('routes'),
  steps: document.getElementById('steps'),
};

let map;
let regions = [];
let styleTemplate;
let origin = null;
let destination = null;
let markers = [];
let lastRoutes = [];

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.className = isError ? 'error' : '';
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const error = body?.error ?? { code: `HTTP_${response.status}`, message: response.statusText };
    throw new Error(`${error.code}: ${error.message}`);
  }
  return body.data;
}

function buildStyle(region) {
  const json = styleTemplate
    .replaceAll('__PMTILES_URL__', `${ORIGIN}${region.tilesUrl}`)
    .replaceAll('__GLYPHS_URL__', `${ORIGIN}/maps/fonts`);
  return JSON.parse(json);
}

const formatKm = (meters) => (meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`);
const formatMin = (seconds) => (seconds >= 3600
  ? `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`
  : `${Math.max(1, Math.round(seconds / 60))} min`);
const formatMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function showRegion(region) {
  ui.regionInfo.textContent =
    `Versión ${region.version} · mapa ${formatMb(region.mapSize)}` +
    (region.routingSize ? ` · routing ${formatMb(region.routingSize)}` : '') +
    ` · SHA-256 ${region.checksum.slice(0, 16)}…`;
  const style = buildStyle(region);
  const bounds = region.bbox ? [[region.bbox[0], region.bbox[1]], [region.bbox[2], region.bbox[3]]] : null;
  if (!map) {
    map = new maplibregl.Map({
      container: 'map',
      style,
      bounds: bounds ?? undefined,
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: false },
      hash: true,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('click', (event) => onMapClick(event.lngLat));
    map.on('style.load', () => drawRoutes(lastRoutes));
  } else {
    map.setStyle(style);
    if (bounds) map.fitBounds(bounds, { padding: 20, duration: 0 });
  }
  window.__viewer = { map, region };
}

function addMarker(lngLat, color) {
  const marker = new maplibregl.Marker({ color }).setLngLat(lngLat).addTo(map);
  markers.push(marker);
}

function clearRoute() {
  origin = null;
  destination = null;
  markers.forEach((marker) => marker.remove());
  markers = [];
  lastRoutes = [];
  ui.routes.innerHTML = '';
  ui.steps.innerHTML = '';
  drawRoutes([]);
  setStatus('');
}

async function onMapClick(lngLat) {
  if (!origin || destination) {
    clearRoute();
    origin = lngLat;
    addMarker(lngLat, '#2e7d32');
    setStatus('Origen marcado. Haz clic para elegir el destino.');
    return;
  }
  destination = lngLat;
  addMarker(lngLat, '#c62828');
  await calculate();
}

async function calculate() {
  setStatus('Calculando ruta…');
  try {
    const result = await api('/routes/calculate', {
      method: 'POST',
      body: JSON.stringify({
        origin: { latitude: origin.lat, longitude: origin.lng },
        destination: { latitude: destination.lat, longitude: destination.lng },
        profile: ui.profile.value,
        alternatives: true,
      }),
    });
    lastRoutes = result.routes;
    drawRoutes(lastRoutes);
    listRoutes(lastRoutes, 0);
    setStatus(`Ruta calculada con ${result.provider} (${result.profile}).`);
  } catch (error) {
    lastRoutes = [];
    drawRoutes([]);
    setStatus(error.message, true);
  }
}

function drawRoutes(routes, selected = 0) {
  if (!map || !map.isStyleLoaded()) return;
  const data = {
    type: 'FeatureCollection',
    features: routes.map((route, index) => ({
      type: 'Feature',
      properties: { selected: index === selected },
      geometry: route.geometry,
    })),
  };
  const source = map.getSource('route');
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource('route', { type: 'geojson', data });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['case', ['get', 'selected'], 1, 0] },
    paint: { 'line-color': '#ffffff', 'line-width': 9 },
  });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['case', ['get', 'selected'], 1, 0] },
    paint: {
      'line-color': ['case', ['get', 'selected'], '#1a73e8', '#9bb8e8'],
      'line-width': 5,
    },
  });
}

function listRoutes(routes, selected) {
  ui.routes.innerHTML = '';
  routes.forEach((route, index) => {
    const item = document.createElement('li');
    item.textContent = `${route.type === 'PRIMARY' ? 'Principal' : 'Alternativa'}: ` +
      `${formatKm(route.distanceMeters)} · ${formatMin(route.durationSeconds)}`;
    item.className = index === selected ? 'selected' : '';
    item.addEventListener('click', () => {
      drawRoutes(routes, index);
      listRoutes(routes, index);
    });
    ui.routes.appendChild(item);
  });
  ui.steps.innerHTML = '';
  for (const step of routes[selected]?.steps ?? []) {
    const item = document.createElement('li');
    item.textContent = `${step.instruction} (${formatKm(step.distanceMeters)})`;
    ui.steps.appendChild(item);
  }
}

async function main() {
  ui.clear.addEventListener('click', clearRoute);
  ui.profile.addEventListener('change', () => origin && destination && calculate());
  try {
    [regions, styleTemplate] = await Promise.all([
      api('/maps/regions'),
      fetch('/maps/style/style.json').then((response) => response.text()),
    ]);
  } catch (error) {
    setStatus(`No se pudo cargar el catálogo: ${error.message}`, true);
    return;
  }
  if (regions.length === 0) {
    ui.region.replaceChildren(new Option('Sin regiones'));
    setStatus('No hay regiones preparadas. Ejecuta: make prepare-region REGION=<región>', true);
    return;
  }
  ui.region.replaceChildren(...regions.map((region) => new Option(`${region.name} (${region.id})`, region.id)));
  ui.region.disabled = false;
  const requested = new URLSearchParams(window.location.search).get('region');
  const initial = regions.find((region) => region.id === requested) ?? regions[0];
  ui.region.value = initial.id;
  ui.region.addEventListener('change', () => {
    clearRoute();
    showRegion(regions.find((region) => region.id === ui.region.value));
  });
  showRegion(initial);
}

main();
