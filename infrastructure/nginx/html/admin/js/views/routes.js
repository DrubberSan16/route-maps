// Rutas guardadas: routes the accounts saved to follow them later, also offline
// (GET /admin/routes, GET /admin/routes/:id; deleting them is for administrators).
import { button, card, clear, confirmDialog, el, errorBox, facts, link, loading, toast } from '../dom.js';
import {
  formatCoordinate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatNumber,
  NONE,
} from '../format.js';
import { listView, pageHeader } from '../list.js';
import { addLayers, collection, fitTo, point, setData, token } from '../map.js';
import { accountCell, backLink, mapPanel, profileCell, titleCell } from './common.js';

export function render(ctx) {
  return ctx.segments[0] ? renderRoute(ctx, ctx.segments[0]) : renderList(ctx);
}

function renderList(ctx) {
  listView(ctx, {
    title: 'Rutas guardadas',
    description: 'Rutas que las cuentas guardaron para seguirlas después, también sin conexión.',
    filters: [
      { name: 'q', label: 'Buscar', placeholder: 'Nombre, región o correo' },
      { name: 'userId', label: 'Cuenta', type: 'account' },
    ],
    empty: 'Todavía no hay rutas guardadas.',
    columns: [
      { label: 'Ruta', render: (route) => titleCell(route.name, route.regionCode ? `Región ${route.regionCode}` : null) },
      { label: 'Cuenta', render: (route) => accountCell(ctx, route.owner) },
      { label: 'Medio', render: (route) => profileCell(route.profile) },
      { label: 'Distancia', className: 'num', render: (route) => formatDistance(route.distanceMeters) },
      { label: 'Duración', className: 'num', render: (route) => formatDuration(route.durationSeconds) },
      { label: 'Viajes', className: 'num', render: (route) => formatNumber(route.trips) },
      { label: 'Guardada', className: 'nowrap', render: (route) => formatDateTime(route.createdAt, ctx.timeZone) },
    ],
    rowHref: (route) => `#/rutas/${route.id}`,
    load: (state) => ctx.api.get('/admin/routes', {
      q: state.q,
      userId: state.userId,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
}

async function renderRoute(ctx, id) {
  clear(ctx.outlet, loading());
  let route;
  try {
    route = await ctx.api.get(`/admin/routes/${encodeURIComponent(id)}`, undefined, { signal: ctx.signal });
  } catch (error) {
    clear(ctx.outlet, el('div', { class: 'page' }, backLink('#/rutas', 'Rutas guardadas'), errorBox(error)));
    return;
  }
  if (ctx.signal.aborted) return;

  const actions = ctx.isAdmin
    ? [button('Eliminar', {
      icon: 'trash',
      variant: 'danger',
      onClick: () => confirmDialog({
        title: 'Eliminar la ruta guardada',
        message: `«${route.name}» se elimina de la cuenta ${route.owner.email}; sus dispositivos la quitan en la próxima sincronización. Los viajes que la siguieron se conservan.`,
        confirmLabel: 'Eliminar',
        run: () => ctx.api.delete(`/admin/routes/${route.id}`),
      }).then((done) => {
        if (!done) return;
        toast('Ruta eliminada.', 'success');
        ctx.navigate('rutas');
      }),
    })]
    : [];

  const panel = mapPanel(ctx, { className: 'map-frame--tall' });
  const steps = Array.isArray(route.steps) ? route.steps : [];
  clear(ctx.outlet, el('div', { class: 'page' },
    backLink('#/rutas', 'Rutas guardadas'),
    pageHeader(route.name, null, actions),
    el('div', { class: 'page__meta' }, profileCell(route.profile), el('span', { class: 'muted small mono' }, route.id)),
    el('div', { class: 'grid grid--sidebar' },
      panel.element,
      el('div', { class: 'stack' },
        card('Datos de la ruta', facts([
          ['Cuenta', accountCell(ctx, route.owner)],
          ['Distancia', formatDistance(route.distanceMeters)],
          ['Duración estimada', formatDuration(route.durationSeconds)],
          ['Origen', formatCoordinate(route.origin)],
          ['Destino', formatCoordinate(route.destination)],
          ['Región', route.regionCode ?? NONE],
          ['Calculada con', route.provider ?? NONE],
          ['Indicaciones', formatNumber(steps.length)],
          ['Guardada', formatDateTime(route.createdAt, ctx.timeZone)],
        ], 'facts--stacked')),
        card('Viajes', link(`#/viajes?userId=${route.owner.id}&userIdEmail=${encodeURIComponent(route.owner.email)}`,
          'Ver los viajes de la cuenta'))))));

  const result = await panel.ready;
  if (!result || !route.geometry) return;
  const { map } = result;
  setData(map, 'route', { type: 'Feature', geometry: route.geometry, properties: {} });
  setData(map, 'route-ends', collection([
    point(route.origin.longitude, route.origin.latitude, { kind: 'start' }),
    point(route.destination.longitude, route.destination.latitude, { kind: 'end' }),
  ]));
  addLayers(map, [
    { id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': token('--color-map-casing'), 'line-width': 8 } },
    { id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': token('--color-map-track'), 'line-width': 4 } },
    {
      id: 'route-ends',
      type: 'circle',
      source: 'route-ends',
      paint: {
        'circle-radius': 7,
        'circle-color': ['match', ['get', 'kind'], 'start', token('--color-map-start'), token('--color-map-end')],
        'circle-stroke-width': 3,
        'circle-stroke-color': token('--color-map-casing'),
      },
    },
  ]);
  fitTo(map, route.geometry, { padding: 56 });
}
