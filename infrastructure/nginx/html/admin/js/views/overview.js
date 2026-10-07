// Resumen: figures of the platform, alerts that need attention, activity of the last 14 days and
// the state of the services (GET /admin/overview, GET /health).
import { barChart } from '../chart.js';
import { alertBox, badge, button, card, clear, el, errorBox, icon, link, loading } from '../dom.js';
import {
  countOf,
  formatDateTime,
  formatDay,
  formatDistance,
  formatDuration,
  formatNumber,
  formatRelative,
  label,
} from '../format.js';
import { pageHeader } from '../list.js';

const REFRESH_MS = 60_000;
/** Deliveries waiting longer than this past their time suggest the worker is not running. */
const LATE_DELIVERY_MS = 5 * 60_000;

const METRICS = [
  { id: 'trips', label: 'Viajes iniciados', series: [{ key: 'tripsStarted', label: 'Viajes', tone: 'primary' }], format: formatNumber },
  { id: 'distance', label: 'Distancia recorrida', series: [{ key: 'distanceMeters', label: 'Distancia', tone: 'success' }], format: formatDistance, integer: false },
  {
    id: 'api',
    label: 'Solicitudes de integraciones',
    series: [
      { key: 'okRequests', label: 'Correctas', tone: 'primary' },
      { key: 'apiErrors', label: 'Con error', tone: 'danger' },
    ],
    format: formatNumber,
  },
  { id: 'events', label: 'Eventos', series: [{ key: 'events', label: 'Eventos', tone: 'primary' }], format: formatNumber },
];

const SERVICE_LABELS = {
  database: ['Base de datos', 'database'],
  redis: ['Caché (Redis)', 'server'],
  routing: ['Cálculo de rutas', 'directions'],
  geocoding: ['Búsqueda de direcciones', 'search'],
};

const SERVICE_STATES = {
  up: ['Funcionando', 'success'],
  down: ['Sin respuesta', 'danger'],
  disabled: ['Desactivado', 'neutral'],
};

/** Engines of /health `providers` (ROUTING_PROVIDER, GEOCODING_PROVIDER). */
const PROVIDER_LABELS = {
  native: 'motor propio',
  valhalla: 'Valhalla',
  osrm: 'OSRM',
  nominatim: 'Nominatim',
  none: 'desactivada',
};

const stat = ({ label, value, detail, href, iconName, tone }) =>
  el(href ? 'a' : 'div', { class: `stat${tone ? ` stat--${tone}` : ''}`, href },
    el('span', { class: 'stat__label' }, icon(iconName), label),
    el('span', { class: 'stat__value' }, value),
    detail ? el('span', { class: 'stat__detail' }, detail) : null);

