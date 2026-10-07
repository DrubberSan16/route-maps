// Geocercas: areas of every account whose entries and exits become events (geofence.entered /
// geofence.exited). The editor draws a circle (click its centre) or a polygon (click its
// vertices) on the map; without a map the shape can be typed.
import { accountPicker } from '../pickers.js';
import {
  alertBox,
  busy,
  button,
  card,
  checkbox,
  clear,
  confirmDialog,
  el,
  errorBox,
  field,
  input,
  loading,
  textarea,
  toast,
} from '../dom.js';
import { errorText, formatDateTime, formatDistance, formatNumber, GEOFENCE_TYPE_LABELS, label } from '../format.js';
import { listView, pageHeader } from '../list.js';
import { addLayers, circlePolygon, collection, fitTo, point, polygonFrom, setData, token } from '../map.js';
import { accountCell, activeBadge, backLink, mapPanel, titleCell } from './common.js';

const MAX_RADIUS_METERS = 100_000;

export function render(ctx) {
  const [id] = ctx.segments;
  if (id === 'nueva') return renderEditor(ctx, null);
  return id ? renderEditor(ctx, id) : renderList(ctx);
}

const shapeText = (geofence) => (geofence.type === 'CIRCLE'
  ? `Círculo · radio ${formatDistance(geofence.radiusMeters)}`
  : `Polígono · ${formatNumber(Math.max(0, (geofence.geometry?.coordinates?.[0]?.length ?? 1) - 1))} vértices`);

