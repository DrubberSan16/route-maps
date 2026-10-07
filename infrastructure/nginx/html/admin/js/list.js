// List screens of the panel: header, filters, a page of results and the pagination. The filters
// of a screen live in the address (#/viajes?status=ACTIVE), so a filtered list can be bookmarked
// or shared; changing them replaces the address instead of adding a step to the browser history.
// Lists inside a screen (the deliveries of an integration) keep their filters to themselves.
import { accountPicker } from './pickers.js';
import {
  button,
  clear,
  debounce,
  el,
  emptyState,
  errorBox,
  field,
  icon,
  iconButton,
  input,
  loading,
  select,
  table,
} from './dom.js';
import { countOf, formatNumber } from './format.js';
import { pages } from './router.js';

export const PAGE_SIZE = 25;

/** Page heading shared by every screen. */
export function pageHeader(title, description, actions = []) {
  return el('header', { class: 'page__header' },
    el('div', { class: 'page__heading' },
      el('h1', { class: 'page__title', tabindex: -1 }, title),
      description ? el('p', { class: 'page__description' }, description) : null),
    actions.length ? el('div', { class: 'actions page__actions' }, actions) : null);
}

/**
 * Filters, results and pagination. filters: [{ name, label, type: 'search' | 'select' | 'date' |
 * 'account' | 'fixed', options, placeholder }]; load(state) returns a page ({ items, total, limit,
 * offset }). With `inAddress` the filters are read from and written to the address of the screen.
 * A 'fixed' filter comes from a link of another screen (the operations of one device): it shows
 * while set, with its `<name>Label`, and can only be removed.
 */
