// Building blocks of the panel's screens. Text always goes in as text nodes (never as HTML), so
// names, addresses or payloads written by other people cannot inject markup.
import { errorText } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let nextId = 0;

/** A unique id for labels and ARIA references. */
export const uid = (prefix = 'id') => `${prefix}-${++nextId}`;

/** el('a', { href, class }, 'text', otherNode): attributes with false/null/undefined are left out. */
export function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.append(child instanceof Node ? child : String(child));
  }
}

export function clear(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

/** An icon of the sprite of index.html (Lucide-style stroke icons). */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function svg(tag, attributes = {}, ...children) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  }
  append(element, children);
  return element;
}

/** variant: primary, secondary, ghost or danger. */
export function button(text, { icon: iconName, variant = 'secondary', onClick, type = 'button', ...rest } = {}) {
  return el('button', { type, class: `btn btn--${variant}`, onclick: onClick, ...rest },
    iconName ? icon(iconName) : null, text);
}

export function iconButton(iconName, labelText, onClick, attributes = {}) {
  return el('button', {
    type: 'button',
    class: 'icon-button',
    'aria-label': labelText,
    title: labelText,
    onclick: onClick,
    ...attributes,
  }, icon(iconName));
}

/** tone: success, warning, danger, info or neutral. */
export const badge = (text, tone = 'neutral') => el('span', { class: `badge badge--${tone}` }, text);

export const link = (href, text, attributes = {}) => el('a', { href, ...attributes }, text);

/** A form field: label, control, optional hint and the place where its error shows. */
export function field(labelText, control, { hint, wide = false } = {}) {
  // Composite controls (the account picker) name the element the label points to.
  const target = control.fieldControl ?? control;
  target.id ||= uid('field');
  const hintNode = hint ? el('p', { class: 'field__hint', id: uid('hint') }, hint) : null;
  if (hintNode) target.setAttribute('aria-describedby', hintNode.id);
  return el('div', { class: `field${wide ? ' field--wide' : ''}` },
    el('label', { class: 'field__label', for: target.id }, labelText), control, hintNode);
}

export const input = (attributes = {}) => el('input', { class: 'input', type: 'text', ...attributes });

export const textarea = (attributes = {}) => el('textarea', { class: 'input input--area', rows: 4, ...attributes });

/** options: [[value, label], ...]; the option equal to `value` is selected. */
export function select(options, value = '', attributes = {}) {
  const control = el('select', { class: 'input input--select', ...attributes });
  for (const [optionValue, text] of options) {
    const option = el('option', { value: optionValue }, text);
    if (String(optionValue) === String(value ?? '')) option.selected = true;
    control.append(option);
  }
  return control;
}

export function checkbox(labelText, { checked = false, name, value, hint, disabled = false } = {}) {
  const control = el('input', { type: 'checkbox', class: 'checkbox__input', name, value, disabled });
  control.checked = checked;
  return el('label', { class: 'checkbox' }, control,
    el('span', { class: 'checkbox__text' }, labelText, hint ? el('small', {}, hint) : null));
}

/** Label/value pairs; values can be nodes. Pairs whose value is null are left out. */
export function facts(pairs, className = '') {
  const list = el('dl', { class: `facts ${className}`.trim() });
  for (const [term, value] of pairs) {
    if (value === null || value === undefined) continue;
    list.append(el('div', { class: 'facts__item' }, el('dt', {}, term), el('dd', {}, value)));
  }
  return list;
}

export const code = (value) =>
  el('pre', { class: 'code', tabindex: 0 }, typeof value === 'string' ? value : JSON.stringify(value, null, 2));

export const emptyState = (text, ...actions) =>
  el('div', { class: 'empty' }, icon('inbox', 'icon empty__icon'), el('p', {}, text),
    actions.length ? el('div', { class: 'actions' }, actions) : null);

export const loading = (text = 'Cargando…') =>
  el('p', { class: 'loading', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), text);

export function errorBox(error, retry) {
  return el('div', { class: 'alert alert--danger', role: 'alert' },
    icon('alert'), el('div', { class: 'alert__body' }, el('p', {}, errorText(error)),
      retry ? button('Reintentar', { icon: 'refresh', variant: 'ghost', onClick: retry }) : null));
}

export const alertBox = (tone, iconName, ...content) =>
  el('div', { class: `alert alert--${tone}` }, icon(iconName), el('div', { class: 'alert__body' }, content));

/** Card with a header (title, optional actions) and a body. */
export function card(title, body, { actions = [], className = '', id } = {}) {
  const headingId = uid('card');
  return el('section', { class: `card ${className}`.trim(), 'aria-labelledby': headingId, id },
    title || actions.length
      ? el('header', { class: 'card__header' },
        el('h2', { class: 'card__title', id: headingId }, title),
        actions.length ? el('div', { class: 'actions' }, actions) : null)
      : null,
    body);
}

/**
 * A table that becomes a list of cards on phones (each cell shows its column name).
 * columns: [{ label, render(row) -> Node|string, className }]; rowHref(row) makes rows links.
 */
export function table(columns, rows, { rowHref, caption } = {}) {
  const head = el('thead', {}, el('tr', {}, columns.map((column) =>
    el('th', { scope: 'col', class: column.className }, column.label))));
  const body = el('tbody');
  for (const row of rows) {
    const href = rowHref?.(row);
    const tr = el('tr', { class: href ? 'is-link' : null });
    columns.forEach((column, index) => {
      let content = column.render(row);
      // The first cell holds the real link (keyboard, middle click); the row forwards clicks to it.
      if (index === 0 && href) content = el('a', { href, class: 'row-link' }, content);
      tr.append(el('td', { class: column.className, 'data-label': column.label }, content));
    });
    if (href) {
      tr.addEventListener('click', (event) => {
        if (event.target.closest('a, button, input, select, label')) return;
        window.location.hash = href;
      });
    }
    body.append(tr);
  }
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'table' }, caption ? el('caption', { class: 'sr-only' }, caption) : null, head, body));
}

