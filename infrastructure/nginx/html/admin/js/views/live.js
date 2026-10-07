// Mapa en vivo: trips in progress of every account with their last position, refreshed every
// 15 seconds (GET /admin/trips/live).
import { button, card, clear, el, emptyState, errorBox, icon, link, loading } from '../dom.js';
import { formatDuration, formatNumber, formatRelative, formatSpeed, tripSeconds } from '../format.js';
import { pageHeader } from '../list.js';
import { addLayers, collection, fitTo, point, setData, token } from '../map.js';
import { mapPanel, PROFILE_ICONS } from './common.js';

const REFRESH_MS = 15_000;
/** A position older than this is drawn grey: the device stopped reporting. */
const STALE_MS = 5 * 60_000;

export async function render(ctx) {
  const count = el('span', { class: 'muted small', 'aria-live': 'polite' });
  const refresh = button('Actualizar', { icon: 'refresh', onClick: () => load() });
  const list = el('div', { class: 'live__list' }, loading());
  const panel = mapPanel(ctx, { className: 'map-frame--tall' });
  clear(ctx.outlet, el('div', { class: 'page' },
    pageHeader('Mapa en vivo', 'Los viajes en curso con su última posición. Se actualiza solo cada 15 segundos.',
      [count, refresh]),
    el('div', { class: 'live' }, panel.element, card('Viajes en curso', list, { className: 'card--flush' }))));

  let trips = [];
  let selected = null;
  let fitted = false;
  let popup = null;
  let timer = null;
  const onVisible = () => {
    if (!document.hidden && !ctx.signal.aborted) load();
  };
  document.addEventListener('visibilitychange', onVisible);
  ctx.onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });

  const mapReady = panel.ready.then((result) => {
    if (!result) return null;
    const { map } = result;
    setData(map, 'live', collection([]));
    addLayers(map, [
      {
        id: 'live-halo',
        type: 'circle',
        source: 'live',
        paint: { 'circle-radius': 13, 'circle-color': token('--color-map-casing'), 'circle-opacity': 0.9 },
      },
      {
        id: 'live-points',
        type: 'circle',
        source: 'live',
        paint: {
          'circle-radius': 8,
          'circle-color': ['case', ['get', 'stale'], token('--color-map-stale'), token('--color-map-live')],
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 0],
          'circle-stroke-color': token('--color-foreground'),
        },
      },
    ]);
    map.on('click', 'live-points', (event) => {
      const id = event.features?.[0]?.properties?.tripId;
      if (id) select(id, { fly: false });
    });
    map.on('mouseenter', 'live-points', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'live-points', () => { map.getCanvas().style.cursor = ''; });
    return result;
  });

  const popupContent = (trip) => el('div', { class: 'popup' },
    el('strong', {}, trip.name || 'Viaje sin nombre'),
    el('span', {}, trip.userEmail),
    el('span', {}, trip.position
      ? `${formatRelative(trip.position.recordedAt, Date.now(), ctx.timeZone)} · ${formatSpeed(trip.position.speed)}`
      : 'Sin posición todavía'),
    link(`#/viajes/${trip.tripId}`, 'Ver el viaje'));

  async function select(tripId, { fly = true } = {}) {
    selected = tripId;
    drawList();
    const result = await mapReady;
    const trip = trips.find((item) => item.tripId === tripId);
    if (!result || !trip?.position) return;
    const { map, maplibregl } = result;
    drawMap(map);
    const at = [trip.position.longitude, trip.position.latitude];
    if (fly) map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 14), duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
    popup?.remove();
    popup = new maplibregl.Popup({ offset: 14, closeButton: true }).setLngLat(at).setDOMContent(popupContent(trip)).addTo(map);
  }

  function drawMap(map) {
    const now = Date.now();
    setData(map, 'live', collection(trips.filter((trip) => trip.position).map((trip) =>
      point(trip.position.longitude, trip.position.latitude, {
        tripId: trip.tripId,
        stale: now - new Date(trip.position.recordedAt).getTime() > STALE_MS,
        selected: trip.tripId === selected,
      }))));
  }

  function drawList() {
    if (trips.length === 0) {
      clear(list, emptyState('No hay viajes en curso ahora.'));
      return;
    }
    const now = Date.now();
    clear(list, trips.map((trip) => el('button', {
      type: 'button',
      class: 'live__item',
      'aria-pressed': String(trip.tripId === selected),
      onclick: () => (trip.position ? select(trip.tripId) : ctx.navigate(['viajes', trip.tripId])),
    },
    icon(PROFILE_ICONS[trip.profile] ?? 'route'),
    el('span', { class: 'live__text' },
      el('strong', {}, trip.name || 'Viaje sin nombre'),
      el('span', {}, trip.userEmail),
      el('span', {}, trip.position
        ? `${formatRelative(trip.position.recordedAt, now, ctx.timeZone)} · ${formatSpeed(trip.position.speed)} · ${formatDuration(tripSeconds(trip, now))} de viaje`
        : `Sin posición todavía · iniciado ${formatRelative(trip.startedAt, now, ctx.timeZone)}`)))));
  }

  async function load() {
    clearTimeout(timer);
    refresh.disabled = true;
    try {
      trips = await ctx.api.get('/admin/trips/live', undefined, { signal: ctx.signal });
      if (ctx.signal.aborted) return;
      count.textContent = `${formatNumber(trips.length)} en curso`;
      if (selected && !trips.some((trip) => trip.tripId === selected)) {
        selected = null;
        popup?.remove();
      }
      drawList();
      const result = await mapReady;
      if (result && !ctx.signal.aborted) {
        drawMap(result.map);
        const positions = trips.filter((trip) => trip.position).map((trip) => [trip.position.longitude, trip.position.latitude]);
        if (!fitted && positions.length > 0) {
          fitTo(result.map, positions, { padding: 64, maxZoom: 15 });
          fitted = true;
        }
      }
    } catch (error) {
      if (ctx.signal.aborted || error?.name === 'AbortError') return;
      clear(list, errorBox(error, load));
    } finally {
      refresh.disabled = false;
      if (!ctx.signal.aborted) timer = setTimeout(() => (document.hidden ? null : load()), REFRESH_MS);
    }
  }

  await load();
}
