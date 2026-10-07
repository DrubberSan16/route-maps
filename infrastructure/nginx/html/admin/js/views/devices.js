// Dispositivos: installations of the app of every account (GET /admin/devices).
import { formatNumber, formatRelative, formatDateTime, label, NONE, PLATFORM_LABELS, shortId } from '../format.js';
import { link } from '../dom.js';
import { listView } from '../list.js';
import { accountCell, titleCell } from './common.js';

export function render(ctx) {
  listView(ctx, {
    title: 'Dispositivos',
    description: 'Cada instalación de la app que inició sesión: su cuenta, versión y última conexión.',
    filters: [
      { name: 'q', label: 'Buscar', placeholder: 'Modelo, instalación, versión o correo' },
      {
        name: 'platform',
        label: 'Plataforma',
        type: 'select',
        options: [['', 'Todas'], ...ctx.meta.devicePlatforms.map((platform) => [platform, label(PLATFORM_LABELS, platform)])],
      },
      { name: 'userId', label: 'Cuenta', type: 'account' },
    ],
    empty: 'Todavía no hay dispositivos. Se registran cuando alguien inicia sesión en la app.',
    columns: [
      { label: 'Dispositivo', render: (device) => titleCell(device.model ?? label(PLATFORM_LABELS, device.platform), `Instalación ${shortId(device.installationId)}`) },
      { label: 'Cuenta', render: (device) => accountCell(ctx, device.user) },
      { label: 'Plataforma', render: (device) => label(PLATFORM_LABELS, device.platform) },
      { label: 'Versión', render: (device) => device.appVersion ?? NONE },
      { label: 'Última conexión', className: 'nowrap', render: (device) => formatRelative(device.lastSeenAt, Date.now(), ctx.timeZone) },
      { label: 'Registrado', className: 'nowrap', render: (device) => formatDateTime(device.createdAt, ctx.timeZone) },
      { label: 'Viajes', className: 'num', render: (device) => formatNumber(device.trips) },
      { label: 'Mapas guardados', className: 'num', render: (device) => formatNumber(device.regionsStored) },
      {
        label: 'Sincronización',
        className: 'nowrap',
        render: (device) => link(`#/sincronizacion?${new URLSearchParams({
          deviceId: device.id,
          deviceIdLabel: `${device.model ?? label(PLATFORM_LABELS, device.platform)} · ${shortId(device.installationId)}`,
        })}`, 'Ver operaciones'),
      },
    ],
    load: (state) => ctx.api.get('/admin/devices', {
      q: state.q,
      platform: state.platform,
      userId: state.userId,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
}