// ---------------------------------------------------------------- dialogs

/**
 * Modal dialog. `body` is a node or a function (close) => node. Resolves with the value passed
 * to close() (undefined when dismissed with Escape or the close button).
 */
export function openDialog({ title, description, body, actions = [], size = 'md', onOpen }) {
  return new Promise((resolve) => {
    const titleId = uid('dialog');
    let result;
    const dialog = el('dialog', { class: `dialog dialog--${size}`, 'aria-labelledby': titleId });
    const close = (value) => {
      result = value;
      dialog.close();
    };
    append(dialog, [
      el('header', { class: 'dialog__header' },
        el('div', {}, el('h2', { class: 'dialog__title', id: titleId }, title),
          description ? el('p', { class: 'dialog__description' }, description) : null),
        iconButton('x', 'Cerrar', () => close(undefined))),
      el('div', { class: 'dialog__body' }, typeof body === 'function' ? body(close) : body),
      actions.length ? el('footer', { class: 'dialog__footer' }, actions.map((action) =>
        typeof action === 'function' ? action(close) : action)) : null,
    ]);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    onOpen?.(dialog);
  });
}

/**
 * Dialog with a form. `submit(form)` runs on submit; an error keeps the dialog open and shows
 * the reason. Resolves with what `submit` returned, or undefined when cancelled.
 */
export function formDialog({ title, description, fields, submitLabel = 'Guardar', submit, size = 'md', tone = 'primary', onOpen }) {
  return openDialog({
    title,
    description,
    size,
    onOpen,
    body: (close) => {
      const status = el('div', { class: 'form__status', role: 'alert' });
      const submitButton = button(submitLabel, { type: 'submit', variant: tone });
      const form = el('form', { class: 'form', novalidate: false },
        el('div', { class: 'form__fields' }, typeof fields === 'function' ? fields() : fields),
        status,
        el('div', { class: 'form__actions' },
          button('Cancelar', { variant: 'ghost', onClick: () => close(undefined) }),
          submitButton));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clear(status);
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
        try {
          close(await submit(form));
        } catch (error) {
          clear(status, el('p', { class: 'form__error' }, icon('alert'), errorText(error)));
        } finally {
          submitButton.disabled = false;
          submitButton.removeAttribute('aria-busy');
        }
      });
      return form;
    },
  });
}

/** Asks before an action. With `confirmText`, the member types it to enable the button. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', tone = 'danger', confirmText, run }) {
  const typed = confirmText ? input({ autocomplete: 'off', spellcheck: 'false' }) : null;
  return formDialog({
    title,
    size: 'sm',
    tone,
    submitLabel: confirmLabel,
    fields: [
      el('p', { class: 'dialog__message' }, message),
      typed ? field(`Escribe ${confirmText} para confirmar`, typed) : null,
    ],
    submit: async () => {
      if (typed && typed.value.trim() !== confirmText) {
        throw new Error(`Escribe exactamente ${confirmText}.`);
      }
      if (run) await run();
      return true;
    },
  }).then((value) => value === true);
}

/** Shows a secret once (API key, webhook secret, temporary password) with a copy button. */
export function secretDialog({ title, description, secret, extra }) {
  return openDialog({
    title,
    size: 'md',
    body: el('div', { class: 'secret' },
      description ? el('p', {}, description) : null,
      el('div', { class: 'secret__value' },
        el('code', { class: 'secret__text' }, secret),
        copyButton(secret, 'Copiar')),
      alertBox('warning', 'alert', 'Cópialo ahora y guárdalo en un lugar seguro: no se volverá a mostrar.'),
      extra ?? null),
    actions: [(close) => button('Ya lo guardé', { variant: 'primary', onClick: () => close(true) })],
  });
}

export function copyButton(text, labelText = 'Copiar') {
  const control = button(labelText, {
    icon: 'copy',
    variant: 'secondary',
    onClick: async () => {
      const done = await copyText(text);
      toast(done ? 'Copiado al portapapeles.' : 'No se pudo copiar: selecciónalo y cópialo a mano.', done ? 'success' : 'warning');
    },
  });
  return control;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Without HTTPS the clipboard API is not available: copy from a hidden field.
    const area = el('textarea', { class: 'sr-only', readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let done = false;
    try {
      done = document.execCommand('copy');
    } catch {
      done = false;
    }
    area.remove();
    return done;
  }
}

// ---------------------------------------------------------------- notices

export function toast(message, tone = 'info') {
  const region = document.getElementById('toasts');
  if (!region) return;
  const item = el('div', { class: `toast toast--${tone}`, role: tone === 'danger' ? 'alert' : 'status' },
    icon(tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'), el('span', {}, message));
  region.append(item);
  setTimeout(() => item.remove(), tone === 'danger' ? 8000 : 4000);
}

/** Runs an action of a button: disabled while it runs, errors shown as a notice. */
export async function busy(control, action) {
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  try {
    return await action();
  } catch (error) {
    toast(errorText(error), 'danger');
    return undefined;
  } finally {
    control.disabled = false;
    control.removeAttribute('aria-busy');
  }
}

/** Calls `fn` at most once every `ms` while typing (the last call wins). */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
