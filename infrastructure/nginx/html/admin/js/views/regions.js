// Regiones de mapa: the regions this server publishes (maps, relief, satellite, routing packages)
// and the devices that keep them offline. Administrators enable or disable them and register the
// ones prepared on the server (make prepare-region) without restarting.
import {
  alertBox,
  badge,
  busy,
  button,
  card,
  checkbox,
  clear,
  confirmDialog,
  el,
  emptyState,
  errorBox,
  formDialog,
  loading,
  openDialog,
  table,
  toast,
} from '../dom.js';
import { ASSET_LABELS, countOf, formatBytes, formatDateTime, formatNumber, label } from '../format.js';
import { pageHeader } from '../list.js';
import { activeBadge, titleCell } from './common.js';

export async function render(ctx) {
  const body = el('div', { class: 'stack' }, loading());
  const actions = ctx.isAdmin
    ? [button('Buscar regiones nuevas', { icon: 'refresh', variant: 'primary', onClick: () => syncRegions(ctx) })]
    : [];
  clear(ctx.outlet, el('div', { class: 'page' },
    pageHeader('Regiones de mapa', 'Los mapas que publica este servidor y cuántos dispositivos los guardan para usarlos sin conexión.', actions),
    body));

  let regions;
  try {
    regions = await ctx.api.get('/admin/regions', undefined, { signal: ctx.signal });
  } catch (error) {
    if (!ctx.signal.aborted) clear(body, errorBox(error, () => ctx.reload()));
    return;
  }
  if (ctx.signal.aborted) return;
  if (regions.length === 0) {
    clear(body, card(null, emptyState('Este servidor todavía no tiene regiones. Prepáralas en el servidor con make prepare-region REGION=world (mapa base mundial) y REGION=ecuador (detalle); luego pulsa «Buscar regiones nuevas».')));
    return;
  }

  const total = regions.reduce((sum, region) => sum + (region.mapSize ?? 0) + (region.routingSize ?? 0)
    + region.assets.reduce((assets, asset) => assets + (asset.size ?? 0), 0), 0);
  const columns = [
    { label: 'Región', render: (region) => titleCell(region.name, [region.id, region.city, region.province, region.country].filter(Boolean).join(' · ')) },
    { label: 'Versión', className: 'nowrap', render: (region) => el('span', { class: 'mono' }, region.version) },
    { label: 'Mapa', className: 'num', render: (region) => formatBytes(region.mapSize) },
    { label: 'Rutas sin conexión', className: 'num', render: (region) => (region.routingSize ? formatBytes(region.routingSize) : 'No') },
    {
      label: 'Capas',
      render: (region) => (region.assets.length
        ? el('span', { class: 'badges' }, region.assets.map((asset) => badge(`${label(ASSET_LABELS, asset.kind)} · ${formatBytes(asset.size)}`, 'neutral')))
        : 'Solo mapa'),
    },
    {
      label: 'Dispositivos',
      className: 'num',
      render: (region) => (region.downloads.devices
        ? `${formatNumber(region.downloads.devices)} (${formatNumber(region.downloads.upToDate)} al día)`
        : '0'),
    },
    { label: 'Publicada', className: 'nowrap', render: (region) => formatDateTime(region.updatedAt, ctx.timeZone) },
    { label: 'Estado', render: (region) => activeBadge(region.enabled, 'Habilitada', 'Deshabilitada') },
  ];
  if (ctx.isAdmin) {
    columns.push({
      label: 'Acciones',
      className: 'actions-cell',
      render: (region) => button(region.enabled ? 'Deshabilitar' : 'Habilitar', {
        icon: 'power',
        variant: region.enabled ? 'ghost' : 'secondary',
        onClick: (event) => toggleRegion(ctx, region, event.currentTarget),
      }),
    });
  }

  clear(body,
    regions.some((region) => !region.enabled)
      ? alertBox('info', 'info', 'Las regiones deshabilitadas no se muestran en el visor ni se ofrecen a la app; los dispositivos que ya las guardaron las conservan.')
      : null,
    card(`${countOf(regions.length, 'región', 'regiones')} · ${formatBytes(total)} publicados`, table(columns, regions, { caption: 'Regiones de mapa' }), { className: 'card--flush' }));
}

async function toggleRegion(ctx, region, control) {
  if (region.enabled) {
    const confirmed = await confirmDialog({
      title: 'Deshabilitar la región',
      message: `«${region.name}» deja de mostrarse en el visor y de ofrecerse a la app. Las integraciones reciben region.disabled. Puedes volver a habilitarla cuando quieras.`,
      confirmLabel: 'Deshabilitar',
      run: () => ctx.api.patch(`/maps/regions/${encodeURIComponent(region.id)}`, { enabled: false }),
    });
    if (!confirmed) return;
    toast('Región deshabilitada.', 'success');
    ctx.reload();
    return;
  }
  await busy(control, async () => {
    await ctx.api.patch(`/maps/regions/${encodeURIComponent(region.id)}`, { enabled: true });
    toast('Región habilitada.', 'success');
    ctx.reload();
  });
}

/** Registers the regions prepared in the map storage of the server (POST /maps/regions/sync). */
async function syncRegions(ctx) {
  const force = checkbox('Recalcular las sumas de verificación', { hint: 'Más lento: lee de nuevo todos los archivos aunque no hayan cambiado.' });
  const report = await formDialog({
    title: 'Buscar regiones nuevas',
    description: 'Registra las regiones preparadas en el servidor (make prepare-region) y deshabilita las que ya no tienen archivos.',
    submitLabel: 'Buscar',
    fields: [force],
    submit: () => ctx.api.post('/maps/regions/sync', { force: force.querySelector('input').checked }),
  });
  if (!report) return;
  const line = (title, items) => (items.length ? el('p', {}, el('strong', {}, `${title}: `), items.join(', ')) : null);
  await openDialog({
    title: 'Resultado',
    body: el('div', { class: 'stack' },
      report.registered.length + report.disabled.length === 0 && report.errors.length === 0
        ? el('p', {}, 'No hay cambios: todas las regiones ya estaban registradas.')
        : null,
      line('Registradas o actualizadas', report.registered),
      line('Deshabilitadas (sin archivos)', report.disabled),
      line('Sin cambios', report.unchanged ?? []),
      report.errors.length
        ? alertBox('danger', 'alert', el('div', {}, report.errors.map((error) => el('p', {}, `${error.code}: ${error.message}`))))
        : null),
    actions: [(close) => button('Listo', { variant: 'primary', onClick: () => close(true) })],
  });
  ctx.reload();
}