export async function render(ctx) {
  let metric = METRICS[0].id;
  const updated = el('span', { class: 'muted small', 'aria-live': 'polite' });
  const body = el('div', { class: 'stack' }, loading());
  const refresh = button('Actualizar', { icon: 'refresh', variant: 'secondary', onClick: () => load() });
  clear(ctx.outlet, el('div', { class: 'page' },
    pageHeader('Resumen', 'El estado de la plataforma de un vistazo: viajes, cuentas, integraciones y servicios.',
      [updated, refresh]),
    body));

  let timer = null;
  // Back to a hidden tab: fresh figures at once.
  const onVisible = () => {
    if (!document.hidden && !ctx.signal.aborted) load();
  };
  document.addEventListener('visibilitychange', onVisible);
  ctx.onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });

  async function load() {
    clearTimeout(timer);
    refresh.disabled = true;
    try {
      const [overview, health] = await Promise.all([ctx.api.get('/admin/overview'), ctx.api.health()]);
      if (ctx.signal.aborted) return;
      draw(overview, health);
      updated.textContent = `Actualizado ${formatDateTime(overview.generatedAt, ctx.timeZone)}`;
    } catch (error) {
      if (ctx.signal.aborted) return;
      clear(body, errorBox(error, load));
    } finally {
      refresh.disabled = false;
      // Only while the page is visible: a hidden tab does not need fresh figures.
      if (!ctx.signal.aborted) timer = setTimeout(() => (document.hidden ? null : load()), REFRESH_MS);
    }
  }

  function draw(data, health) {
    const now = Date.now();
    const alerts = [];
    if (health && health.status !== 'ok') {
      alerts.push(alertBox(health.status === 'error' ? 'danger' : 'warning', 'alert',
        health.status === 'error'
          ? 'La base de datos no responde: la plataforma no puede atender solicitudes.'
          : 'Un servicio opcional no responde (mira «Servicios» abajo). La plataforma sigue funcionando con menos funciones.'));
    }
    if (data.webhooks.oldestPendingAt && now - new Date(data.webhooks.oldestPendingAt).getTime() > LATE_DELIVERY_MS) {
      alerts.push(alertBox('warning', 'clock',
        `Hay entregas de webhooks atrasadas desde ${formatRelative(data.webhooks.oldestPendingAt, now, ctx.timeZone)}. ` +
        'Revisa que el proceso worker esté en marcha: make ps y make logs SERVICE=worker.'));
    }
    if (data.webhooks.failing > 0) {
      alerts.push(alertBox('warning', 'webhook',
        `${countOf(data.webhooks.failing, 'webhook activo está fallando', 'webhooks activos están fallando')}: las integraciones no reciben sus eventos.`,
        ctx.isAdmin ? link('#/integraciones', 'Ver integraciones') : null));
    }
    if (data.sync.failedLast24h > 0) {
      alerts.push(alertBox('info', 'sync',
        `${countOf(data.sync.failedLast24h, 'operación sincronizada desde las apps falló', 'operaciones sincronizadas desde las apps fallaron')} en las últimas 24 h.`,
        link('#/sincronizacion?status=FAILED', 'Revisar')));
    }
    if (data.regions.enabled === 0) {
      alerts.push(alertBox('info', 'map',
        'No hay regiones de mapa habilitadas: la app y el visor no tienen mapas que mostrar.',
        link('#/regiones', 'Ver regiones')));
    }

    const stats = el('div', { class: 'stats' },
      stat({
        label: 'Viajes en curso',
        iconName: 'radio',
        value: formatNumber(data.trips.active),
        detail: `${countOf(data.tracking.fixesLastHour, 'posición', 'posiciones')} en la última hora`,
        href: '#/en-vivo',
      }),
      stat({
        label: 'Viajes de hoy',
        iconName: 'route',
        value: formatNumber(data.trips.startedToday),
        detail: `${countOf(data.trips.completedToday, 'terminado', 'terminados')} · ${formatDistance(data.trips.distanceTodayMeters)}`,
        href: '#/viajes',
      }),
      stat({
        label: 'Cuentas activas',
        iconName: 'users',
        value: formatNumber(data.accounts.active),
        detail: `${countOf(data.accounts.administrators, 'administrador', 'administradores')} · ${countOf(data.accounts.operators, 'operador', 'operadores')} · ${countOf(data.accounts.newLast7Days, 'nueva', 'nuevas')} en 7 días`,
        href: ctx.isAdmin ? '#/cuentas' : undefined,
      }),
      stat({
        label: 'Dispositivos',
        iconName: 'smartphone',
        value: formatNumber(data.devices.total),
        detail: `${countOf(data.devices.seenLast24h, 'conectado', 'conectados')} en las últimas 24 h`,
        href: '#/dispositivos',
      }),
      stat({
        label: 'Integraciones activas',
        iconName: 'plug',
        value: formatNumber(data.integrations.active),
        detail: `${countOf(data.integrations.requestsToday, 'solicitud', 'solicitudes')} hoy · ${formatNumber(data.integrations.errorsToday)} con error`,
        href: ctx.isAdmin ? '#/integraciones' : undefined,
      }),
      stat({
        label: 'Webhooks',
        iconName: 'webhook',
        value: formatNumber(data.webhooks.active),
        detail: `${countOf(data.webhooks.pending, 'entrega pendiente', 'entregas pendientes')} · ${countOf(data.webhooks.failedLast24h, 'fallida', 'fallidas')} en 24 h`,
        tone: data.webhooks.failing > 0 ? 'warning' : undefined,
        href: '#/eventos',
      }),
      stat({
        label: 'Geocercas activas',
        iconName: 'hexagon',
        value: formatNumber(data.geodata.activeGeofences),
        detail: `${formatNumber(data.geodata.geofences)} en total`,
        href: '#/geocercas',
      }),
      stat({
        label: 'Regiones habilitadas',
        iconName: 'map',
        value: `${formatNumber(data.regions.enabled)} de ${formatNumber(data.regions.total)}`,
        detail: `${countOf(data.regions.devicesWithRegions, 'dispositivo guarda', 'dispositivos guardan')} mapas sin conexión`,
        href: '#/regiones',
      }),
    );

    const chartSlot = el('div');
    const picker = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Dato del gráfico' },
      METRICS.map((item) => el('button', {
        type: 'button',
        'aria-pressed': String(item.id === metric),
        onclick: (event) => {
          metric = item.id;
          for (const option of picker.children) option.setAttribute('aria-pressed', String(option === event.currentTarget));
          drawChart();
        },
      }, item.label)));
    const drawChart = () => {
      const selected = METRICS.find((item) => item.id === metric);
      const days = data.series.map((day) => ({ ...day, okRequests: Math.max(0, day.apiRequests - day.apiErrors) }));
      clear(chartSlot, barChart({
        caption: `${selected.label}, últimos ${days.length} días`,
        series: selected.series,
        format: selected.format,
        integer: selected.integer ?? true,
        bars: days.map((day) => ({
          label: formatDay(day.day),
          values: selected.series.map((serie) => day[serie.key]),
          title: `${formatDay(day.day)}: ${selected.series.map((serie) => `${serie.label} ${selected.format(day[serie.key])}`).join(' · ')}`,
        })),
      }));
    };
    drawChart();

    const services = health
      ? el('div', { class: 'stack' },
        el('div', { class: 'services' }, Object.entries(SERVICE_LABELS).map(([key, [text, iconName]]) => {
          const [stateText, tone] = SERVICE_STATES[health.services?.[key]] ?? ['Desconocido', 'neutral'];
          return el('div', { class: 'service' }, el('span', { class: 'inline-icon' }, icon(iconName), text), badge(stateText, tone));
        })),
        el('p', { class: 'muted small' },
          `Versión ${health.version} · en marcha hace ${formatDuration(health.uptimeSeconds)} · rutas: ${label(PROVIDER_LABELS, health.providers?.routing)} · búsqueda: ${label(PROVIDER_LABELS, health.providers?.geocoding)}`))
      : alertBox('warning', 'alert', 'No se pudo consultar el estado de los servicios (/health).');

    const geodata = el('dl', { class: 'facts' },
      ...[
        ['Lugares compartidos', formatNumber(data.geodata.sharedPlaces)],
        ['Lugares de cuentas', formatNumber(data.geodata.privatePlaces)],
        ['Rutas guardadas', formatNumber(data.geodata.savedRoutes)],
        ['Cuentas de integraciones', formatNumber(data.accounts.serviceAccounts)],
        ['Ingresaron en 24 h', formatNumber(data.accounts.signedInLast24h)],
        ['Última posición recibida', data.tracking.lastFixAt ? formatRelative(data.tracking.lastFixAt, now, ctx.timeZone) : 'Nunca'],
        ['Operaciones sincronizadas (24 h)', formatNumber(data.sync.operationsLast24h)],
        ['Zona horaria', data.timeZone],
      ].map(([term, value]) => el('div', { class: 'facts__item' }, el('dt', {}, term), el('dd', {}, value))));

    clear(body,
      alerts.length ? el('div', { class: 'alerts' }, alerts) : null,
      stats,
      el('div', { class: 'grid grid--sidebar' },
        card('Actividad de los últimos 14 días', el('div', { class: 'stack' }, picker, chartSlot)),
        el('div', { class: 'stack' },
          card('Servicios', services),
          card('Más datos', geodata))));
  }

  await load();
}
