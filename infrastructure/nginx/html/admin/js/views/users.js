// Cuentas (administrators only): people who use the app or the panel, and the accounts
// integrations act as. Create, change role or state, reset passwords, close sessions, delete.
import {
  badge,
  busy,
  button,
  card,
  clear,
  confirmDialog,
  el,
  emptyState,
  errorBox,
  facts,
  field,
  formDialog,
  input,
  link,
  loading,
  secretDialog,
  select,
  table,
  toast,
} from '../dom.js';
import {
  countOf,
  formatDateTime,
  formatNumber,
  formatRelative,
  label,
  NONE,
  PLATFORM_LABELS,
  ROLE_LABELS,
  shortId,
} from '../format.js';
import { listView, pageHeader } from '../list.js';
import { activeBadge, backLink, titleCell } from './common.js';

const ROLE_TONES = { ADMIN: 'info', OPERATOR: 'warning', USER: 'neutral' };
const roleBadge = (role) => badge(label(ROLE_LABELS, role), ROLE_TONES[role] ?? 'neutral');

const ROLE_HINTS = {
  USER: 'Usa la app: sus viajes, lugares, rutas y geocercas. No entra al panel.',
  OPERATOR: 'Entra al panel para la operación diaria: mapa en vivo, viajes, geocercas y lugares.',
  ADMIN: 'Todo lo anterior y además cuentas, integraciones, regiones y auditoría.',
};

export function render(ctx) {
  return ctx.segments[0] ? renderAccount(ctx, ctx.segments[0]) : renderList(ctx);
}

function roleOptions(ctx) {
  return ctx.meta.roles.map((role) => [role, label(ROLE_LABELS, role)]);
}

