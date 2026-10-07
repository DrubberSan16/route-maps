// Viajes: trips of every account (GET /admin/trips) and the detail of one with its track, the
// geofences it is inside of and the actions to finish or cancel it.
import { button, card, clear, code, confirmDialog, el, errorBox, facts, link, loading, toast } from '../dom.js';
import {
  countOf,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatNumber,
  formatRelative,
  formatSpeed,
  label,
  NONE,
  PLATFORM_LABELS,
  shortId,
  TRIP_STATUS_LABELS,
  tripSeconds,
} from '../format.js';
import { listView, pageHeader } from '../list.js';
import { addLayers, collection, fitTo, point, setData, token } from '../map.js';
import { dayRange } from '../router.js';
import { accountCell, backLink, mapPanel, profileCell, titleCell, tripStatusBadge } from './common.js';

export function render(ctx) {
  return ctx.segments[0] ? renderTrip(ctx, ctx.segments[0]) : renderList(ctx);
}

function renderList(ctx) {
  listView(ctx, {
    title: 'Viajes',
    description: 'Los viajes de todas las cuentas: en curso, terminados y cancelados.',
    filters: [
      { name: 'q', label: 'Buscar', placeholder: 'Nombre, correo o dispositivo' },
      {
        name: 'status',
        label: 'Estado',
        type: 'select',
        options: [['', 'Todos'], ...ctx.meta.tripStatuses.map((status) => [status, label(TRIP_STATUS_LABELS, status)])],
      },
      { name: 'userId', label: 'Cuenta', type: 'account' },
      { name: 'from', label: 'Desde', type: 'date' },
      { name: 'to', label: 'Hasta', type: 'date' },
    ],
    empty: 'Todavía no hay viajes. Aparecen cuando la app o una integración inicia uno.',
    columns: [
      { label: 'Viaje', render: (trip) => titleCell(trip.name || 'Viaje sin nombre', shortId(trip.id)) },
      { label: 'Cuenta', render: (trip) => accountCell(ctx, trip.user) },
      { label: 'Estado', render: (trip) => tripStatusBadge(trip.status) },
      { label: 'Medio', render: (trip) => profileCell(trip.profile) },
      { label: 'Inicio', className: 'nowrap', render: (trip) => formatDateTime(trip.startedAt, ctx.timeZone) },
      { label: 'Duración', className: 'num', render: (trip) => formatDuration(tripSeconds(trip)) },
      { label: 'Distancia', className: 'num', render: (trip) => formatDistance(trip.distanceMeters) },
      { label: 'Puntos', className: 'num', render: (trip) => formatNumber(trip.pointCount) },
    ],
    rowHref: (trip) => `#/viajes/${trip.id}`,
    load: (state) => {
      const range = dayRange(state.from, state.to);
      return ctx.api.get('/admin/trips', {
        q: state.q,
        status: state.status,
        userId: state.userId,
        from: range.from,
        to: range.to,
        limit: state.limit,
        offset: state.offset,
      }, { signal: ctx.signal });
    },
  });
}

