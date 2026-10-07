// Administration panel of Route Maps: sign-in, navigation and the screens (one module per screen
// in ./views, loaded when first opened). No build step and no third-party code at runtime: the
// page uses the platform's own API (/api/v1/admin/...) and, for maps, the MapLibre and PMTiles
// copies this server already serves to the viewer.
import { busy, button, clear, el, icon, toast } from './dom.js';
import { errorText, label, ROLE_LABELS } from './format.js';
import { buildHash, parseHash } from './router.js';
import { ApiError, createApi, Session } from './session.js';

const STAFF = new Set(['ADMIN', 'OPERATOR']);

/** Screens: address, title, icon of the sprite, group of the menu and who sees it. */
const ROUTES = [
  { path: 'resumen', title: 'Resumen', icon: 'gauge', group: 'General', view: () => import('./views/overview.js') },
  { path: 'en-vivo', title: 'Mapa en vivo', icon: 'radio', group: 'General', view: () => import('./views/live.js') },
  { path: 'viajes', title: 'Viajes', icon: 'route', group: 'Operación', view: () => import('./views/trips.js') },
  { path: 'dispositivos', title: 'Dispositivos', icon: 'smartphone', group: 'Operación', view: () => import('./views/devices.js') },
  { path: 'geocercas', title: 'Geocercas', icon: 'hexagon', group: 'Operación', view: () => import('./views/geofences.js') },
  { path: 'lugares', title: 'Lugares', icon: 'pin', group: 'Operación', view: () => import('./views/places.js') },
  { path: 'rutas', title: 'Rutas guardadas', icon: 'directions', group: 'Operación', view: () => import('./views/routes.js') },
  { path: 'sincronizacion', title: 'Sincronización', icon: 'sync', group: 'Operación', view: () => import('./views/sync.js') },
  { path: 'regiones', title: 'Regiones de mapa', icon: 'map', group: 'Plataforma', view: () => import('./views/regions.js') },
  { path: 'eventos', title: 'Eventos', icon: 'activity', group: 'Plataforma', view: () => import('./views/events.js') },
  { path: 'integraciones', title: 'Integraciones', icon: 'plug', group: 'Plataforma', admin: true, view: () => import('./views/integrations.js') },
  { path: 'cuentas', title: 'Cuentas', icon: 'users', group: 'Plataforma', admin: true, view: () => import('./views/users.js') },
  { path: 'auditoria', title: 'Auditoría', icon: 'shield', group: 'Plataforma', admin: true, view: () => import('./views/audit.js') },
  { path: 'mi-cuenta', title: 'Mi cuenta', icon: 'user', hidden: true, view: () => import('./views/account.js') },
];
const HOME = 'resumen';

const SIGN_OUT_REASONS = {
  ACCOUNT_DISABLED: 'Tu cuenta fue deshabilitada. Comunícate con un administrador.',
  SESSION_REVOKED: 'Un administrador cerró tu sesión. Inicia sesión de nuevo.',
  INVALID_REFRESH_TOKEN: 'Tu sesión terminó. Inicia sesión de nuevo.',
  UNAUTHORIZED: 'Tu sesión terminó. Inicia sesión de nuevo.',
  NOT_STAFF: 'Tu cuenta no tiene acceso al panel: es solo para administradores y operadores.',
};

const session = new Session();
const api = createApi(session);
const $ = (id) => document.getElementById(id);
const phone = window.matchMedia('(max-width: 1023px)');

let meta = null;
let current = null; // { controller, cleanups, route, segments }

// ---------------------------------------------------------------- sign-in

function showLogin(message = '', tone = 'danger') {
  closeView();
  meta = null;
  document.body.classList.remove('is-signed-in');
  $('app').hidden = true;
  $('login').hidden = false;
  const status = $('login-status');
  status.textContent = message;
  status.className = `login__status${message ? ` login__status--${tone}` : ''}`;
  status.hidden = !message;
  $('login-password').value = '';
  ($('login-email').value ? $('login-password') : $('login-email')).focus();
}

async function signIn(event) {
  event.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email || !password) return;
  const submit = $('login-submit');
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  $('login-status').hidden = true;
  try {
    const user = await session.signIn(email, password);
    if (!STAFF.has(user.role)) {
      await session.signOut();
      showLogin(SIGN_OUT_REASONS.NOT_STAFF);
      return;
    }
    await start();
  } catch (error) {
    showLogin(errorText(error));
  } finally {
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
  }
}

/** Loads the member and the catalogues, then shows the panel. */
async function start() {
  try {
    meta = await api.get('/admin/meta');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'FORBIDDEN') {
      await session.signOut();
      showLogin(SIGN_OUT_REASONS.NOT_STAFF);
      return;
    }
    if (!session.signedIn) return; // the session ended: the sign-in screen is already shown
    showLogin(errorText(error));
    return;
  }
  document.body.classList.add('is-signed-in');
  $('login').hidden = true;
  $('app').hidden = false;
  renderNav();
  renderUser();
  await render();
}

async function signOut() {
  await session.signOut();
  history.replaceState(null, '', window.location.pathname);
  showLogin('Cerraste la sesión.', 'info');
}

// ---------------------------------------------------------------- navigation

const isAdmin = () => meta?.user.role === 'ADMIN';
const allowed = (route) => !route.admin || isAdmin();