export function createList(ctx, {
  title,
  filters = [],
  columns,
  rowHref,
  load,
  empty = 'Todavía no hay nada aquí.',
  emptyFiltered = 'No hay resultados con esos filtros.',
  pageSize = PAGE_SIZE,
  inAddress = false,
  initial = {},
}) {
  const state = inAddress
    ? { ...ctx.query, offset: Math.max(0, Number(ctx.query.offset) || 0) }
    : { ...initial, offset: 0 };
  const results = el('div', { class: 'list__results', 'aria-live': 'polite' });
  const summary = el('p', { class: 'list__summary' });
  const pagination = el('nav', { class: 'pagination', 'aria-label': `Páginas de ${title}` });
  let sequence = 0;

  const remember = () => {
    if (inAddress) ctx.replaceQuery(state);
  };
  const apply = (changes) => {
    Object.assign(state, changes, { offset: 0 });
    remember();
    reload();
  };

  const companions = (name) => [`${name}Email`, `${name}Label`];
  const controls = filters.map((filter) => {
    if (filter.type === 'fixed') {
      if (!state[filter.name]) return null;
      const chip = el('div', { class: 'field' },
        el('span', { class: 'field__label' }, filter.label),
        el('span', { class: 'chip' },
          el('span', { class: 'chip__text' }, state[`${filter.name}Label`] ?? state[filter.name]),
          iconButton('x', `Quitar el filtro ${filter.label}`, () => {
            delete state[filter.name];
            for (const name of companions(filter.name)) delete state[name];
            state.offset = 0;
            remember();
            chip.remove();
            reload();
          })));
      return chip;
    }
    if (filter.type === 'select') {
      const control = select(filter.options, state[filter.name] ?? '', { name: filter.name });
      control.addEventListener('change', () => apply({ [filter.name]: control.value || undefined }));
      return field(filter.label, control);
    }
    if (filter.type === 'date') {
      const control = input({ type: 'date', name: filter.name, value: state[filter.name] ?? '' });
      control.addEventListener('change', () => apply({ [filter.name]: control.value || undefined }));
      return field(filter.label, control);
    }
    if (filter.type === 'account') {
      return field(filter.label, accountPicker(ctx, {
        value: state[filter.name] ? { id: state[filter.name], email: state[`${filter.name}Email`] ?? state[filter.name] } : null,
        placeholder: filter.placeholder ?? 'Correo de la cuenta',
        onChange: (account) => apply({
          [filter.name]: account?.id,
          [`${filter.name}Email`]: account?.email,
        }),
      }));
    }
    const control = input({
      type: 'search',
      name: filter.name,
      value: state[filter.name] ?? '',
      placeholder: filter.placeholder ?? 'Buscar',
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: 120,
    });
    control.addEventListener('input', debounce(() => apply({ [filter.name]: control.value.trim() || undefined }), 350));
    const searchField = field(filter.label, control);
    searchField.classList.add('filters__search');
    return searchField;
  });

  const hasFilters = () => filters.some((filter) => state[filter.name]);
  const clearButton = button('Quitar filtros', {
    icon: 'x',
    variant: 'ghost',
    onClick: () => {
      for (const filter of filters) {
        delete state[filter.name];
        for (const name of companions(filter.name)) delete state[name];
      }
      state.offset = 0;
      remember();
      // The controls are rebuilt empty with the screen (or emptied here for inner lists).
      if (inAddress) ctx.reload();
      else {
        for (const control of filterForm.querySelectorAll('input, select')) control.value = '';
        for (const chip of filterForm.querySelectorAll('.chip')) chip.closest('.field').remove();
        reload();
      }
    },
  });
  const filterForm = controls.some(Boolean)
    ? el('form', { class: 'filters', role: 'search', onsubmit: (event) => event.preventDefault() },
      controls, el('div', { class: 'filters__actions' }, clearButton))
    : null;
  // Phones: three or more filters fold under «Filtros» so the results come first.
  const foldText = el('span');
  const foldSummary = filterForm && controls.filter(Boolean).length > 2 && window.matchMedia('(max-width: 767px)').matches
    ? el('summary', { class: 'filters-fold__summary' }, icon('chevron-right', 'icon filters-fold__icon'), foldText)
    : null;
  const filterBlock = foldSummary
    ? el('details', { class: 'filters-fold', open: hasFilters() }, foldSummary, filterForm)
    : filterForm;

  async function reload() {
    const current = ++sequence;
    clearButton.hidden = !hasFilters();
    if (foldSummary) {
      const applied = filters.filter((filter) => state[filter.name]).length;
      foldText.textContent = applied ? `Filtros · ${countOf(applied, 'aplicado', 'aplicados')}` : 'Filtros';
    }
    clear(summary);
    clear(pagination);
    clear(results, loading());
    let page;
    try {
      page = await load({ ...state, limit: pageSize });
    } catch (error) {
      if (current === sequence && !ctx.signal.aborted && error?.name !== 'AbortError') clear(results, errorBox(error, reload));
      return;
    }
    if (current !== sequence || ctx.signal.aborted) return;
    // A page past the end (rows deleted meanwhile): back to the last page with rows.
    if (page.items.length === 0 && page.total > 0 && state.offset > 0) {
      state.offset = Math.max(0, Math.floor((page.total - 1) / pageSize) * pageSize);
      remember();
      reload();
      return;
    }
    renderPage(page);
  }

  function renderPage(page) {
    if (page.items.length === 0) {
      clear(results, emptyState(hasFilters() ? emptyFiltered : empty));
      return;
    }
    const range = pages(page);
    summary.textContent = `${formatNumber(range.from)}–${formatNumber(range.to)} de ${formatNumber(page.total)}`;
    clear(results, table(columns, page.items, { rowHref, caption: title }));
    const go = (offset) => {
      state.offset = offset;
      remember();
      reload();
      element.scrollIntoView({ block: 'start' });
    };
    if (range.previous !== null || range.next !== null) {
      clear(pagination,
        button('Anterior', { icon: 'chevron-left', variant: 'ghost', disabled: range.previous === null, onClick: () => go(range.previous) }),
        el('span', { class: 'pagination__page' },
          `Página ${formatNumber(Math.floor(page.offset / pageSize) + 1)} de ${formatNumber(Math.ceil(page.total / pageSize))}`),
        button('Siguiente', { icon: 'chevron-right', variant: 'ghost', disabled: range.next === null, onClick: () => go(range.next) }));
    }
  }

  const element = el('div', { class: 'stack' },
    filterBlock,
    el('section', { class: 'card card--flush list', 'aria-label': title },
      el('div', { class: 'list__bar' }, summary), results, pagination));
  reload();
  return { element, reload };
}

/** A list screen: heading, filters in the address, results. */
export function listView(ctx, { title, description, actions = [], before = null, ...options }) {
  const list = createList(ctx, { ...options, title, inAddress: true });
  clear(ctx.outlet, el('div', { class: 'page' }, pageHeader(title, description, actions), before, list.element));
  return list;
}
