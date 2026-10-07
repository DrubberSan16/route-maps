// Formats and labels of the administration panel. Pure functions (no DOM): the Node tests in
// infrastructure/nginx/tests/admin-format.test.mjs run them as they are.

const LOCALE = 'es';

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto', style: 'short' });
const dateTimeFormats = new Map();

/** Text shown where a value is missing. */
export const NONE = '—';

export const formatNumber = (value) => (value === null || value === undefined ? NONE : integer.format(value));

/** "1 viaje", "3 viajes": a count with the singular or the plural of what it counts. */
export const countOf = (count, one, many) => `${formatNumber(count)} ${count === 1 ? one : many}`;

export function formatDistance(meters) {
  if (meters === null || meters === undefined) return NONE;
  if (meters < 1000) return `${integer.format(Math.round(meters))} m`;
  const km = meters / 1000;
  return `${km < 100 ? oneDecimal.format(km) : integer.format(km)} km`;
}

/** 45 s, 12 min, 2 h, 1 h 05 min, 2 d 3 h. */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return NONE;
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return NONE;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? integer.format(value) : oneDecimal.format(value)} ${units[unit]}`;
}

export const formatSpeed = (metersPerSecond) =>
  metersPerSecond === null || metersPerSecond === undefined ? NONE : `${integer.format(metersPerSecond * 3.6)} km/h`;

export function formatPercent(part, whole) {
  if (!whole) return NONE;
  return `${oneDecimal.format((part / whole) * 100)} %`;
}

function dateTimeFormat(timeZone, withTime) {
  const key = `${timeZone ?? ''}|${withTime}`;
  if (!dateTimeFormats.has(key)) {
    dateTimeFormats.set(key, new Intl.DateTimeFormat(LOCALE, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
      ...(timeZone ? { timeZone } : {}),
    }));
  }
  return dateTimeFormats.get(key);
}

const toDate = (value) => (value instanceof Date ? value : new Date(value));

/** "7 oct 2026, 14:32" in the platform time zone (the browser's when absent). */
export function formatDateTime(value, timeZone) {
  if (!value) return NONE;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? NONE : dateTimeFormat(timeZone, true).format(date);
}

export function formatDate(value, timeZone) {
  if (!value) return NONE;
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? NONE : dateTimeFormat(timeZone, false).format(date);
}

const dayLabel = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "7 oct" for a calendar day as the API gives it (YYYY-MM-DD). */
export const formatDay = (day) => dayLabel.format(new Date(`${day}T00:00:00Z`));

const RELATIVE_UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
];

/** "hace 3 min", "ayer", "dentro de 2 h"; dates more than a week away are written out. */
export function formatRelative(value, now = Date.now(), timeZone = undefined) {
  if (!value) return NONE;
  const date = toDate(value);
  const diff = date.getTime() - now;
  if (Number.isNaN(diff)) return NONE;
  if (Math.abs(diff) >= 7 * 86_400_000) return formatDate(date, timeZone);
  if (Math.abs(diff) < 10_000) return relative.format(0, 'second');
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= size) return relative.format(Math.trunc(diff / size), unit);
  }
  return relative.format(0, 'second');
}

/** Duration of a trip: until it ended, or until now while it goes on. */
export function tripSeconds(trip, now = Date.now()) {
  const start = toDate(trip.startedAt).getTime();
  const end = trip.endedAt ? toDate(trip.endedAt).getTime() : now;
  return Math.max(0, (end - start) / 1000);
}

/** "Calle 1 · -2.17000, -79.90000" style coordinates. */
export const formatCoordinate = ({ latitude, longitude }) => `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

/** A shortened identifier for tables: the first 8 characters of a UUID. */
export const shortId = (id) => (id ? id.slice(0, 8) : NONE);

/** "rmk_ab12cd34ef56_…wxyz": how a stored API key is shown (the secret part is never kept). */
export const maskedKey = (key) => `rmk_${key.prefix}_…${key.lastFour}`;

// ---------------------------------------------------------------- catalogues

export const ROLE_LABELS = { ADMIN: 'Administrador', OPERATOR: 'Operador', USER: 'Usuario' };

export const TRIP_STATUS_LABELS = { ACTIVE: 'En curso', COMPLETED: 'Terminado', CANCELLED: 'Cancelado' };

