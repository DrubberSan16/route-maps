// Integraciones (administrators only): other applications connected to the platform. Each one
// acts as an account through API keys with permissions, receives signed webhooks and has a quota.
import { barChart } from '../chart.js';
import { accountPicker } from '../pickers.js';
import {
  alertBox,
  badge,
  busy,
  button,
  card,
  checkbox,
  clear,
  code,
  confirmDialog,
  el,
  emptyState,
  errorBox,
  facts,
  field,
  formDialog,
  icon,
  input,
  link,
  loading,
  openDialog,
  secretDialog,
  table,
  textarea,
  toast,
} from '../dom.js';
import {
  countOf,
  DELIVERY_STATUS_LABELS,
  errorText,
  EVENT_LABELS,
  formatDate,
  formatDateTime,
  formatDay,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
  KEY_STATUS_LABELS,
  label,
  maskedKey,
  NONE,
  SCOPE_LABELS,
} from '../format.js';
import { createList, listView, pageHeader } from '../list.js';
import { activeBadge, backLink, deliveryBadge, titleCell } from './common.js';

const ALL_EVENTS = '*';
const ALL_ACCOUNTS = 'ALL_ACCOUNTS';
const KEY_TONES = { ACTIVE: 'success', REVOKED: 'neutral', EXPIRED: 'warning' };
const TABS = [
  ['llaves', 'Llaves de API', 'key'],
  ['webhooks', 'Webhooks', 'webhook'],
  ['entregas', 'Entregas', 'send'],
  ['uso', 'Uso', 'activity'],
  ['datos', 'Datos', 'info'],
];

export function render(ctx) {
  return ctx.segments[0] ? renderIntegration(ctx, ctx.segments[0]) : renderList(ctx);
}

