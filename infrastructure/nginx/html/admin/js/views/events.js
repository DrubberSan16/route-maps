// Eventos: what happened on the platform (trips started and finished, geofence entries and exits,
// regions published) as the integrations receive it, and how each webhook delivery went.
import { badge, card, clear, code, el, emptyState, errorBox, facts, link, loading, table } from '../dom.js';
import {
  countOf,
  EVENT_LABELS,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatNumber,
  formatRelative,
  label,
  NONE,
  shortId,
} from '../format.js';
import { listView, pageHeader } from '../list.js';
import { accountCell, backLink, deliveryBadge, titleCell } from './common.js';

const EVENT_TONES = {
  'trip.started': 'info',
  'trip.finished': 'success',
  'trip.cancelled': 'neutral',
  'geofence.entered': 'info',
  'geofence.exited': 'neutral',
  'region.published': 'success',
  'region.disabled': 'warning',
  'webhook.test': 'neutral',
};

const eventBadge = (type) => badge(label(EVENT_LABELS, type), EVENT_TONES[type] ?? 'neutral');

/** One line about what the event describes, from its data. */
export function eventSummary(event) {
  const data = event.data ?? {};
  const tripName = data.trip ? (data.trip.name || `Viaje ${shortId(data.trip.id)}`) : null;
  switch (event.type) {
    case 'trip.finished':
      return data.trip?.distanceMeters !== null && data.trip?.distanceMeters !== undefined
        ? `${tripName} · ${formatDistance(data.trip.distanceMeters)}`
        : tripName;
    case 'trip.started':
    case 'trip.cancelled':
      return tripName;
    case 'geofence.entered':
      return `${data.geofence?.name ?? 'Geocerca eliminada'} · ${tripName}`;
    case 'geofence.exited':
      return `${data.geofence?.name ?? 'Geocerca eliminada'} · ${tripName}${data.dwellSeconds !== undefined ? ` · ${formatDuration(data.dwellSeconds)} dentro` : ''}`;
    case 'region.published':
    case 'region.disabled':
      return data.region ? `${data.region.name} (${data.region.code}) · versión ${data.region.version}` : NONE;
    case 'webhook.test':
      return data.webhook?.url ? `Prueba a ${data.webhook.url}` : 'Prueba';
    default:
      return NONE;
  }
}

/** Counts of the deliveries of an event, as badges. */
function deliveryCounts(counts) {
  const parts = [
    ['SUCCEEDED', 'entregada', 'entregadas', 'success'],
    ['PENDING', 'por reintentar', 'por reintentar', 'warning'],
    ['SENDING', 'enviándose', 'enviándose', 'info'],
    ['FAILED', 'fallida', 'fallidas', 'danger'],
  ].filter(([status]) => counts[status] > 0);
  if (parts.length === 0) return el('span', { class: 'muted small' }, 'Sin webhooks');
  return el('span', { class: 'badges' }, parts.map(([status, one, many, tone]) => badge(countOf(counts[status], one, many), tone)));
}

export function render(ctx) {
  return ctx.segments[0] ? renderEvent(ctx, ctx.segments[0]) : renderList(ctx);
}