export const PROFILE_LABELS = {
  CAR: 'Auto',
  TRUCK: 'Camión',
  MOTORCYCLE: 'Moto',
  BICYCLE: 'Bicicleta',
  PEDESTRIAN: 'A pie',
};

export const PLATFORM_LABELS = { ANDROID: 'Android', IOS: 'iOS', WEB: 'Web', OTHER: 'Otra' };

export const SYNC_STATUS_LABELS = { APPLIED: 'Aplicada', DUPLICATE: 'Repetida', FAILED: 'Fallida' };

export const SYNC_ENTITY_LABELS = {
  trip: 'Viaje',
  tracking_point: 'Posición',
  route: 'Ruta',
  place: 'Lugar',
  downloaded_region: 'Región guardada',
};

export const SYNC_OPERATION_LABELS = {
  CREATE: 'crear',
  UPSERT: 'guardar',
  UPDATE: 'actualizar',
  DELETE: 'eliminar',
  FINISH: 'terminar',
  CANCEL: 'cancelar',
};

export const DELIVERY_STATUS_LABELS = {
  PENDING: 'Pendiente',
  SENDING: 'Enviando',
  SUCCEEDED: 'Entregada',
  FAILED: 'Fallida',
};

export const KEY_STATUS_LABELS = { ACTIVE: 'Activa', REVOKED: 'Revocada', EXPIRED: 'Vencida' };

export const GEOFENCE_TYPE_LABELS = { CIRCLE: 'Círculo', POLYGON: 'Polígono' };

export const ASSET_LABELS = { terrain: 'Relieve', satellite: 'Satélite', overlays: 'Capas' };

export const EVENT_LABELS = {
  'trip.started': 'Viaje iniciado',
  'trip.finished': 'Viaje terminado',
  'trip.cancelled': 'Viaje cancelado',
  'geofence.entered': 'Entrada a geocerca',
  'geofence.exited': 'Salida de geocerca',
  'region.published': 'Región publicada',
  'region.disabled': 'Región deshabilitada',
  'webhook.test': 'Prueba de webhook',
};

export const SCOPE_LABELS = {
  'trips:read': 'Leer viajes, recorridos y posiciones',
  'trips:write': 'Iniciar y terminar viajes, enviar posiciones',
  'geofences:read': 'Leer geocercas',
  'geofences:write': 'Crear, editar y eliminar geocercas',
  'places:read': 'Leer lugares',
  'places:write': 'Crear, editar y eliminar lugares',
  'routes:read': 'Leer rutas guardadas',
  'routes:write': 'Guardar y eliminar rutas',
  'events:read': 'Leer el historial de eventos (GET /events)',
};

export const AUDIT_ACTION_LABELS = {
  'user.create': 'Creó una cuenta',
  'user.update': 'Editó una cuenta',
  'user.role': 'Cambió el rol',
  'user.enable': 'Habilitó una cuenta',
  'user.disable': 'Deshabilitó una cuenta',
  'user.password_reset': 'Restableció la contraseña',
  'user.sessions_revoke': 'Cerró las sesiones',
  'user.delete': 'Eliminó una cuenta',
  'integration.create': 'Creó una integración',
  'integration.update': 'Editó una integración',
  'integration.enable': 'Habilitó una integración',
  'integration.disable': 'Deshabilitó una integración',
  'integration.delete': 'Eliminó una integración',
  'integration.key.create': 'Creó una llave de API',
  'integration.key.revoke': 'Revocó una llave de API',
  'integration.webhook.create': 'Agregó un webhook',
  'integration.webhook.update': 'Editó un webhook',
  'integration.webhook.delete': 'Eliminó un webhook',
  'integration.webhook.rotate_secret': 'Cambió el secreto de un webhook',
  'integration.webhook.test': 'Envió una prueba de webhook',
  'integration.delivery.retry': 'Reenvió una entrega',
  'geofence.create': 'Creó una geocerca',
  'geofence.update': 'Editó una geocerca',
  'geofence.enable': 'Activó una geocerca',
  'geofence.disable': 'Desactivó una geocerca',
  'geofence.delete': 'Eliminó una geocerca',
  'place.create': 'Creó un lugar compartido',
  'place.update': 'Editó un lugar compartido',
  'place.delete': 'Eliminó un lugar compartido',
  'route.delete': 'Eliminó una ruta guardada',
  'region.sync': 'Buscó regiones nuevas',
  'region.enable': 'Habilitó una región',
  'region.disable': 'Deshabilitó una región',
  'trip.finish': 'Terminó un viaje',
  'trip.cancel': 'Canceló un viaje',
};