function renderList(ctx) {
  listView(ctx, {
    title: 'Integraciones',
    description: 'Aplicaciones externas conectadas a la plataforma: consultan la API con sus llaves y reciben eventos firmados en sus webhooks.',
    actions: [button('Nueva integración', {
      icon: 'plus',
      variant: 'primary',
      onClick: () => createIntegration(ctx).then((created) => created && ctx.navigate(['integraciones', created.id], { tab: 'llaves' })),
    })],
    filters: [
      { name: 'q', label: 'Buscar', placeholder: 'Nombre, descripción o correo' },
      { name: 'active', label: 'Estado', type: 'select', options: [['', 'Todas'], ['true', 'Activas'], ['false', 'Deshabilitadas']] },
    ],
    empty: 'Todavía no hay integraciones. Crea una para conectar tu ERP, CRM o sistema de despacho.',
    columns: [
      { label: 'Integración', render: (item) => titleCell(item.name, item.description) },
      {
        label: 'Actúa como',
        render: (item) => (item.account.serviceAccount
          ? titleCell('Cuenta propia', 'Creada para la integración')
          : titleCell(item.account.name, item.account.email)),
      },
      { label: 'Eventos', render: (item) => (item.eventScope === ALL_ACCOUNTS ? badge('De todas las cuentas', 'info') : 'De su cuenta') },
      { label: 'Llaves activas', className: 'num', render: (item) => formatNumber(item.activeKeys) },
      { label: 'Webhooks', className: 'num', render: (item) => formatNumber(item.webhookCount) },
      { label: 'Solicitudes hoy', className: 'num', render: (item) => formatNumber(item.requestsToday) },
      { label: 'Cuota', className: 'num', render: (item) => `${formatNumber(item.rateLimitPerMinute)}/min` },
      { label: 'Estado', render: (item) => activeBadge(item.active) },
    ],
    rowHref: (item) => `#/integraciones/${item.id}`,
    load: (state) => ctx.api.get('/admin/integrations', {
      q: state.q,
      active: state.active,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
}

function integrationFields(ctx, integration) {
  const limits = ctx.meta.integrations;
  return {
    name: input({ required: true, maxlength: 120, value: integration?.name ?? '' }),
    description: Object.assign(textarea({ maxlength: 1000, rows: 2 }), { value: integration?.description ?? '' }),
    contact: input({ type: 'email', maxlength: 254, value: integration?.contactEmail ?? '', placeholder: 'sistemas@empresa.com' }),
    quota: input({
      type: 'number',
      required: true,
      min: 1,
      max: limits.maxRateLimitPerMinute,
      step: 1,
      value: integration?.rateLimitPerMinute ?? limits.defaultRateLimitPerMinute,
      inputmode: 'numeric',
    }),
    allAccounts: checkbox('Recibir los eventos de todas las cuentas', {
      checked: integration?.eventScope === ALL_ACCOUNTS,
      hint: 'Para un ERP o un sistema de reportes de toda la flota: sus webhooks y GET /api/v1/events reciben los viajes y las geocercas de todas las personas, con sus posiciones. Sus llaves siguen actuando solo como su cuenta.',
    }),
  };
}

const eventScopeOf = (fields) => (fields.allAccounts.querySelector('input').checked ? ALL_ACCOUNTS : 'ACCOUNT');

async function createIntegration(ctx) {
  const fields = integrationFields(ctx, null);
  const own = checkbox('Crear una cuenta propia para la integración', {
    checked: true,
    hint: 'Recomendado: sus viajes, geocercas y lugares quedan separados de las personas.',
  });
  const picker = accountPicker(ctx, { placeholder: 'Correo de la cuenta existente' });
  const pickerField = field('Cuenta existente con la que actúa', picker, {
    hint: 'La integración ve y cambia los datos de esa cuenta (por ejemplo, la flota de un conductor).',
    wide: true,
  });
  pickerField.hidden = true;
  own.querySelector('input').addEventListener('change', (event) => { pickerField.hidden = event.target.checked; });

  return formDialog({
    title: 'Nueva integración',
    description: 'Después podrás crear sus llaves de API y sus webhooks.',
    size: 'lg',
    submitLabel: 'Crear integración',
    fields: [
      field('Nombre', fields.name, { hint: 'Ej.: ERP de flota, CRM de ventas.' }),
      field('Correo de contacto', fields.contact, { hint: 'A quién avisar si algo falla (opcional).' }),
      field('Descripción', fields.description, { wide: true }),
      field('Cuota (solicitudes por minuto)', fields.quota, { hint: `Hasta ${formatNumber(ctx.meta.integrations.maxRateLimitPerMinute)}. Al pasarla, la API responde 429 un minuto.` }),
      el('div', { class: 'field--wide' }, own),
      pickerField,
      el('div', { class: 'field--wide' }, fields.allAccounts),
    ],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('Revisa los campos marcados.');
      const useExisting = !own.querySelector('input').checked;
      if (useExisting && !picker.selected()) throw new Error('Elige la cuenta existente con la que actúa la integración.');
      return ctx.api.post('/admin/integrations', {
        name: fields.name.value.trim(),
        description: fields.description.value.trim() || undefined,
        contactEmail: fields.contact.value.trim() || undefined,
        rateLimitPerMinute: Number(fields.quota.value),
        eventScope: eventScopeOf(fields),
        ...(useExisting ? { accountId: picker.selected().id } : {}),
      });
    },
  }).then((created) => {
    if (created) toast('Integración creada. Ahora crea su llave de API.', 'success');
    return created;
  });
}

async function renderIntegration(ctx, id) {
  clear(ctx.outlet, loading());
  let integration;
  try {
    integration = await ctx.api.get(`/admin/integrations/${encodeURIComponent(id)}`, undefined, { signal: ctx.signal });
  } catch (error) {
    clear(ctx.outlet, el('div', { class: 'page' }, backLink('#/integraciones', 'Integraciones'), errorBox(error)));
    return;
  }
  if (ctx.signal.aborted) return;
  const base = `/admin/integrations/${integration.id}`;

  const actions = [
    button('Editar', { icon: 'edit', onClick: () => editIntegration(ctx, integration).then((saved) => saved && ctx.reload()) }),
    button(integration.active ? 'Deshabilitar' : 'Habilitar', {
      icon: 'power',
      onClick: (event) => (integration.active
        ? confirmDialog({
          title: 'Deshabilitar la integración',
          message: `Sus llaves dejan de funcionar al instante y sus webhooks no reciben eventos mientras esté deshabilitada. Nada se borra.`,
          confirmLabel: 'Deshabilitar',
          run: () => ctx.api.patch(base, { active: false }),
        }).then((done) => {
          if (done) {
            toast('Integración deshabilitada.', 'success');
            ctx.reload();
          }
        })
        : busy(event.currentTarget, async () => {
          await ctx.api.patch(base, { active: true });
          toast('Integración habilitada.', 'success');
          ctx.reload();
        })),
    }),
    button('Eliminar', {
      icon: 'trash',
      variant: 'danger',
      onClick: () => confirmDialog({
        title: 'Eliminar la integración',
        message: `Se eliminan sus llaves, sus webhooks y su historial de entregas. ${integration.account.serviceAccount
          ? `Su cuenta propia (${integration.account.email}) y sus datos se conservan; puedes eliminarla después desde Cuentas.`
          : `La cuenta ${integration.account.email} y sus datos no cambian.`}`,
        confirmLabel: 'Eliminar',
        confirmText: integration.name,
        run: () => ctx.api.delete(base),
      }).then((done) => {
        if (!done) return;
        toast('Integración eliminada.', 'success');
        ctx.navigate('integraciones');
      }),
    }),
  ];

  let tab = TABS.some(([key]) => key === ctx.query.tab) ? ctx.query.tab : 'llaves';
  const tabList = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Secciones de la integración' });
  const panel = el('div', { role: 'tabpanel', class: 'stack' });
  const counts = { llaves: integration.keys.filter((key) => key.status === 'ACTIVE').length, webhooks: integration.webhooks.length };
  const tabs = TABS.map(([key, text, iconName]) => {
    const tabButton = el('button', {
      type: 'button',
      role: 'tab',
      class: 'tab',
      id: `tab-${key}`,
      'aria-controls': 'integration-panel',
      onclick: () => show(key),
    }, icon(iconName), text, counts[key] !== undefined ? el('span', { class: 'tab__count' }, formatNumber(counts[key])) : null);
    tabList.append(tabButton);
    return [key, tabButton];
  });
  panel.id = 'integration-panel';
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = TABS.findIndex(([key]) => key === tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
    show(next);
    tabs.find(([key]) => key === next)[1].focus();
  });

  function show(key) {
    tab = key;
    ctx.replaceQuery({ tab: key });
    for (const [name, tabButton] of tabs) {
      tabButton.setAttribute('aria-selected', String(name === key));
      tabButton.tabIndex = name === key ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `tab-${key}`);
    const renderers = { llaves: keysTab, webhooks: webhooksTab, entregas: deliveriesTab, uso: usageTab, datos: dataTab };
    clear(panel, renderers[key](ctx, integration, base));
  }

  clear(ctx.outlet, el('div', { class: 'page' },
    backLink('#/integraciones', 'Integraciones'),
    pageHeader(integration.name, integration.description, actions),
    el('div', { class: 'page__meta' },
      activeBadge(integration.active),
      integration.eventScope === ALL_ACCOUNTS ? badge('Recibe los eventos de todas las cuentas', 'info') : null,
      badge(`Cuota ${formatNumber(integration.rateLimitPerMinute)}/min`, 'neutral'),
      badge(`${countOf(integration.requestsToday, 'solicitud', 'solicitudes')} hoy`, 'neutral')),
    integration.active ? null : alertBox('warning', 'alert', 'La integración está deshabilitada: sus llaves no funcionan y sus webhooks no reciben eventos.'),
    !integration.account.active ? alertBox('warning', 'alert', `La cuenta con la que actúa (${integration.account.email}) está deshabilitada: sus llaves no funcionan.`) : null,
    tabList,
    panel));
  show(tab);
}

async function editIntegration(ctx, integration) {
  const fields = integrationFields(ctx, integration);
  const saved = await formDialog({
    title: 'Editar la integración',
    size: 'lg',
    fields: [
      field('Nombre', fields.name),
      field('Correo de contacto', fields.contact),
      field('Descripción', fields.description, { wide: true }),
      field('Cuota (solicitudes por minuto)', fields.quota),
      el('div', { class: 'field--wide' }, fields.allAccounts),
    ],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('Revisa los campos marcados.');
      return ctx.api.patch(`/admin/integrations/${integration.id}`, {
        name: fields.name.value.trim(),
        description: fields.description.value.trim() || null,
        contactEmail: fields.contact.value.trim() || null,
        rateLimitPerMinute: Number(fields.quota.value),
        eventScope: eventScopeOf(fields),
      });
    },
  });
  if (saved) toast('Integración guardada.', 'success');
  return saved;
}

// ---------------------------------------------------------------- keys

function keysTab(ctx, integration, base) {
  const create = () => button('Nueva llave', { icon: 'plus', variant: 'primary', onClick: () => createKey(ctx, integration, base) });
  const columns = [
    { label: 'Llave', render: (key) => titleCell(key.name, maskedKey(key)) },
    { label: 'Permisos', render: (key) => (key.scopes.length ? el('span', { class: 'badges' }, key.scopes.map((scope) => badge(scope, 'neutral'))) : 'Solo mapas y rutas') },
    { label: 'Estado', render: (key) => badge(label(KEY_STATUS_LABELS, key.status), KEY_TONES[key.status]) },
    { label: 'Vence', className: 'nowrap', render: (key) => (key.expiresAt ? formatDate(key.expiresAt, ctx.timeZone) : 'Nunca') },
    {
      label: 'Último uso',
      className: 'nowrap',
      render: (key) => (key.lastUsedAt ? `${formatRelative(key.lastUsedAt, Date.now(), ctx.timeZone)}${key.lastUsedIp ? ` · ${key.lastUsedIp}` : ''}` : 'Nunca'),
    },
    { label: 'Creada', className: 'nowrap', render: (key) => formatDateTime(key.createdAt, ctx.timeZone) },
    {
      label: 'Acciones',
      className: 'actions-cell',
      render: (key) => (key.status === 'ACTIVE'
        ? button('Revocar', {
          icon: 'ban',
          variant: 'ghost',
          onClick: () => confirmDialog({
            title: 'Revocar la llave',
            message: `«${key.name}» (${maskedKey(key)}) deja de funcionar al instante. La aplicación que la usa recibirá 401 hasta que configures otra llave.`,
            confirmLabel: 'Revocar',
            run: () => ctx.api.delete(`${base}/keys/${key.id}`),
          }).then((done) => {
            if (!done) return;
            toast('Llave revocada.', 'success');
            ctx.reload();
          }),
        })
        : NONE),
    },
  ];
  return el('div', { class: 'stack' },
    el('div', { class: 'card__header' },
      el('p', { class: 'card__hint' }, 'La aplicación envía la llave en el encabezado X-API-Key. Cada llave tiene sus permisos; los mapas, rutas, búsqueda y tráfico funcionan con cualquier llave válida.'),
      create()),
    integration.keys.length
      ? card(null, table(columns, integration.keys, { caption: 'Llaves de API' }), { className: 'card--flush' })
      : card(null, emptyState('Esta integración todavía no tiene llaves.', create())));
}

async function createKey(ctx, integration, base) {
  const name = input({ required: true, maxlength: 80, placeholder: 'Servidor de producción' });
  const scopes = ctx.meta.scopes.map((scope) => checkbox(scope, { name: 'scope', value: scope, hint: label(SCOPE_LABELS, scope) }));
  const expires = input({ type: 'date', min: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
  const result = await formDialog({
    title: 'Nueva llave de API',
    description: `Para «${integration.name}». Dale solo los permisos que necesita.`,
    size: 'lg',
    submitLabel: 'Crear llave',
    fields: [
      field('Nombre', name, { hint: 'Para reconocerla después, por ejemplo dónde se usa.' }),
      field('Vence (opcional)', expires, { hint: 'Vacío: no vence. Revócala cuando ya no se use.' }),
      el('fieldset', { class: 'field field--wide' }, el('legend', { class: 'field__label' }, 'Permisos'),
        el('div', { class: 'checkbox-group' }, scopes)),
    ],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('Escribe un nombre para la llave.');
      const chosen = scopes.map((item) => item.querySelector('input')).filter((box) => box.checked).map((box) => box.value);
      return ctx.api.post(`${base}/keys`, {
        name: name.value.trim(),
        scopes: chosen,
        // End of the chosen day in the browser's time zone.
        ...(expires.value ? { expiresAt: new Date(`${expires.value}T23:59:59`).toISOString() } : {}),
      });
    },
  });
  if (!result) return;
  await secretDialog({
    title: 'Llave creada',
    description: `Configúrala en la aplicación de «${integration.name}». La plataforma solo guarda una huella: si se pierde, crea otra y revoca esta.`,
    secret: result.key,
    extra: el('div', { class: 'stack' },
      el('p', { class: 'small muted' }, 'Prueba la llave desde la terminal:'),
      code(`curl -H "X-API-Key: ${result.key}" ${window.location.origin}/api/v1/integrations/me`)),
  });
  ctx.reload();
}

// ---------------------------------------------------------------- webhooks

const eventsText = (events) => (events.includes(ALL_EVENTS)
  ? [badge('Todos los eventos', 'info')]
  : events.map((type) => badge(label(EVENT_LABELS, type), 'neutral')));

function urlPolicy(ctx) {
  const { allowInsecure, allowPrivateNetworks } = ctx.meta.webhooks;
  if (allowInsecure && allowPrivateNetworks) return 'Este servidor acepta URLs http y de redes privadas (modo de desarrollo).';
  if (allowPrivateNetworks) return 'Solo URLs https; se aceptan direcciones de redes privadas.';
  if (allowInsecure) return 'Se aceptan URLs http, pero solo de direcciones públicas.';
  return 'Solo URLs https de direcciones públicas de internet.';
}

function webhooksTab(ctx, integration, base) {
  const create = () => button('Nuevo webhook', { icon: 'plus', variant: 'primary', onClick: () => editWebhook(ctx, integration, base, null) });
  const retries = ctx.meta.webhooks.retryDelaysMs.map((ms) => formatDuration(ms / 1000)).join(', ');
  const items = integration.webhooks.map((webhook) => el('article', { class: 'webhook' },
    el('div', { class: 'card__header' },
      el('p', { class: 'webhook__url' }, webhook.url),
      el('span', { class: 'badges' },
        activeBadge(webhook.active, 'Activo', 'Pausado'),
        webhook.consecutiveFailures > 0 ? badge(countOf(webhook.consecutiveFailures, 'falla seguida', 'fallas seguidas'), 'danger') : null)),
    webhook.description ? el('p', { class: 'small' }, webhook.description) : null,
    el('span', { class: 'badges' }, eventsText(webhook.events)),
    el('p', { class: 'webhook__meta' },
      el('span', {}, `Última entrega correcta: ${webhook.lastSuccessAt ? formatRelative(webhook.lastSuccessAt, Date.now(), ctx.timeZone) : 'nunca'}`),
      el('span', {}, `Última falla: ${webhook.lastFailureAt ? formatRelative(webhook.lastFailureAt, Date.now(), ctx.timeZone) : 'nunca'}`)),
    el('div', { class: 'actions' },
      button('Enviar prueba', {
        icon: 'send',
        variant: 'secondary',
        onClick: (event) => busy(event.currentTarget, async () => {
          await ctx.api.post(`${base}/webhooks/${webhook.id}/test`);
          toast('Prueba en camino: mira su resultado en «Entregas».', 'success');
        }),
      }),
      button('Editar', { icon: 'edit', variant: 'ghost', onClick: () => editWebhook(ctx, integration, base, webhook) }),
      button(webhook.active ? 'Pausar' : 'Reanudar', {
        icon: webhook.active ? 'pause' : 'play',
        variant: 'ghost',
        onClick: (event) => busy(event.currentTarget, async () => {
          await ctx.api.patch(`${base}/webhooks/${webhook.id}`, { active: !webhook.active });
          toast(webhook.active ? 'Webhook pausado: los eventos nuevos no se le envían.' : 'Webhook reanudado.', 'success');
          ctx.reload();
        }),
      }),
      button('Cambiar secreto', { icon: 'rotate', variant: 'ghost', onClick: () => rotateSecret(ctx, base, webhook) }),
      button('Eliminar', {
        icon: 'trash',
        variant: 'ghost',
        onClick: () => confirmDialog({
          title: 'Eliminar el webhook',
          message: `${webhook.url} deja de recibir eventos y se borra su historial de entregas.`,
          confirmLabel: 'Eliminar',
          run: () => ctx.api.delete(`${base}/webhooks/${webhook.id}`),
        }).then((done) => {
          if (!done) return;
          toast('Webhook eliminado.', 'success');
          ctx.reload();
        }),
      }))));

  return el('div', { class: 'stack' },
    el('div', { class: 'card__header' },
      el('p', { class: 'card__hint' },
        `${integration.eventScope === ALL_ACCOUNTS ? 'Reciben los eventos de todas las cuentas y los de la plataforma.' : `Reciben los eventos de ${integration.account.serviceAccount ? 'su cuenta' : integration.account.email} y los de la plataforma.`} Cada evento se envía con POST y una firma HMAC-SHA256. Si el receptor no responde 2xx en ${formatNumber(ctx.meta.webhooks.timeoutMs / 1000)} s, se reintenta después de ${retries}: ${formatNumber(ctx.meta.webhooks.maxAttempts)} intentos en total.`),
      create()),
    items.length ? el('div', { class: 'stack' }, items) : card(null, emptyState('Esta integración todavía no tiene webhooks.', create())));
}

async function rotateSecret(ctx, base, webhook) {
  let rotated;
  const done = await confirmDialog({
    title: 'Cambiar el secreto de firma',
    message: 'Las entregas siguientes se firman con un secreto nuevo. Actualízalo en el receptor enseguida: hasta entonces rechazará las firmas.',
    confirmLabel: 'Cambiar secreto',
    tone: 'primary',
    run: async () => {
      rotated = await ctx.api.post(`${base}/webhooks/${webhook.id}/rotate-secret`);
    },
  });
  if (done && rotated) {
    await secretDialog({ title: 'Secreto nuevo', description: webhook.url, secret: rotated.secret, extra: signatureHelp() });
  }
}

function signatureHelp() {
  return el('div', { class: 'stack' },
    el('p', { class: 'small muted' },
      'Cada solicitud trae el encabezado X-RouteMaps-Signature: t=<segundos>,v1=<firma>. La firma es el HMAC-SHA256 (hex) de "<t>.<cuerpo>" con este secreto; rechaza las que no coincidan o tengan más de 5 minutos.'),
    link('/developers.html#webhooks', 'Ver ejemplos de verificación', { target: '_blank', rel: 'noopener' }));
}

async function editWebhook(ctx, integration, base, webhook) {
  const url = input({ type: 'url', required: true, minlength: 8, maxlength: 2048, value: webhook?.url ?? '', placeholder: 'https://erp.empresa.com/webhooks/route-maps', spellcheck: 'false' });
  const description = input({ maxlength: 300, value: webhook?.description ?? '' });
  const all = checkbox('Todos los eventos', { checked: !webhook || webhook.events.includes(ALL_EVENTS), hint: 'Incluye los tipos de evento que la plataforma agregue más adelante.' });
  const types = ctx.meta.eventTypes.map((type) => checkbox(label(EVENT_LABELS, type), {
    name: 'event',
    value: type,
    checked: Boolean(webhook?.events.includes(type)),
    hint: type,
  }));
  const group = el('div', { class: 'checkbox-group' }, types);
  const allBox = all.querySelector('input');
  const sync = () => { group.hidden = allBox.checked; };
  allBox.addEventListener('change', sync);
  sync();

  const result = await formDialog({
    title: webhook ? 'Editar el webhook' : 'Nuevo webhook',
    description: urlPolicy(ctx),
    size: 'lg',
    submitLabel: webhook ? 'Guardar' : 'Crear webhook',
    fields: [
      field('URL', url, { wide: true }),
      field('Descripción (opcional)', description, { wide: true }),
      el('fieldset', { class: 'field field--wide' }, el('legend', { class: 'field__label' }, 'Eventos'), all, group),
    ],
    submit: (form) => {
      if (!form.reportValidity()) throw new Error('Escribe una URL completa, por ejemplo https://servidor.com/webhooks.');
      const events = allBox.checked
        ? [ALL_EVENTS]
        : types.map((item) => item.querySelector('input')).filter((box) => box.checked).map((box) => box.value);
      if (events.length === 0) throw new Error('Elige al menos un tipo de evento.');
      const body = { url: url.value.trim(), description: description.value.trim() || undefined, events };
      return webhook ? ctx.api.patch(`${base}/webhooks/${webhook.id}`, body) : ctx.api.post(`${base}/webhooks`, body);
    },
  });
  if (!result) return;
  if (!webhook) {
    await secretDialog({
      title: 'Webhook creado',
      description: 'Guarda este secreto en el receptor para verificar que cada evento viene de esta plataforma.',
      secret: result.secret,
      extra: signatureHelp(),
    });
  } else {
    toast('Webhook guardado.', 'success');
  }
  ctx.reload();
}

// ---------------------------------------------------------------- deliveries

function deliveriesTab(ctx, integration, base) {
  const list = createList(ctx, {
    title: 'Entregas',
    filters: [
      { name: 'webhookId', label: 'Webhook', type: 'select', options: [['', 'Todos'], ...integration.webhooks.map((webhook) => [webhook.id, webhook.url])] },
      { name: 'status', label: 'Estado', type: 'select', options: [['', 'Todos'], ...ctx.meta.deliveryStatuses.map((status) => [status, label(DELIVERY_STATUS_LABELS, status)])] },
    ],
    empty: 'Todavía no hay entregas. Aparecen cuando ocurre un evento al que un webhook está suscrito, o al enviar una prueba.',
    columns: [
      {
        label: 'Evento',
        render: (delivery) => el('button', { type: 'button', class: 'link-button cell-title', onclick: () => showDelivery(ctx, base, delivery.id, list) },
          el('strong', {}, label(EVENT_LABELS, delivery.eventType)), el('small', {}, delivery.webhookUrl)),
      },
      { label: 'Estado', render: (delivery) => deliveryBadge(delivery.status) },
      { label: 'Intentos', className: 'num', render: (delivery) => formatNumber(delivery.attempts) },
      { label: 'Respuesta', render: (delivery) => (delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : delivery.error ? el('span', { class: 'small' }, delivery.error) : NONE) },
      {
        label: 'Cuándo',
        className: 'nowrap',
        render: (delivery) => (delivery.status === 'PENDING'
          ? `Próximo intento ${formatRelative(delivery.nextAttemptAt, Date.now(), ctx.timeZone)}`
          : delivery.lastAttemptAt ? formatRelative(delivery.lastAttemptAt, Date.now(), ctx.timeZone) : NONE),
      },
      { label: 'Duración', className: 'num', render: (delivery) => (delivery.durationMs !== null && delivery.durationMs !== undefined ? `${formatNumber(delivery.durationMs)} ms` : NONE) },
      {
        label: 'Acciones',
        className: 'actions-cell',
        render: (delivery) => (delivery.status === 'SENDING' || delivery.status === 'PENDING'
          ? NONE
          : button('Reenviar', {
            icon: 'refresh',
            variant: 'ghost',
            onClick: (event) => busy(event.currentTarget, async () => {
              await ctx.api.post(`${base}/deliveries/${delivery.id}/retry`);
              toast('Entrega en cola para enviarse de nuevo.', 'success');
              list.reload();
            }),
          })),
      },
    ],
    load: (state) => ctx.api.get(`${base}/deliveries`, {
      webhookId: state.webhookId,
      status: state.status,
      limit: state.limit,
      offset: state.offset,
    }, { signal: ctx.signal }),
  });
  return el('div', { class: 'stack' },
    el('div', { class: 'card__header' },
      el('p', { class: 'card__hint' }, 'Cada evento enviado a un webhook, con sus intentos y la última respuesta del receptor.'),
      button('Actualizar', { icon: 'refresh', variant: 'secondary', onClick: () => list.reload() })),
    list.element);
}

async function showDelivery(ctx, base, id, list) {
  let delivery;
  try {
    delivery = await ctx.api.get(`${base}/deliveries/${id}`);
  } catch (error) {
    toast(errorText(error), 'danger');
    return;
  }
  const retried = await openDialog({
    title: label(EVENT_LABELS, delivery.eventType),
    description: delivery.webhookUrl,
    size: 'lg',
    body: el('div', { class: 'stack' },
      el('div', { class: 'page__meta' }, deliveryBadge(delivery.status)),
      facts([
        ['Intentos', formatNumber(delivery.attempts)],
        ['Último intento', delivery.lastAttemptAt ? formatDateTime(delivery.lastAttemptAt, ctx.timeZone) : NONE],
        [delivery.status === 'PENDING' ? 'Próximo intento' : 'Programado', formatDateTime(delivery.nextAttemptAt, ctx.timeZone)],
        ['Respuesta', delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : NONE],
        ['Duración', delivery.durationMs !== null && delivery.durationMs !== undefined ? `${formatNumber(delivery.durationMs)} ms` : NONE],
        ['Identificador', el('span', { class: 'mono small' }, delivery.id)],
      ]),
      delivery.error ? alertBox('danger', 'alert', delivery.error) : null,
      el('h3', { class: 'card__title' }, 'Cuerpo enviado'),
      code(delivery.event),
      delivery.responseBody ? el('h3', { class: 'card__title' }, 'Respuesta del receptor') : null,
      delivery.responseBody ? code(delivery.responseBody) : null),
    actions: delivery.status === 'SENDING' || delivery.status === 'PENDING'
      ? []
      : [(close) => button('Reenviar', {
        icon: 'refresh',
        variant: 'primary',
        onClick: (event) => busy(event.currentTarget, async () => {
          await ctx.api.post(`${base}/deliveries/${delivery.id}/retry`);
          close(true);
        }),
      })],
  });
  if (retried) {
    toast('Entrega en cola para enviarse de nuevo.', 'success');
    list.reload();
  }
}

// ---------------------------------------------------------------- usage and data

function usageTab(ctx, integration, base) {
  const slot = el('div', { class: 'stack' }, loading());
  ctx.api.get(`${base}/usage`, { days: 30 }, { signal: ctx.signal }).then((usage) => {
    const requests = usage.days.reduce((sum, day) => sum + day.requests, 0);
    const errors = usage.days.reduce((sum, day) => sum + day.errors, 0);
    clear(slot,
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { class: 'stat__label' }, icon('activity'), 'Solicitudes (30 días)'), el('span', { class: 'stat__value' }, formatNumber(requests))),
        el('div', { class: 'stat' }, el('span', { class: 'stat__label' }, icon('alert'), 'Con error'), el('span', { class: 'stat__value' }, formatNumber(errors)),
          requests ? el('span', { class: 'stat__detail' }, `${formatPercent(errors, requests)} del total`) : null),
        el('div', { class: 'stat' }, el('span', { class: 'stat__label' }, icon('clock'), 'Hoy'), el('span', { class: 'stat__value' }, formatNumber(integration.requestsToday)))),
      card('Solicitudes por día', requests === 0
        ? emptyState('Sin solicitudes en los últimos 30 días.')
        : barChart({
          caption: 'Solicitudes de la integración por día',
          series: [{ label: 'Correctas', tone: 'primary' }, { label: 'Con error', tone: 'danger' }],
          format: formatNumber,
          bars: usage.days.map((day) => ({
            label: formatDay(day.day),
            values: [Math.max(0, day.requests - day.errors), day.errors],
            title: `${formatDay(day.day)}: ${countOf(day.requests, 'solicitud', 'solicitudes')}, ${formatNumber(day.errors)} con error`,
          })),
        })),
      el('p', { class: 'muted small' }, 'Cuentan las solicitudes hechas con sus llaves; con error son las respuestas 4xx y 5xx (incluidas las rechazadas por cuota).'));
  }, (error) => {
    if (!ctx.signal.aborted) clear(slot, errorBox(error));
  });
  return slot;
}

