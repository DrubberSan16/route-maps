// Auditoría (administrators only): what administrators and operators changed, who and from where.
// Changes made on the server with the command line (make admin-create) appear too.
import { badge, el } from '../dom.js';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_GROUPS,
  formatDateTime,
  label,
  NONE,
  ROLE_LABELS,
  TARGET_LABELS,
} from '../format.js';
import { listView } from '../list.js';
import { dayRange } from '../router.js';
import { titleCell } from './common.js';

const GROUP_TONES = {
  user: 'info',
  integration: 'success',
  geofence: 'neutral',
  place: 'neutral',
  route: 'neutral',
  region: 'warning',
  trip: 'neutral',
};

/** Where the target of an entry can be seen today (nothing for deleted ones). */
function targetHref(entry) {
  if (!entry.targetId || entry.action.endsWith('.delete')) return null;
  switch (entry.targetType) {
    case 'user': return `#/cuentas/${entry.targetId}`;
    case 'integration': return `#/integraciones/${entry.targetId}`;
    case 'geofence': return `#/geocercas/${entry.targetId}`;
    case 'route': return `#/rutas/${entry.targetId}`;
    case 'trip': return `#/viajes/${entry.targetId}`;
    case 'region': return '#/regiones';
    case 'place': return '#/lugares?scope=shared';
    default: return null;
  }
}

const isChange = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === 2 && 'from' in value && 'to' in value;

const text = (value) => {
  if (value === null || value === undefined) return NONE;
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/** Fields of the recorded changes ({ from, to }): their name and how their values read. */
const CHANGE_FIELDS = {
  name: ['Nombre'],
  role: ['Rol', (value) => label(ROLE_LABELS, value)],
  active: ['Activa'],
};

/** The details of an entry: changed values first ("Rol: Usuario → Operador"), then the raw data. */
function detailsCell(entry) {
  const details = entry.details && typeof entry.details === 'object' ? entry.details : null;
  const changes = details
    ? Object.entries(details).filter(([, value]) => isChange(value)).map(([name, value]) => {
      const [fieldLabel, show = text] = CHANGE_FIELDS[name] ?? [name];
      return el('li', {}, `${fieldLabel}: ${show(value.from)} → ${show(value.to)}`);
    })
    : [];
  const raw = details && Object.keys(details).length ? JSON.stringify(details, null, 2) : null;
  if (!raw && !entry.ip) return NONE;
  return el('div', { class: 'audit-details' },
    changes.length ? el('ul', { class: 'audit-details__changes' }, changes) : null,
    el('details', {},
      el('summary', {}, 'Ver datos'),
      raw ? el('pre', { class: 'code' }, raw) : null,
      entry.ip ? el('p', { class: 'small muted' }, `Desde ${entry.ip}`) : null));
}

export function render(ctx) {
  listView(ctx, {
    title: 'Auditoría',
    description: 'Cada cambio hecho desde este panel o desde la línea de comandos del servidor: quién, cuándo, sobre qué y desde dónde.',
    filters: [
      { name: 'action', label: 'Qué', type: 'select', options: [['', 'Todo'], ...AUDIT_GROUPS] },
      { name: 'targetType', label: 'Sobre', type: 'select', options: [['', 'Todo'], ...Object.entries(TARGET_LABELS)] },
      { name: 'actorId', label: 'Quién', type: 'account', placeholder: 'Correo del administrador u operador' },
      { name: 'from', label: 'Desde', type: 'date' },
      { name: 'to', label: 'Hasta', type: 'date' },
      { name: 'targetId', label: 'Elemento', type: 'fixed' },
    ],
    empty: 'Todavía no hay cambios registrados.',
    columns: [
      { label: 'Cuándo', className: 'nowrap', render: (entry) => formatDateTime(entry.createdAt, ctx.timeZone) },
      {
        label: 'Quién',
        render: (entry) => (entry.actorId
          ? titleCell(entry.actorEmail, null)
          : titleCell('Línea de comandos', 'En el servidor')),
      },
      {
        label: 'Acción',
        render: (entry) => el('span', { class: 'cell-title' },
          el('strong', {}, label(AUDIT_ACTION_LABELS, entry.action)),
          el('small', { class: 'mono' }, entry.action)),
      },
      {
        label: 'Sobre',
        render: (entry) => {
          const href = targetHref(entry);
          const content = el('span', { class: 'cell-title' },
            el('span', {}, badge(label(TARGET_LABELS, entry.targetType), GROUP_TONES[entry.targetType] ?? 'neutral')),
            el('strong', {}, entry.summary));
          return href ? el('a', { href, class: 'row-link' }, content) : content;
        },
      },
      { label: 'Detalles', render: (entry) => detailsCell(entry) },
    ],
    load: (state) => {
      const range = dayRange(state.from, state.to);
      return ctx.api.get('/admin/audit', {
        action: state.action,
        targetType: state.targetType,
        actorId: state.actorId,
        targetId: state.targetId,
        from: range.from,
        to: range.to,
        limit: state.limit,
        offset: state.offset,
      }, { signal: ctx.signal });
    },
  });
}