function renderList(ctx) {
  const types = [...ctx.meta.eventTypes, ctx.meta.testEventType];
  listView(ctx, {
    title: 'Eventos',
    description: `Lo que ocurre en la plataforma, tal como lo reciben las integraciones. Se conservan ${formatNumber(ctx.meta.eventsRetentionDays)} días.`,
    filters: [
      { name: 'type', label: 'Tipo', type: 'select', options: [['', 'Todos'], ...types.map((type) => [type, label(EVENT_LABELS, type)])] },
      { name: 'accountId', label: 'Cuenta', type: 'account' },
    ],
    empty: 'Todavía no hay eventos. Aparecen cuando se inicia o termina un viaje, se entra o sale de una geocerca o se publica una región.',
    columns: [
      { label: 'Evento', render: (event) => titleCell(label(EVENT_LABELS, event.type), `#${event.seq}`) },
      { label: 'Detalle', render: (event) => eventSummary(event) },
      {
        label: 'Cuenta',
        render: (event) => (event.account ? accountCell(ctx, event.account) : el('span', { class: 'muted' }, 'Toda la plataforma')),
      },
      { label: 'Entregas', render: (event) => deliveryCounts(event.deliveries) },
      { label: 'Cuándo', className: 'nowrap', render: (event) => formatDateTime(event.createdAt, ctx.timeZone) },
    ],
    rowHref: (event) => `#/eventos/${event.id}`,
    load: (state) => ctx.api.get('/admin/events', {
      type: state.type,
      accountId: state.accountId,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
}

/** Links to what the event is about. */
function related(ctx, event) {
  const data = event.data ?? {};
  const links = [];
  if (data.trip?.id) links.push(link(`#/viajes/${data.trip.id}`, 'Ver el viaje'));
  if (data.geofence?.id) links.push(link(`#/geocercas/${data.geofence.id}`, 'Ver la geocerca'));
  if (data.region?.code) links.push(link('#/regiones', 'Ver las regiones'));
  if (data.integration?.id && ctx.isAdmin) links.push(link(`#/integraciones/${data.integration.id}?tab=entregas`, 'Ver la integración'));
  if (event.accountId && ctx.isAdmin) links.push(link(`#/cuentas/${event.accountId}`, 'Ver la cuenta'));
  return links;
}

async function renderEvent(ctx, id) {
  clear(ctx.outlet, loading());
  let event;
  try {
    event = await ctx.api.get(`/admin/events/${encodeURIComponent(id)}`, undefined, { signal: ctx.signal });
  } catch (error) {
    clear(ctx.outlet, el('div', { class: 'page' }, backLink('#/eventos', 'Eventos'), errorBox(error)));
    return;
  }
  if (ctx.signal.aborted) return;

  const columns = [
    {
      label: 'Integración',
      render: (delivery) => (ctx.isAdmin
        ? el('a', { href: `#/integraciones/${delivery.integration.id}?tab=entregas`, class: 'row-link' }, titleCell(delivery.integration.name, delivery.webhook.url))
        : titleCell(delivery.integration.name, delivery.webhook.url)),
    },
    { label: 'Estado', render: (delivery) => deliveryBadge(delivery.status) },
    { label: 'Intentos', className: 'num', render: (delivery) => formatNumber(delivery.attempts) },
    {
      label: 'Respuesta',
      render: (delivery) => (delivery.responseStatus
        ? `HTTP ${delivery.responseStatus}`
        : delivery.error ? el('span', { class: 'small' }, delivery.error) : NONE),
    },
    {
      label: 'Cuándo',
      className: 'nowrap',
      render: (delivery) => (delivery.status === 'PENDING'
        ? `Próximo intento ${formatRelative(delivery.nextAttemptAt, Date.now(), ctx.timeZone)}`
        : delivery.lastAttemptAt ? formatDateTime(delivery.lastAttemptAt, ctx.timeZone) : NONE),
    },
  ];
  const links = related(ctx, event);

  clear(ctx.outlet, el('div', { class: 'page' },
    backLink('#/eventos', 'Eventos'),
    pageHeader(label(EVENT_LABELS, event.type), eventSummary(event)),
    el('div', { class: 'page__meta' }, eventBadge(event.type), el('span', { class: 'muted small mono' }, event.type)),
    card('Datos', el('div', { class: 'stack' },
      facts([
        ['Número', `#${event.seq}`],
        ['Cuenta', event.account ? accountCell(ctx, event.account) : 'Toda la plataforma (todas las integraciones)'],
        ['Ocurrió', formatDateTime(event.createdAt, ctx.timeZone)],
        ['Identificador', el('span', { class: 'mono small' }, event.id)],
      ]),
      links.length ? el('div', { class: 'actions' }, links) : null)),
    card('Entregas a webhooks', event.deliveries.length
      ? table(columns, event.deliveries, { caption: 'Entregas del evento' })
      : emptyState(event.accountId
        ? 'Ningún webhook que reciba los eventos de esta cuenta estaba suscrito a este tipo de evento.'
        : 'Ninguna integración tenía un webhook suscrito a este tipo de evento.'),
    { className: 'card--flush' }),
    card('Cuerpo del evento', el('div', { class: 'stack' },
      el('p', { class: 'muted small' }, 'Lo que recibe cada webhook (y GET /api/v1/events) para este evento.'),
      code(eventBody(event))))));
}

/** The body of the event as webhooks receive it (the fields of the API's event view, in order). */
const eventBody = ({ id, seq, type, accountId, account, createdAt, data }) =>
  ({ id, seq, type, accountId, account, createdAt, data });