async function renderTrip(ctx, id) {
  clear(ctx.outlet, loading());
  let trip;
  try {
    trip = await ctx.api.get(`/admin/trips/${encodeURIComponent(id)}`, undefined, { signal: ctx.signal });
  } catch (error) {
    clear(ctx.outlet, el('div', { class: 'page' }, backLink('#/viajes', 'Viajes'), errorBox(error)));
    return;
  }
  if (ctx.signal.aborted) return;

  const actions = [];
  if (trip.status === 'ACTIVE') {
    actions.push(
      button('Terminar viaje', {
        icon: 'flag',
        variant: 'primary',
        onClick: () => confirmDialog({
          title: 'Terminar el viaje',
          message: 'El viaje queda terminado como si la app lo hubiera cerrado: se calcula su distancia y las integraciones reciben trip.finished. La app deja de enviar posiciones a este viaje.',
          confirmLabel: 'Terminar',
          tone: 'primary',
          run: () => ctx.api.post(`/admin/trips/${trip.id}/finish`),
        }).then((done) => {
          if (!done) return;
          toast('Viaje terminado.', 'success');
          ctx.reload();
        }),
      }),
      button('Cancelar viaje', {
        icon: 'ban',
        variant: 'secondary',
        onClick: () => confirmDialog({
          title: 'Cancelar el viaje',
          message: 'El viaje queda cancelado y las integraciones reciben trip.cancelled. Su recorrido se conserva.',
          confirmLabel: 'Cancelar viaje',
          run: () => ctx.api.post(`/admin/trips/${trip.id}/cancel`),
        }).then((done) => {
          if (!done) return;
          toast('Viaje cancelado.', 'success');
          ctx.reload();
        }),
      }),
    );
  }

  const now = Date.now();
  const panel = mapPanel(ctx, { className: 'map-frame--tall' });
  const trackInfo = el('p', { class: 'muted small' }, 'Cargando el recorrido…');
  const hasMetadata = trip.metadata && typeof trip.metadata === 'object' && Object.keys(trip.metadata).length > 0;

  clear(ctx.outlet, el('div', { class: 'page' },
    backLink('#/viajes', 'Viajes'),
    pageHeader(trip.name || 'Viaje sin nombre', null, actions),
    el('div', { class: 'page__meta' }, tripStatusBadge(trip.status), profileCell(trip.profile),
      el('span', { class: 'muted small mono' }, trip.id)),
    el('div', { class: 'grid grid--sidebar' },
      el('div', { class: 'stack' }, panel.element, trackInfo),
      el('div', { class: 'stack' },
        card('Datos del viaje', facts([
          ['Cuenta', accountCell(ctx, trip.user)],
          ['Dispositivo', trip.device
            ? `${trip.device.model ?? label(PLATFORM_LABELS, trip.device.platform)} · ${shortId(trip.device.installationId)}`
            : 'Sin dispositivo (integración o web)'],
          ['Inicio', formatDateTime(trip.startedAt, ctx.timeZone)],
          ['Fin', trip.endedAt ? formatDateTime(trip.endedAt, ctx.timeZone) : 'En curso'],
          ['Duración', formatDuration(tripSeconds(trip, now))],
          ['Distancia', formatDistance(trip.distanceMeters)],
          ['Posiciones', formatNumber(trip.pointCount)],
          ['Ruta seguida', trip.route ? link(`#/rutas/${trip.route.id}`, trip.route.name) : NONE],
        ], 'facts--stacked')),
        card('Dentro de geocercas', trip.geofencesInside.length
          ? el('ul', { class: 'stack' }, trip.geofencesInside.map((inside) => el('li', {},
            link(`#/geocercas/${inside.id}`, inside.name),
            el('span', { class: 'muted small' }, ` · desde ${formatRelative(inside.enteredAt, now, ctx.timeZone)}`))))
          : el('p', { class: 'muted' }, trip.status === 'ACTIVE' ? 'Ahora no está dentro de ninguna geocerca.' : 'Ninguna al terminar.')),
        hasMetadata ? card('Datos de la aplicación', code(trip.metadata)) : null))));

  let path;
  try {
    path = await ctx.api.get(`/admin/trips/${trip.id}/path`, { maxPoints: 5000 }, { signal: ctx.signal });
  } catch (error) {
    if (!ctx.signal.aborted) clear(trackInfo, errorBox(error));
    return;
  }
  if (ctx.signal.aborted) return;
  const last = path.points.at(-1);
  trackInfo.textContent = path.totalPoints === 0
    ? 'Este viaje todavía no tiene posiciones.'
    : `${countOf(path.totalPoints, 'posición', 'posiciones')} · ${formatDistance(path.distanceMeters)} medidos` +
      (path.points.length < path.totalPoints ? ` · se muestran ${formatNumber(path.points.length)} repartidas a lo largo del recorrido` : '') +
      (last ? ` · última ${formatRelative(last.recordedAt, Date.now(), ctx.timeZone)} a ${formatSpeed(last.speed)}` : '');

  const result = await panel.ready;
  if (!result || path.points.length === 0) return;
  const { map } = result;
  const first = path.points[0];
  setData(map, 'track', path.geometry ? { type: 'Feature', geometry: path.geometry, properties: {} } : collection([]));
  setData(map, 'track-ends', collection([
    point(first.longitude, first.latitude, { kind: 'start' }),
    ...(path.points.length > 1 ? [point(last.longitude, last.latitude, { kind: trip.status === 'ACTIVE' ? 'current' : 'end' })] : []),
  ]));
  addLayers(map, [
    { id: 'track-casing', type: 'line', source: 'track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': token('--color-map-casing'), 'line-width': 8 } },
    { id: 'track-line', type: 'line', source: 'track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': token('--color-map-track'), 'line-width': 4 } },
    {
      id: 'track-ends',
      type: 'circle',
      source: 'track-ends',
      paint: {
        'circle-radius': 7,
        'circle-color': ['match', ['get', 'kind'], 'start', token('--color-map-start'), 'end', token('--color-map-end'), token('--color-map-live')],
        'circle-stroke-width': 3,
        'circle-stroke-color': token('--color-map-casing'),
      },
    },
  ]);
  fitTo(map, path.geometry ?? [first.longitude, first.latitude], { padding: 56 });
}