function renderList(ctx) {
  const view = listView(ctx, {
    title: 'Cuentas',
    description: 'Personas que usan la app o el panel, y las cuentas con las que actúan las integraciones.',
    actions: [button('Nueva cuenta', { icon: 'plus', variant: 'primary', onClick: () => createAccount(ctx).then((created) => created && ctx.navigate(['cuentas', created.id])) })],
    filters: [
      { name: 'q', label: 'Buscar', placeholder: 'Correo o nombre' },
      { name: 'role', label: 'Rol', type: 'select', options: [['', 'Todos'], ...roleOptions(ctx)] },
      { name: 'active', label: 'Estado', type: 'select', options: [['', 'Todas'], ['true', 'Activas'], ['false', 'Deshabilitadas']] },
      { name: 'kind', label: 'Tipo', type: 'select', options: [['', 'Personas'], ['service', 'Integraciones'], ['all', 'Todas']] },
    ],
    columns: [
      { label: 'Cuenta', render: (user) => titleCell(user.name || user.email, user.email) },
      { label: 'Rol', render: (user) => (user.serviceAccount ? badge('Integración', 'info') : roleBadge(user.role)) },
      { label: 'Estado', render: (user) => activeBadge(user.active) },
      { label: 'Último ingreso', className: 'nowrap', render: (user) => (user.serviceAccount ? NONE : user.lastLoginAt ? formatRelative(user.lastLoginAt, Date.now(), ctx.timeZone) : 'Nunca') },
      { label: 'Dispositivos', className: 'num', render: (user) => formatNumber(user.counts.devices) },
      { label: 'Viajes', className: 'num', render: (user) => formatNumber(user.counts.trips) },
      { label: 'Creada', className: 'nowrap', render: (user) => formatDateTime(user.createdAt, ctx.timeZone) },
    ],
    rowHref: (user) => `#/cuentas/${user.id}`,
    load: (state) => ctx.api.get('/admin/users', {
      q: state.q,
      role: state.role,
      active: state.active,
      kind: state.kind || 'people',
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
  return view;
}

/** "Nueva cuenta": without a password the platform generates a temporary one, shown once. */
async function createAccount(ctx) {
  const email = input({ type: 'email', required: true, maxlength: 254, autocomplete: 'off', spellcheck: 'false' });
  const name = input({ required: true, maxlength: 120, autocomplete: 'off' });
  const role = select(roleOptions(ctx), 'USER');
  const roleHint = el('p', { class: 'field__hint' }, ROLE_HINTS.USER);
  role.addEventListener('change', () => { roleHint.textContent = ROLE_HINTS[role.value]; });
  const password = input({ type: 'password', minlength: 8, maxlength: 128, autocomplete: 'new-password' });
  const result = await formDialog({
    title: 'Nueva cuenta',
    description: 'La persona entra con su correo y la contraseña que le entregues.',
    submitLabel: 'Crear cuenta',
    fields: [
      field('Correo', email),
      field('Nombre', name),
      el('div', { class: 'field field--wide' }, field('Rol', role), roleHint),
      field('Contraseña (opcional)', password, { hint: 'Déjala vacía para generar una contraseña temporal segura.', wide: true }),
    ],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('Revisa los campos marcados.');
      return ctx.api.post('/admin/users', {
        email: email.value.trim(),
        name: name.value.trim(),
        role: role.value,
        ...(password.value ? { password: password.value } : {}),
      });
    },
  });
  if (!result) return null;
  toast('Cuenta creada.', 'success');
  if (result.temporaryPassword) {
    await secretDialog({
      title: 'Contraseña temporal',
      description: `Entrégala a ${result.user.email} por un canal seguro. ${changeHint(result.user.role)}`,
      secret: result.temporaryPassword,
    });
  }
  return result.user;
}

async function renderAccount(ctx, id) {
  clear(ctx.outlet, loading());
  let user;
  try {
    user = await ctx.api.get(`/admin/users/${encodeURIComponent(id)}`, undefined, { signal: ctx.signal });
  } catch (error) {
    clear(ctx.outlet, el('div', { class: 'page' }, backLink('#/cuentas', 'Cuentas'), errorBox(error)));
    return;
  }
  if (ctx.signal.aborted) return;
  const self = user.id === ctx.user.id;
  const after = (message) => () => {
    toast(message, 'success');
    ctx.reload();
  };

  const actions = [];
  actions.push(button('Editar', { icon: 'edit', onClick: () => editAccount(ctx, user, self).then((saved) => saved && after('Cuenta actualizada.')()) }));
  if (!self) {
    actions.push(user.active
      ? button('Deshabilitar', {
        icon: 'power',
        onClick: () => confirmDialog({
          title: 'Deshabilitar la cuenta',
          message: `${user.email} no podrá entrar a la app ni al panel, y sus sesiones abiertas se cierran ahora mismo.${user.serviceAccount ? ' Las llaves de API de sus integraciones dejan de funcionar.' : ''}`,
          confirmLabel: 'Deshabilitar',
          run: () => ctx.api.patch(`/admin/users/${user.id}`, { active: false }),
        }).then((done) => done && after('Cuenta deshabilitada.')()),
      })
      : button('Habilitar', {
        icon: 'power',
        onClick: (event) => busy(event.currentTarget, () => ctx.api.patch(`/admin/users/${user.id}`, { active: true }).then(after('Cuenta habilitada.'))),
      }));
    if (!user.serviceAccount) {
      actions.push(
        button('Restablecer contraseña', { icon: 'lock', onClick: () => resetPassword(ctx, user).then((done) => done && ctx.reload()) }),
        button('Cerrar sesiones', {
          icon: 'logout',
          onClick: () => confirmDialog({
            title: 'Cerrar todas las sesiones',
            message: `${user.email} tendrá que volver a iniciar sesión en la app y en el panel.`,
            confirmLabel: 'Cerrar sesiones',
            tone: 'primary',
            run: () => ctx.api.post(`/admin/users/${user.id}/sessions/revoke`),
          }).then((done) => done && after('Sesiones cerradas.')()),
        }),
      );
    }
    actions.push(button('Eliminar', {
      icon: 'trash',
      variant: 'danger',
      disabled: user.integrations.length > 0,
      title: user.integrations.length > 0 ? 'Elimina primero las integraciones que usan esta cuenta' : undefined,
      onClick: () => confirmDialog({
        title: 'Eliminar la cuenta',
        message: `Se eliminan ${user.email} y todo lo que tiene: ${countOf(user.counts.trips, 'viaje', 'viajes')} con sus recorridos, ${countOf(user.counts.places, 'lugar', 'lugares')}, ${countOf(user.counts.routes, 'ruta', 'rutas')}, ${countOf(user.counts.geofences, 'geocerca', 'geocercas')} y ${countOf(user.counts.devices, 'dispositivo', 'dispositivos')}. No se puede deshacer.`,
        confirmLabel: 'Eliminar para siempre',
        confirmText: user.email,
        run: () => ctx.api.delete(`/admin/users/${user.id}`),
      }).then((done) => {
        if (!done) return;
        toast('Cuenta eliminada.', 'success');
        ctx.navigate('cuentas');
      }),
    }));
  }

  const counts = user.counts;
  const links = [
    link(`#/viajes?userId=${user.id}&userIdEmail=${encodeURIComponent(user.email)}`, `Viajes (${formatNumber(counts.trips)})`),
    link(`#/geocercas?userId=${user.id}&userIdEmail=${encodeURIComponent(user.email)}`, `Geocercas (${formatNumber(counts.geofences)})`),
    link(`#/lugares?scope=private&userId=${user.id}&userIdEmail=${encodeURIComponent(user.email)}`, `Lugares (${formatNumber(counts.places)})`),
    link(`#/rutas?userId=${user.id}&userIdEmail=${encodeURIComponent(user.email)}`, `Rutas (${formatNumber(counts.routes)})`),
    link(`#/dispositivos?userId=${user.id}&userIdEmail=${encodeURIComponent(user.email)}`, `Dispositivos (${formatNumber(counts.devices)})`),
    link(`#/sincronizacion?userId=${user.id}&userIdEmail=${encodeURIComponent(user.email)}`, 'Operaciones sincronizadas'),
    link(`#/eventos?accountId=${user.id}&accountIdEmail=${encodeURIComponent(user.email)}`, 'Eventos'),
    link(`#/auditoria?${new URLSearchParams({ targetId: user.id, targetIdLabel: user.email })}`, 'Cambios en la auditoría'),
  ];

  clear(ctx.outlet, el('div', { class: 'page' },
    backLink('#/cuentas', 'Cuentas'),
    pageHeader(user.name || user.email, user.email, actions),
    el('div', { class: 'page__meta' },
      user.serviceAccount ? badge('Cuenta de integración', 'info') : roleBadge(user.role),
      activeBadge(user.active),
      self ? badge('Tu cuenta', 'neutral') : null),
    self ? el('p', { class: 'muted small' }, 'Es tu cuenta: tu rol y tu estado los cambia otro administrador, y tu contraseña se cambia en «Mi cuenta».') : null,
    el('div', { class: 'grid grid--sidebar' },
      el('div', { class: 'stack' },
        card('Resumen', facts([
          ['Viajes', `${formatNumber(counts.trips)} (${formatNumber(counts.activeTrips)} en curso)`],
          ['Dispositivos', formatNumber(counts.devices)],
          ['Geocercas', formatNumber(counts.geofences)],
          ['Lugares', formatNumber(counts.places)],
          ['Rutas guardadas', formatNumber(counts.routes)],
          ['Sesiones abiertas', user.serviceAccount ? NONE : formatNumber(counts.activeSessions)],
        ])),
        card('Dispositivos', user.devices.length
          ? table([
            { label: 'Dispositivo', render: (device) => titleCell(device.model ?? label(PLATFORM_LABELS, device.platform), shortId(device.installationId)) },
            { label: 'Plataforma', render: (device) => label(PLATFORM_LABELS, device.platform) },
            { label: 'Versión de la app', render: (device) => device.appVersion ?? NONE },
            { label: 'Última conexión', className: 'nowrap', render: (device) => formatRelative(device.lastSeenAt, Date.now(), ctx.timeZone) },
          ], user.devices, { caption: 'Dispositivos de la cuenta' })
          : emptyState('Todavía no registró ningún dispositivo.'), { className: user.devices.length ? 'card--flush' : '' })),
      el('div', { class: 'stack' },
        card('Datos', facts([
          ['Identificador', el('span', { class: 'mono' }, user.id)],
          ['Creada', formatDateTime(user.createdAt, ctx.timeZone)],
          ['Último ingreso', user.serviceAccount ? 'Usa llaves de API, no contraseña' : user.lastLoginAt ? formatDateTime(user.lastLoginAt, ctx.timeZone) : 'Nunca'],
          ['Sesiones cerradas por última vez', user.sessionsRevokedAt ? formatDateTime(user.sessionsRevokedAt, ctx.timeZone) : null],
        ], 'facts--stacked')),
        user.integrations.length
          ? card('Integraciones que usan esta cuenta', el('ul', { class: 'stack' }, user.integrations.map((integration) =>
            el('li', {}, link(`#/integraciones/${integration.id}`, integration.name), ' ', activeBadge(integration.active)))))
          : null,
        card('Ver también', el('ul', { class: 'stack' }, links.map((item) => el('li', {}, item))))))));
}

async function editAccount(ctx, user, self) {
  const name = input({ required: true, maxlength: 120, value: user.name });
  const role = select(roleOptions(ctx), user.role, { disabled: self || user.serviceAccount });
  const roleHint = el('p', { class: 'field__hint' },
    self ? 'No puedes cambiar tu propio rol.' : user.serviceAccount ? 'Las cuentas de integraciones siempre son de usuario.' : ROLE_HINTS[user.role]);
  role.addEventListener('change', () => { roleHint.textContent = ROLE_HINTS[role.value]; });
  return formDialog({
    title: 'Editar la cuenta',
    description: user.email,
    fields: [field('Nombre', name, { wide: true }), el('div', { class: 'field field--wide' }, field('Rol', role), roleHint)],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('Revisa los campos marcados.');
      const changes = { name: name.value.trim() };
      if (!role.disabled && role.value !== user.role) changes.role = role.value;
      return ctx.api.patch(`/admin/users/${user.id}`, changes);
    },
  });
}

/** Where the person changes a temporary password. */
const changeHint = (role) => (role === 'USER'
  ? 'Podrá cambiarla en la app, en «Cuenta y sincronización».'
  : 'Podrá cambiarla en el panel, en «Mi cuenta».');

async function resetPassword(ctx, user) {
  const password = input({ type: 'password', minlength: 8, maxlength: 128, autocomplete: 'new-password' });
  const result = await formDialog({
    title: 'Restablecer la contraseña',
    description: `${user.email} tendrá que entrar con la nueva contraseña: sus sesiones abiertas se cierran.`,
    submitLabel: 'Restablecer',
    fields: [field('Nueva contraseña (opcional)', password, { hint: 'Déjala vacía para generar una temporal segura.', wide: true })],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      return ctx.api.post(`/admin/users/${user.id}/password`, password.value ? { password: password.value } : {});
    },
  });
  if (!result) return false;
  toast('Contraseña restablecida.', 'success');
  if (result.temporaryPassword) {
    await secretDialog({
      title: 'Contraseña temporal',
      description: `Entrégala a ${user.email} por un canal seguro. ${changeHint(user.role)}`,
      secret: result.temporaryPassword,
    });
  }
  return true;
}
