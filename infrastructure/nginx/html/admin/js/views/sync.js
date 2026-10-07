// Sincronización: operations the apps saved without connection and uploaded later (trips, positions,
// routes, places, stored maps), with the reason of the ones the server could not apply.
import { alertBox, badge, card, clear, code, el, errorBox, facts, link, loading } from '../dom.js';
import {
  formatDateTime,
  label,
  NONE,
  shortId,
  SYNC_ENTITY_LABELS,
  SYNC_OPERATION_LABELS,
  SYNC_STATUS_LABELS,
} from '../format.js';
import { listView, pageHeader } from '../list.js';
import { accountCell, backLink, titleCell } from './common.js';

const STATUS_TONES = { APPLIED: 'success', DUPLICATE: 'neutral', FAILED: 'danger' };
/** Why the server refused an operation, in a few words (the API's own message is the detail). */
const REJECTION_LABELS = {
  VALIDATION_ERROR: 'Datos no válidos',
  SYNC_OPERATION_NOT_SUPPORTED: 'Operación no admitida',
  TRIP_NOT_FOUND: 'El viaje no existe',
  TRIP_NOT_ACTIVE: 'El viaje ya no estaba en curso',
  ROUTE_NOT_FOUND: 'La ruta no existe',
  PLACE_NOT_FOUND: 'El lugar no existe',
  GEOFENCE_NOT_FOUND: 'La geocerca no existe',
  MAP_REGION_NOT_FOUND: 'La región de mapa no existe',
  NOT_FOUND: 'No existe',
  CONFLICT: 'Choca con los datos del servidor',
  FORBIDDEN: 'Sin permiso',
  INVALID_COORDINATES: 'Coordenadas no válidas',
  INVALID_GEOMETRY: 'Forma no válida',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const statusBadge = (status) => badge(label(SYNC_STATUS_LABELS, status), STATUS_TONES[status] ?? 'neutral');
const operationText = (event) => `${label(SYNC_ENTITY_LABELS, event.entity)}: ${label(SYNC_OPERATION_LABELS, event.operation)}`;
const deviceText = (device) => (device ? `Instalación ${shortId(device.installationId)}` : 'Sin dispositivo');

export function render(ctx) {
  return ctx.segments[0] ? renderEvent(ctx, ctx.segments[0]) : renderList(ctx);
}

function renderList(ctx) {
  listView(ctx, {
    title: 'Sincronización',
    description: 'Lo que las apps guardaron sin conexión y subieron después, con el motivo de lo que el servidor no pudo aplicar.',
    filters: [
      { name: 'status', label: 'Resultado', type: 'select', options: [['', 'Todos'], ...ctx.meta.syncStatuses.map((status) => [status, label(SYNC_STATUS_LABELS, status)])] },
      { name: 'entity', label: 'Qué', type: 'select', options: [['', 'Todo'], ...Object.entries(SYNC_ENTITY_LABELS)] },
      { name: 'userId', label: 'Cuenta', type: 'account' },
      { name: 'deviceId', label: 'Dispositivo', type: 'fixed' },
    ],
    empty: 'Todavía no hay operaciones sincronizadas.',
    columns: [
      { label: 'Operación', render: (event) => titleCell(operationText(event), deviceText(event.device)) },
      { label: 'Resultado', render: (event) => statusBadge(event.status) },
      { label: 'Cuenta', render: (event) => accountCell(ctx, event.user) },
      {
        label: 'Motivo',
        render: (event) => (event.errorCode
          ? titleCell(label(REJECTION_LABELS, event.errorCode), event.errorMessage)
          : NONE),
      },
      { label: 'Hecha en el teléfono', className: 'nowrap', render: (event) => (event.clientCreatedAt ? formatDateTime(event.clientCreatedAt, ctx.timeZone) : NONE) },
      { label: 'Recibida', className: 'nowrap', render: (event) => formatDateTime(event.processedAt, ctx.timeZone) },
    ],
    rowHref: (event) => `#/sincronizacion/${event.id}`,
    load: (state) => ctx.api.get('/admin/sync-events', {
      status: state.status,
      entity: state.entity,
      userId: state.userId,
      deviceId: state.deviceId,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
}

async function renderEvent(ctx, id) {
  clear(ctx.outlet, loading());
  let event;
  try {
    event = await ctx.api.get(`/admin/sync-events/${encodeURIComponent(id)}`, undefined, { signal: ctx.signal });
  } catch (error) {
    clear(ctx.outlet, el('div', { class: 'page' }, backLink('#/sincronizacion', 'Sincronización'), errorBox(error)));
    return;
  }
  if (ctx.signal.aborted) return;

  const payloadId = typeof event.payload?.id === 'string' && UUID.test(event.payload.id) ? event.payload.id : null;
  const links = [
    event.entity === 'trip' && payloadId ? link(`#/viajes/${payloadId}`, 'Ver el viaje') : null,
    event.entity === 'route' && payloadId && event.operation !== 'DELETE' ? link(`#/rutas/${payloadId}`, 'Ver la ruta') : null,
    event.device
      ? link(`#/sincronizacion?${new URLSearchParams({ deviceId: event.device.id, deviceIdLabel: deviceText(event.device) })}`, 'Operaciones del mismo dispositivo')
      : null,
    link(`#/sincronizacion?${new URLSearchParams({ userId: event.user.id, userIdEmail: event.user.email })}`, 'Operaciones de la cuenta'),
  ].filter(Boolean);

  clear(ctx.outlet, el('div', { class: 'page' },
    backLink('#/sincronizacion', 'Sincronización'),
    pageHeader(operationText(event), event.user.email),
    el('div', { class: 'page__meta' }, statusBadge(event.status), el('span', { class: 'muted small mono' }, `${event.entity}:${event.operation}`)),
    event.status === 'FAILED'
      ? alertBox('danger', 'alert',
        el('p', {}, el('strong', {}, `${label(REJECTION_LABELS, event.errorCode)}: `), event.errorMessage ?? 'Sin detalle.',
          event.errorCode ? el('span', { class: 'mono small' }, ` (${event.errorCode})`) : null),
        el('p', { class: 'small' }, 'El servidor la rechazó por sus datos, así que la app no vuelve a enviarla. Los errores pasajeros (servidor ocupado o caído) no se guardan aquí: la app los reintenta sola.'))
      : null,
    event.status === 'DUPLICATE'
      ? alertBox('info', 'info', 'La app volvió a enviar una operación que ya estaba aplicada (por ejemplo, tras perder la respuesta). No se aplicó dos veces.')
      : null,
    el('div', { class: 'grid grid--2' },
      card('Datos', el('div', { class: 'stack' },
        facts([
          ['Cuenta', accountCell(ctx, event.user)],
          ['Dispositivo', event.device ? el('span', { class: 'mono small' }, event.device.installationId) : 'Sin dispositivo'],
          ['Hecha en el teléfono', event.clientCreatedAt ? formatDateTime(event.clientCreatedAt, ctx.timeZone) : NONE],
          ['Recibida', formatDateTime(event.processedAt, ctx.timeZone)],
          ['Operación en la app', el('span', { class: 'mono small' }, event.clientOperationId)],
        ], 'facts--stacked'),
        el('div', { class: 'actions' }, links))),
      card('Lo que envió la app', code(event.payload ?? {})))));
}