function renderNav() {
  const nav = clear($('nav'));
  const groups = new Map();
  for (const route of ROUTES) {
    if (route.hidden || !allowed(route)) continue;
    if (!groups.has(route.group)) groups.set(route.group, []);
    groups.get(route.group).push(route);
  }
  for (const [group, routes] of groups) {
    nav.append(el('p', { class: 'nav__group' }, group), el('ul', { class: 'nav__list' }, routes.map((route) =>
      el('li', {}, el('a', { class: 'nav__link', href: `#/${route.path}`, 'data-path': route.path },
        icon(route.icon), el('span', {}, route.title))))));
  }
}

function renderUser() {
  const { user } = meta;
  clear($('user-chip'),
    el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(user.name || user.email)),
    el('span', { class: 'user-chip__text' },
      el('strong', {}, user.name || user.email),
      el('small', {}, label(ROLE_LABELS, user.role))));
  $('version').textContent = `Versión ${meta.version}`;
}

const initials = (text) => text.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');

function markCurrent(path) {
  for (const link of document.querySelectorAll('.nav__link')) {
    if (link.dataset.path === path) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const account = $('user-chip');
  if (path === 'mi-cuenta') account.setAttribute('aria-current', 'page');
  else account.removeAttribute('aria-current');
}

function setNavOpen(open) {
  document.body.classList.toggle('is-nav-open', open);
  $('menu-button').setAttribute('aria-expanded', String(open));
  $('sidebar').inert = phone.matches && !open;
  $('scrim').hidden = !open;
  if (open) $('sidebar').querySelector('a, button')?.focus();
}

function closeView() {
  if (!current) return;
  current.controller.abort();
  for (const cleanup of current.cleanups.splice(0)) {
    try {
      cleanup();
    } catch {
      // A screen that fails to clean up must not stop the next one.
    }
  }
  current = null;
}

/** Shows the screen of the address. */
async function render() {
  if (!meta) return;
  const { segments, query } = parseHash(window.location.hash);
  const route = ROUTES.find((item) => item.path === segments[0]);
  if (!route || !allowed(route)) {
    history.replaceState(null, '', `#/${HOME}`);
    if (route && !allowed(route)) toast('Esa sección es solo para administradores.', 'warning');
    return render();
  }
  closeView();
  const outlet = $('view');
  const controller = new AbortController();
  const state = { controller, cleanups: [], route, segments };
  current = state;
  markCurrent(route.path);
  if (phone.matches) setNavOpen(false);
  document.title = `${route.title} · Administración · Route Maps`;
  $('topbar-title').textContent = route.title;
  clear(outlet, el('p', { class: 'loading', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Cargando…'));

  const ctx = {
    api,
    session,
    meta,
    user: meta.user,
    isAdmin: isAdmin(),
    timeZone: meta.timeZone,
    route,
    segments: segments.slice(1),
    query,
    outlet,
    signal: controller.signal,
    onCleanup: (fn) => state.cleanups.push(fn),
    navigate: (path, params = {}) => {
      window.location.hash = buildHash(Array.isArray(path) ? path : [path], params);
    },
    /** Updates the filters in the address without a new history entry or a new render. */
    replaceQuery: (params) => {
      if (current !== state) return;
      const cleaned = { ...params };
      if (!Number(cleaned.offset)) delete cleaned.offset;
      for (const [name, value] of Object.entries(cleaned)) {
        if (value === undefined || value === null || value === '') delete cleaned[name];
      }
      ctx.query = cleaned;
      history.replaceState(null, '', buildHash(segments, cleaned));
    },
    reload: () => render(),
    /** After the member's own account changed (name, password). */
    refreshMeta: async () => {
      meta = await api.get('/admin/meta');
      renderUser();
    },
    signOut: () => signOut(),
  };

  try {
    const module = await route.view();
    if (current !== state) return;
    await module.render(ctx);
  } catch (error) {
    if (current !== state || controller.signal.aborted) return;
    if (!session.signedIn) return;
    clear(outlet, el('div', { class: 'page' }, el('div', { class: 'alert alert--danger', role: 'alert' },
      icon('alert'), el('div', { class: 'alert__body' },
        el('p', {}, error instanceof ApiError ? errorText(error) : 'No se pudo abrir esta pantalla.'),
        button('Reintentar', { icon: 'refresh', variant: 'ghost', onClick: () => render() })))));
    console.error(error);
  }
  // Move the focus to the new heading (screen readers announce the screen that opened).
  if (current === state) outlet.querySelector('.page__title')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- start

function wire() {
  $('login-form').addEventListener('submit', signIn);
  $('sign-out').addEventListener('click', (event) => busy(event.currentTarget, signOut));
  $('menu-button').addEventListener('click', () => setNavOpen(!document.body.classList.contains('is-nav-open')));
  $('scrim').addEventListener('click', () => setNavOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('is-nav-open') && !document.querySelector('dialog[open]')) {
      setNavOpen(false);
      $('menu-button').focus();
    }
  });
  phone.addEventListener('change', () => setNavOpen(false));
  window.addEventListener('hashchange', () => render());
  session.onEnd((code) => showLogin(SIGN_OUT_REASONS[code] ?? SIGN_OUT_REASONS.UNAUTHORIZED));
}

async function main() {
  wire();
  setNavOpen(false);
  if (!session.restore()) {
    showLogin();
    return;
  }
  try {
    await session.refresh();
  } catch (error) {
    if (session.signedIn) {
      // The server could not be reached: keep the session and offer to try again.
      showLogin(errorText(error));
    }
    return;
  }
  await start();
}

main();