function renderList(ctx) {
  listView(ctx, {
    title: 'Geocercas',
    description: 'Zonas de cada cuenta. Al entrar o salir de ellas durante un viaje se generan eventos para las integraciones.',
    actions: [button('Nueva geocerca', {
      icon: 'plus',
      variant: 'primary',
      onClick: () => ctx.navigate(['geocercas', 'nueva'], { userId: ctx.query.userId, userIdEmail: ctx.query.userIdEmail }),
    })],
    filters: [
      { name: 'q', label: 'Buscar', placeholder: 'Nombre o descripción' },
      { name: 'active', label: 'Estado', type: 'select', options: [['', 'Todas'], ['true', 'Activas'], ['false', 'Inactivas']] },
      { name: 'userId', label: 'Cuenta', type: 'account' },
    ],
    empty: 'Todavía no hay geocercas. Crea una para recibir eventos cuando un viaje entra o sale de ella.',
    columns: [
      { label: 'Geocerca', render: (geofence) => titleCell(geofence.name, geofence.description) },
      { label: 'Cuenta', render: (geofence) => accountCell(ctx, geofence.owner) },
      { label: 'Forma', render: shapeText },
      { label: 'Estado', render: (geofence) => activeBadge(geofence.active, 'Activa', 'Inactiva') },
      { label: 'Actualizada', className: 'nowrap', render: (geofence) => formatDateTime(geofence.updatedAt, ctx.timeZone) },
    ],
    rowHref: (geofence) => `#/geocercas/${geofence.id}`,
    load: (state) => ctx.api.get('/admin/geofences', {
      q: state.q,
      active: state.active,
      userId: state.userId,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
}

async function renderEditor(ctx, id) {
  let geofence = null;
  if (id) {
    clear(ctx.outlet, loading());
    try {
      geofence = await ctx.api.get(`/admin/geofences/${encodeURIComponent(id)}`, undefined, { signal: ctx.signal });
    } catch (error) {
      clear(ctx.outlet, el('div', { class: 'page' }, backLink('#/geocercas', 'Geocercas'), errorBox(error)));
      return;
    }
    if (ctx.signal.aborted) return;
  }

  // Shape being edited.
  const shape = {
    type: geofence?.type ?? 'CIRCLE',
    center: geofence?.center ?? null,
    radius: geofence?.radiusMeters ?? 200,
    vertices: geofence?.type === 'POLYGON' ? geofence.geometry.coordinates[0].slice(0, -1) : [],
  };

  const owner = geofence ? null : accountPicker(ctx, {
    required: true,
    placeholder: 'Correo de la cuenta dueña',
    // Opened from a list filtered by an account: that account.
    value: ctx.query.userId ? { id: ctx.query.userId, email: ctx.query.userIdEmail ?? ctx.query.userId } : null,
  });
  const name = input({ required: true, maxlength: 120, value: geofence?.name ?? '' });
  const description = textarea({ maxlength: 1000, rows: 2, class: 'input' });
  description.value = geofence?.description ?? '';
  const latitude = input({ type: 'number', step: 'any', min: -90, max: 90, inputmode: 'decimal' });
  const longitude = input({ type: 'number', step: 'any', min: -180, max: 180, inputmode: 'decimal' });
  const radius = input({ type: 'number', min: 1, max: MAX_RADIUS_METERS, step: 1, value: shape.radius, inputmode: 'numeric' });
  const polygonText = textarea({ rows: 4, spellcheck: 'false', placeholder: '[[-79.90, -2.13], [-79.89, -2.13], [-79.89, -2.12]]' });
  const active = checkbox('Activa', { checked: geofence?.active ?? true, hint: 'Solo las geocercas activas generan eventos.' });
  const metadata = textarea({ rows: 3, spellcheck: 'false', placeholder: '{ "cliente": "PED-2041" }' });
  metadata.value = geofence?.metadata ? JSON.stringify(geofence.metadata, null, 2) : '';
  const vertexInfo = el('p', { class: 'field__hint' });
  const status = el('div', { class: 'form__status', role: 'alert' });

  const typeButtons = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Forma' },
    ['CIRCLE', 'POLYGON'].map((type) => el('button', {
      type: 'button',
      'aria-pressed': String(shape.type === type),
      onclick: () => {
        shape.type = type;
        update();
      },
    }, label(GEOFENCE_TYPE_LABELS, type))));
  const circleFields = el('div', { class: 'form__fields' },
    field('Latitud del centro', latitude), field('Longitud del centro', longitude),
    field('Radio (metros)', radius, { hint: `Entre 1 y ${formatNumber(MAX_RADIUS_METERS)} m.`, wide: true }));
  const polygonFields = el('div', { class: 'stack' },
    vertexInfo,
    el('div', { class: 'actions' },
      button('Quitar el último punto', { icon: 'chevron-left', variant: 'ghost', onClick: () => { shape.vertices.pop(); update(); } }),
      button('Borrar la forma', { icon: 'trash', variant: 'ghost', onClick: () => { shape.vertices = []; update(); } })),
    el('details', {},
      el('summary', { class: 'small' }, 'Escribir o pegar las coordenadas'),
      field('Vértices [longitud, latitud]', polygonText, { hint: 'Una lista JSON de pares; el polígono se cierra solo.' })));

  const setCenterInputs = () => {
    latitude.value = shape.center ? String(shape.center.latitude) : '';
    longitude.value = shape.center ? String(shape.center.longitude) : '';
  };
  setCenterInputs();
  polygonText.value = shape.vertices.length ? JSON.stringify(shape.vertices) : '';

  const panel = mapPanel(ctx, {
    className: 'map-frame--tall',
    hint: '',
    onClick: (event) => {
      const { lng, lat } = event.lngLat;
      if (shape.type === 'CIRCLE') {
        shape.center = { latitude: round(lat), longitude: round(lng) };
        setCenterInputs();
      } else {
        shape.vertices.push([round(lng), round(lat)]);
        polygonText.value = JSON.stringify(shape.vertices);
      }
      update();
    },
  });

  latitude.addEventListener('input', readCenter);
  longitude.addEventListener('input', readCenter);
  radius.addEventListener('input', () => {
    shape.radius = Number(radius.value);
    update();
  });
  polygonText.addEventListener('change', () => {
    try {
      const parsed = JSON.parse(polygonText.value || '[]');
      const vertices = Array.isArray(parsed?.coordinates) ? parsed.coordinates[0] : Array.isArray(parsed?.[0]?.[0]) ? parsed[0] : parsed;
      if (!Array.isArray(vertices) || !vertices.every((pair) => Array.isArray(pair) && pair.length >= 2 && pair.every(Number.isFinite))) throw new Error();
      const closed = vertices.length > 3 && vertices[0][0] === vertices.at(-1)[0] && vertices[0][1] === vertices.at(-1)[1];
      shape.vertices = (closed ? vertices.slice(0, -1) : vertices).map(([lng, lat]) => [lng, lat]);
      update({ fit: true });
    } catch {
      toast('Las coordenadas no son una lista válida de pares [longitud, latitud].', 'warning');
    }
  });

  function readCenter() {
    const lat = Number(latitude.value);
    const lng = Number(longitude.value);
    shape.center = latitude.value !== '' && longitude.value !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { latitude: lat, longitude: lng }
      : null;
    update();
  }

  /** Geometry of the shape being edited (null while incomplete). */
  function geometry() {
    if (shape.type === 'CIRCLE') {
      return shape.center && shape.radius > 0 && shape.radius <= MAX_RADIUS_METERS ? circlePolygon(shape.center, shape.radius) : null;
    }
    return polygonFrom(shape.vertices);
  }

  async function update({ fit = false } = {}) {
    for (const option of typeButtons.children) {
      option.setAttribute('aria-pressed', String(option.textContent === label(GEOFENCE_TYPE_LABELS, shape.type)));
    }
    circleFields.hidden = shape.type !== 'CIRCLE';
    polygonFields.hidden = shape.type !== 'POLYGON';
    vertexInfo.textContent = shape.vertices.length < 3
      ? `${formatNumber(shape.vertices.length)} de al menos 3 puntos. Haz clic en el mapa para agregar los vértices en orden.`
      : `${formatNumber(shape.vertices.length)} vértices. Sigue haciendo clic para agregar más.`;
    panel.setHint(shape.type === 'CIRCLE'
      ? 'Haz clic en el mapa para poner el centro del círculo.'
      : 'Haz clic en el mapa para agregar cada vértice del polígono.');
    const result = await panel.ready;
    if (!result) return;
    const { map } = result;
    const area = geometry();
    setData(map, 'shape', area ? { type: 'Feature', geometry: area, properties: {} } : collection([]));
    setData(map, 'shape-points', collection(shape.type === 'CIRCLE'
      ? (shape.center ? [point(shape.center.longitude, shape.center.latitude)] : [])
      : shape.vertices.map(([lng, lat]) => point(lng, lat))));
    addLayers(map, [
      { id: 'shape-fill', type: 'fill', source: 'shape', paint: { 'fill-color': token('--color-map-shape-fill') } },
      { id: 'shape-line', type: 'line', source: 'shape', paint: { 'line-color': token('--color-map-shape'), 'line-width': 2.5 } },
      {
        id: 'shape-points',
        type: 'circle',
        source: 'shape-points',
        paint: { 'circle-radius': 5, 'circle-color': token('--color-map-shape'), 'circle-stroke-width': 2, 'circle-stroke-color': token('--color-map-casing') },
      },
    ]);
    if (fit && area) fitTo(map, area, { padding: 64 });
  }

  const submit = button(geofence ? 'Guardar cambios' : 'Crear geocerca', { type: 'submit', variant: 'primary' });
  const form = el('form', { class: 'form', novalidate: true },
    geofence ? null : field('Cuenta', owner, { hint: 'Los eventos de la geocerca son de los viajes de esta cuenta.' }),
    field('Nombre', name),
    field('Descripción', description),
    el('fieldset', { class: 'field' }, el('legend', { class: 'field__label' }, 'Forma'), typeButtons),
    circleFields,
    polygonFields,
    active,
    el('details', {}, el('summary', { class: 'small' }, 'Datos de la aplicación (JSON, opcional)'),
      field('Metadatos', metadata, { hint: 'Se incluyen en los eventos de la geocerca. Ej.: el código del cliente.' })),
    status,
    el('div', { class: 'form__actions' }, submit));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clear(status);
    busy(submit, async () => {
      try {
        const body = buildBody();
        if (geofence) {
          await ctx.api.patch(`/admin/geofences/${geofence.id}`, body);
          toast('Geocerca guardada.', 'success');
          ctx.reload();
        } else {
          const created = await ctx.api.post('/admin/geofences', body);
          toast('Geocerca creada.', 'success');
          ctx.navigate(['geocercas', created.id]);
        }
      } catch (error) {
        clear(status, el('p', { class: 'form__error' }, errorText(error)));
      }
    });
  });

  function buildBody() {
    if (!geofence && !owner.selected()) throw new Error('Elige la cuenta dueña de la geocerca.');
    if (!name.value.trim()) throw new Error('Escribe un nombre.');
    let meta;
    if (metadata.value.trim()) {
      try {
        meta = JSON.parse(metadata.value);
      } catch {
        meta = null;
      }
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Los metadatos deben ser un objeto JSON, por ejemplo { "cliente": "A-1" }.');
    }
    const body = {
      ...(geofence ? {} : { accountId: owner.selected().id }),
      name: name.value.trim(),
      description: description.value.trim(),
      type: shape.type,
      active: active.querySelector('input').checked,
      ...(meta ? { metadata: meta } : geofence?.metadata ? { metadata: {} } : {}),
    };
    if (shape.type === 'CIRCLE') {
      if (!shape.center) throw new Error('Pon el centro del círculo: haz clic en el mapa o escribe la latitud y la longitud.');
      if (!(shape.radius >= 1 && shape.radius <= MAX_RADIUS_METERS)) throw new Error(`El radio debe estar entre 1 y ${formatNumber(MAX_RADIUS_METERS)} metros.`);
      body.center = shape.center;
      body.radiusMeters = shape.radius;
    } else {
      const polygon = polygonFrom(shape.vertices);
      if (!polygon) throw new Error('El polígono necesita al menos 3 puntos.');
      body.polygon = polygon;
    }
    return body;
  }

  const actions = geofence
    ? [
      button(geofence.active ? 'Desactivar' : 'Activar', {
        icon: 'power',
        onClick: (event) => busy(event.currentTarget, async () => {
          await ctx.api.patch(`/admin/geofences/${geofence.id}`, { active: !geofence.active });
          toast(geofence.active ? 'Geocerca desactivada.' : 'Geocerca activada.', 'success');
          ctx.reload();
        }),
      }),
      button('Eliminar', {
        icon: 'trash',
        variant: 'danger',
        onClick: () => confirmDialog({
          title: 'Eliminar la geocerca',
          message: `«${geofence.name}» deja de generar eventos y desaparece de la app de su cuenta. Los eventos ya enviados se conservan.`,
          confirmLabel: 'Eliminar',
          run: () => ctx.api.delete(`/admin/geofences/${geofence.id}`),
        }).then((done) => {
          if (!done) return;
          toast('Geocerca eliminada.', 'success');
          ctx.navigate('geocercas');
        }),
      }),
    ]
    : [];

  clear(ctx.outlet, el('div', { class: 'page' },
    backLink('#/geocercas', 'Geocercas'),
    pageHeader(geofence ? geofence.name : 'Nueva geocerca',
      geofence ? null : 'Dibuja la zona en el mapa y elige la cuenta cuyos viajes la vigilan.', actions),
    geofence
      ? el('div', { class: 'page__meta' }, activeBadge(geofence.active, 'Activa', 'Inactiva'),
        el('span', { class: 'muted small' }, 'Cuenta: '), accountCell(ctx, geofence.owner),
        el('span', { class: 'muted small' }, `Actualizada ${formatDateTime(geofence.updatedAt, ctx.timeZone)}`))
      : null,
    el('div', { class: 'grid grid--sidebar' },
      panel.element,
      card(geofence ? 'Datos de la geocerca' : 'Datos', form)),
    geofence ? null : alertBox('info', 'info', 'Las geocercas se revisan con cada posición que llega de un viaje de la cuenta: al entrar o salir se emite geofence.entered o geofence.exited.')));

  await update({ fit: true });
}

const round = (value) => Math.round(value * 1e6) / 1e6;