/** Groups of actions for the filter of the audit log (the API matches the start of the action). */
export const AUDIT_GROUPS = [
  ['user.', 'Cuentas'],
  ['integration.', 'Integraciones'],
  ['geofence.', 'Geocercas'],
  ['place.', 'Lugares'],
  ['route.', 'Rutas'],
  ['region.', 'Regiones'],
  ['trip.', 'Viajes'],
];

export const TARGET_LABELS = {
  user: 'Cuenta',
  integration: 'Integración',
  geofence: 'Geocerca',
  place: 'Lugar',
  route: 'Ruta',
  region: 'Región',
  trip: 'Viaje',
};

export const label = (labels, value) => labels[value] ?? value ?? NONE;

/** Readable text for an API error code; the server message (English) when there is none. */
export const ERROR_MESSAGES = {
  OFFLINE: 'Sin conexión con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  VALIDATION_ERROR: 'Revisa los datos del formulario.',
  NOT_FOUND: 'No se encontró lo que buscas: puede que ya no exista.',
  CONFLICT: 'No se puede hacer ese cambio ahora.',
  UNAUTHORIZED: 'Tu sesión terminó. Inicia sesión de nuevo.',
  FORBIDDEN: 'Tu cuenta no tiene permiso para esto.',
  RATE_LIMIT_EXCEEDED: 'Demasiadas solicitudes seguidas. Espera un momento.',
  PAYLOAD_TOO_LARGE: 'Los datos enviados son demasiado grandes.',
  INTERNAL_ERROR: 'El servidor tuvo un problema. Inténtalo de nuevo.',
  EMAIL_ALREADY_REGISTERED: 'Ya existe una cuenta con ese correo.',
  INVALID_CREDENTIALS: 'Correo o contraseña incorrectos.',
  INVALID_REFRESH_TOKEN: 'Tu sesión terminó. Inicia sesión de nuevo.',
  INVALID_CURRENT_PASSWORD: 'La contraseña actual no es correcta.',
  ACCOUNT_DISABLED: 'Tu cuenta está deshabilitada. Comunícate con un administrador.',
  SESSION_REVOKED: 'Un administrador cerró tu sesión. Inicia sesión de nuevo.',
  USER_NOT_FOUND: 'La cuenta no existe.',
  LAST_ADMINISTRATOR: 'La plataforma necesita al menos un administrador activo.',
  SELF_CHANGE_NOT_ALLOWED: 'No puedes hacer ese cambio en tu propia cuenta.',
  INTEGRATION_NOT_FOUND: 'La integración no existe.',
  API_KEY_NOT_FOUND: 'La llave no existe.',
  WEBHOOK_NOT_FOUND: 'El webhook no existe.',
  WEBHOOK_DELIVERY_NOT_FOUND: 'La entrega no existe.',
  INVALID_WEBHOOK_URL: 'La URL del webhook no es válida para este servidor.',
  MAP_REGION_NOT_FOUND: 'La región no existe.',
  TRIP_NOT_FOUND: 'El viaje no existe.',
  TRIP_NOT_ACTIVE: 'El viaje ya no está en curso.',
  GEOFENCE_NOT_FOUND: 'La geocerca no existe.',
  PLACE_NOT_FOUND: 'El lugar no existe.',
  ROUTE_NOT_FOUND: 'La ruta no existe.',
  INVALID_COORDINATES: 'Las coordenadas no son válidas.',
  INVALID_GEOMETRY: 'La forma no es válida: revisa que el polígono no se cruce consigo mismo.',
};

/**
 * Text for an error of the API. Validation errors keep the server's details (which field failed),
 * and conflicts the server's reason, since those say what to change.
 */
export function errorText(error) {
  const known = ERROR_MESSAGES[error?.code];
  const detail = Array.isArray(error?.details) ? error.details.join('; ') : null;
  if (error?.code === 'VALIDATION_ERROR' && (detail || error.message)) {
    return `${known} (${detail ?? error.message})`;
  }
  if (error?.code === 'CONFLICT' && error.message) return `${known} (${error.message})`;
  if (known) return known;
  return error?.message || 'Ocurrió un error inesperado.';
}
