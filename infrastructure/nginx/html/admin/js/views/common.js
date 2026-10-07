// Pieces shared by several screens: status badges, account cells, detail headers and map panels.
import { alertBox, badge, clear, el, icon } from '../dom.js';
import {
  DELIVERY_STATUS_LABELS,
  label,
  NONE,
  PROFILE_LABELS,
  TRIP_STATUS_LABELS,
} from '../format.js';
import { createMap, mapUnavailableText } from '../map.js';

export const PROFILE_ICONS = { CAR: 'car', TRUCK: 'truck', MOTORCYCLE: 'moto', BICYCLE: 'bike', PEDESTRIAN: 'walk' };

export const profileCell = (profile) =>
  el('span', { class: 'inline-icon' }, icon(PROFILE_ICONS[profile] ?? 'route'), label(PROFILE_LABELS, profile));

const TRIP_TONES = { ACTIVE: 'info', COMPLETED: 'success', CANCELLED: 'neutral' };
export const tripStatusBadge = (status) => badge(label(TRIP_STATUS_LABELS, status), TRIP_TONES[status] ?? 'neutral');

const DELIVERY_TONES = { PENDING: 'warning', SENDING: 'info', SUCCEEDED: 'success', FAILED: 'danger' };
export const deliveryBadge = (status) => badge(label(DELIVERY_STATUS_LABELS, status), DELIVERY_TONES[status] ?? 'neutral');

export const activeBadge = (active, on = 'Activa', off = 'Deshabilitada') => badge(active ? on : off, active ? 'success' : 'neutral');

/** Name and email of an account; a link to its page for administrators. */
export function accountCell(ctx, account) {
  if (!account) return NONE;
  const content = el('span', { class: 'cell-title' },
    el('strong', {}, account.name || account.email),
    account.name && account.name !== account.email ? el('small', {}, account.email) : null);
  return ctx.isAdmin && account.id ? el('a', { href: `#/cuentas/${account.id}`, class: 'row-link' }, content) : content;
}

export const titleCell = (title, detail) =>
  el('span', { class: 'cell-title' }, el('strong', {}, title), detail ? el('small', {}, detail) : null);

/** "← Viajes" link back to the list of a detail screen. */
export const backLink = (href, text) =>
  el('a', { class: 'breadcrumb', href }, icon('chevron-left'), text);

/**
 * A map inside a frame. `ready` resolves with { map, maplibregl }, or with null when there is no
 * map to show (no region published yet, or the screen was closed meanwhile); then the frame
 * explains why instead. The frame must be in the page before the map loads (it needs a size).
 */
export function mapPanel(ctx, { className = '', hint = null, bounds, onClick } = {}) {
  const container = el('div', { class: 'map', role: 'region', 'aria-label': 'Mapa' });
  const hintNode = hint ? el('p', { class: 'map-frame__hint' }, hint) : null;
  const frame = el('div', { class: `map-frame ${className}`.trim() }, container, hintNode);
  const ready = Promise.resolve()
    .then(() => createMap(container, { bounds, onClick }))
    .then((result) => {
      if (ctx.signal.aborted) {
        result.map.remove();
        return null;
      }
      const observer = new ResizeObserver(() => result.map.resize());
      observer.observe(container);
      ctx.onCleanup(() => {
        observer.disconnect();
        result.map.remove();
      });
      return result;
    })
    .catch((error) => {
      if (ctx.signal.aborted) return null;
      frame.classList.add('map-frame--empty');
      clear(frame, alertBox('info', 'map', mapUnavailableText(error)));
      return null;
    });
  return { element: frame, ready, setHint: (text) => { if (hintNode) hintNode.textContent = text; } };
}
