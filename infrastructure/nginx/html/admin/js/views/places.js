// Lugares: the shared places every account sees in its searches (managed here) and, read-only,
// the private places of the accounts (GET/POST/PATCH/DELETE /admin/places).
import {
  badge,
  button,
  confirmDialog,
  el,
  facts,
  field,
  formDialog,
  input,
  openDialog,
  textarea,
  toast,
} from '../dom.js';
import { countOf, formatCoordinate, formatDateTime, formatNumber, NONE } from '../format.js';
import { listView } from '../list.js';
import { addLayers, collection, point, setData, token } from '../map.js';
import { mapPanel } from './common.js';

export function render(ctx) {
  const list = listView(ctx, {
    title: 'Lugares',
    description: 'Los lugares compartidos aparecen en las búsquedas de todas las cuentas (bodegas, clientes, puntos de entrega). Los lugares de cada cuenta se ven aquí, pero solo su dueño los cambia.',
    actions: [button('Nuevo lugar compartido', {
      icon: 'plus',
      variant: 'primary',
      onClick: () => editPlace(ctx, null).then((saved) => saved && list.reload()),
    })],
    filters: [
      { name: 'q', label: 'Buscar', placeholder: 'Nombre, categoría o dirección' },
      { name: 'scope', label: 'Alcance', type: 'select', options: [['', 'Todos'], ['shared', 'Compartidos'], ['private', 'De las cuentas']] },
      { name: 'userId', label: 'Cuenta', type: 'account' },
    ],
    empty: 'Todavía no hay lugares. Crea un lugar compartido para que todas las cuentas lo encuentren.',
    columns: [
      {
        label: 'Lugar',
        render: (place) => el('button', {
          type: 'button',
          class: 'link-button cell-title',
          onclick: () => (place.owner ? showPlace(ctx, place) : editPlace(ctx, place).then((saved) => saved && list.reload())),
        }, el('strong', {}, place.name), place.address ? el('small', {}, place.address) : null),
      },
      { label: 'Categoría', render: (place) => place.category ?? NONE },
      { label: 'Alcance', render: (place) => (place.owner ? badge(place.owner.email, 'neutral') : badge('Compartido', 'info')) },
      { label: 'Favorito de', className: 'num', render: (place) => countOf(place.favorites, 'cuenta', 'cuentas') },
      { label: 'Actualizado', className: 'nowrap', render: (place) => formatDateTime(place.updatedAt, ctx.timeZone) },
    ],
    load: (state) => ctx.api.get('/admin/places', {
      q: state.q,
      // An account filter means its private places.
      scope: state.userId ? 'private' : state.scope || 'all',
      userId: state.userId,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
}

/** A screen context for a map shown inside a dialog: cleaned up when the dialog closes. */
function dialogContext(ctx) {
  const controller = new AbortController();
  const cleanups = [];
  ctx.onCleanup(() => controller.abort());
  return {
    ...ctx,
    signal: controller.signal,
    onCleanup: (fn) => cleanups.push(fn),
    close: () => {
      controller.abort();
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

function drawPin(map, location) {
  setData(map, 'pin', collection(location ? [point(location.longitude, location.latitude)] : []));
  addLayers(map, [{
    id: 'pin',
    type: 'circle',
    source: 'pin',
    paint: { 'circle-radius': 9, 'circle-color': token('--color-map-end'), 'circle-stroke-width': 3, 'circle-stroke-color': token('--color-map-casing') },
  }]);
}

/** Creates (place null) or edits a shared place. Resolves true when something changed. */
async function editPlace(ctx, place) {
  const inner = dialogContext(ctx);
  let location = place?.location ?? null;
  const name = input({ required: true, maxlength: 120, value: place?.name ?? '' });
  const category = input({ maxlength: 60, value: place?.category ?? '', placeholder: 'Bodega, cliente, oficina…' });
  const address = input({ maxlength: 300, value: place?.address ?? '' });
  const description = textarea({ maxlength: 1000, rows: 2, class: 'input' });
  description.value = place?.description ?? '';
  const latitude = input({ type: 'number', step: 'any', min: -90, max: 90, required: true, value: location?.latitude ?? '', inputmode: 'decimal' });
  const longitude = input({ type: 'number', step: 'any', min: -180, max: 180, required: true, value: location?.longitude ?? '', inputmode: 'decimal' });
  const panel = mapPanel(inner, {
    className: 'map-frame--dialog',
    hint: 'Haz clic en el mapa para ubicar el lugar.',
    bounds: location ? [location.longitude - 0.01, location.latitude - 0.01, location.longitude + 0.01, location.latitude + 0.01] : undefined,
    onClick: async (event) => {
      location = { latitude: round(event.lngLat.lat), longitude: round(event.lngLat.lng) };
      latitude.value = String(location.latitude);
      longitude.value = String(location.longitude);
      const result = await panel.ready;
      if (result) drawPin(result.map, location);
    },
  });
  const readLocation = async () => {
    const lat = Number(latitude.value);
    const lng = Number(longitude.value);
    location = latitude.value !== '' && longitude.value !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { latitude: lat, longitude: lng }
      : null;
    const result = await panel.ready;
    if (result) drawPin(result.map, location);
  };
  latitude.addEventListener('change', readLocation);
  longitude.addEventListener('change', readLocation);
  panel.ready.then((result) => result && drawPin(result.map, location));

  let deleted = false;
  const saved = await formDialog({
    title: place ? 'Editar lugar compartido' : 'Nuevo lugar compartido',
    description: 'Todas las cuentas lo encuentran en la búsqueda de la app y del visor.',
    size: 'lg',
    submitLabel: place ? 'Guardar cambios' : 'Crear lugar',
    fields: [
      field('Nombre', name),
      field('Categoría', category),
      field('Dirección', address, { wide: true }),
      field('Descripción', description, { wide: true }),
      el('div', { class: 'field--wide' }, panel.element),
      field('Latitud', latitude),
      field('Longitud', longitude),
      place
        ? el('div', { class: 'field--wide actions' }, button('Eliminar este lugar', {
          icon: 'trash',
          variant: 'ghost',
          onClick: async (event) => {
            const dialog = event.currentTarget.closest('dialog');
            const confirmed = await confirmDialog({
              title: 'Eliminar el lugar compartido',
              message: `«${place.name}» desaparece de las búsquedas de todas las cuentas${place.favorites ? ` y de los favoritos de ${countOf(place.favorites, 'cuenta', 'cuentas')}` : ''}.`,
              confirmLabel: 'Eliminar',
              run: () => ctx.api.delete(`/admin/places/${place.id}`),
            });
            if (confirmed) {
              deleted = true;
              dialog.close();
            }
          },
        }))
        : null,
    ],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('Escribe el nombre y ubica el lugar (latitud y longitud).');
      if (!location) throw new Error('Ubica el lugar: haz clic en el mapa o escribe la latitud y la longitud.');
      const body = {
        name: name.value.trim(),
        // Emptied fields are cleared.
        category: category.value.trim() || null,
        address: address.value.trim() || null,
        description: description.value.trim() || null,
        location,
      };
      return place ? ctx.api.patch(`/admin/places/${place.id}`, body) : ctx.api.post('/admin/places', body);
    },
  });
  inner.close();
  if (deleted) {
    toast('Lugar eliminado.', 'success');
    return true;
  }
  if (saved) toast(place ? 'Lugar guardado.' : 'Lugar creado.', 'success');
  return Boolean(saved);
}

/** A private place of an account: only its owner changes it, from the app. */
async function showPlace(ctx, place) {
  const inner = dialogContext(ctx);
  const { location } = place;
  const panel = mapPanel(inner, {
    className: 'map-frame--dialog',
    bounds: [location.longitude - 0.01, location.latitude - 0.01, location.longitude + 0.01, location.latitude + 0.01],
  });
  panel.ready.then((result) => result && drawPin(result.map, location));
  await openDialog({
    title: place.name,
    description: `Lugar de ${place.owner.email}. Solo esa cuenta lo cambia, desde la app.`,
    size: 'lg',
    body: el('div', { class: 'stack' },
      panel.element,
      facts([
        ['Categoría', place.category ?? NONE],
        ['Dirección', place.address ?? NONE],
        ['Coordenadas', formatCoordinate(location)],
        ['Favorito de', countOf(place.favorites, 'cuenta', 'cuentas')],
        ['Creado', formatDateTime(place.createdAt, ctx.timeZone)],
        ['Descripción', place.description ?? NONE],
      ])),
    actions: [(close) => button('Cerrar', { variant: 'primary', onClick: () => close(true) })],
  });
  inner.close();
}

const round = (value) => Math.round(value * 1e6) / 1e6;