function dataTab(ctx, integration) {
  const { account } = integration;
  return el('div', { class: 'grid grid--2' },
    card('Datos', facts([
      ['Actúa como', ctx.isAdmin ? link(`#/cuentas/${account.id}`, account.email) : account.email],
      ['Tipo de cuenta', account.serviceAccount ? 'Cuenta propia de la integración' : 'Cuenta existente'],
      ['Eventos que recibe', integration.eventScope === ALL_ACCOUNTS
        ? 'Los de todas las cuentas y los de la plataforma (regiones)'
        : 'Los de su cuenta y los de la plataforma (regiones)'],
      ['Contacto', integration.contactEmail ?? NONE],
      ['Cuota', `${countOf(integration.rateLimitPerMinute, 'solicitud', 'solicitudes')} por minuto`],
      ['Creada', formatDateTime(integration.createdAt, ctx.timeZone)],
      ['Actualizada', formatDateTime(integration.updatedAt, ctx.timeZone)],
      ['Identificador', el('span', { class: 'mono small' }, integration.id)],
    ], 'facts--stacked')),
    card('Cómo se conecta', el('div', { class: 'stack' },
      el('p', {}, 'La aplicación llama a la API de esta plataforma con su llave:'),
      code(`${window.location.origin}/api/v1\nX-API-Key: rmk_…`),
      el('p', {}, 'Con «events:read» puede leer el historial de eventos con GET /api/v1/events?after=<seq>, por si un webhook se perdió.'),
      el('div', { class: 'actions' },
        link('/developers.html#integraciones', 'Guía de integración', { target: '_blank', rel: 'noopener', class: 'btn btn--secondary' }),
        link('/api/docs', 'Referencia de la API', { target: '_blank', rel: 'noopener', class: 'btn btn--ghost' })))));
}
