// Account picker: a search field that suggests accounts by email or name (GET /admin/accounts),
// with the combobox keyboard pattern (arrows, Enter, Escape).
import { debounce, el, input, uid } from './dom.js';
import { label, ROLE_LABELS } from './format.js';

/**
 * value: { id, email } or null. onChange(account | null) runs when an account is chosen or the
 * field is emptied. The returned element has `selected()` with the chosen account.
 */
export function accountPicker(ctx, { value = null, onChange = () => {}, placeholder = 'Correo o nombre', required = false } = {}) {
  const listId = uid('accounts');
  const control = input({
    type: 'search',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder,
    required,
    maxlength: 120,
    value: value?.email ?? '',
  });
  const list = el('ul', { class: 'listbox', id: listId, role: 'listbox', hidden: true });
  const wrapper = el('div', { class: 'combobox' }, control, list);
  let selected = value?.id ? value : null;
  let options = [];
  let active = -1;
  let sequence = 0;

  const show = (visible) => {
    list.hidden = !visible;
    control.setAttribute('aria-expanded', String(visible));
    if (!visible) control.removeAttribute('aria-activedescendant');
  };

  const highlight = (index) => {
    active = index;
    [...list.children].forEach((item, position) => item.setAttribute('aria-selected', String(position === index)));
    const item = list.children[index];
    if (item) {
      control.setAttribute('aria-activedescendant', item.id);
      item.scrollIntoView({ block: 'nearest' });
    }
  };

  const choose = (account) => {
    selected = account;
    control.value = account.email;
    show(false);
    onChange(account);
  };

  const render = () => {
    list.replaceChildren();
    if (options.length === 0) {
      list.append(el('li', { class: 'listbox__empty', role: 'presentation' }, 'Ninguna cuenta coincide.'));
      show(true);
      return;
    }
    options.forEach((account, index) => {
      const item = el('li', { id: `${listId}-${index}`, role: 'option', class: 'listbox__option', 'aria-selected': 'false' },
        el('span', { class: 'listbox__title' }, account.email),
        el('span', { class: 'listbox__detail' },
          [account.name, account.serviceAccount ? 'Integración' : label(ROLE_LABELS, account.role),
            account.active ? null : 'Deshabilitada'].filter(Boolean).join(' · ')));
      // mousedown, not click: the field keeps the focus (no blur that would close the list first).
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(account);
      });
      list.append(item);
    });
    highlight(-1);
    show(true);
  };

  const search = debounce(async (text) => {
    const current = ++sequence;
    try {
      const found = await ctx.api.get('/admin/accounts', { q: text, limit: 8 });
      if (current !== sequence || document.activeElement !== control) return;
      options = found;
      render();
    } catch {
      if (current === sequence) show(false);
    }
  }, 250);

  control.addEventListener('input', () => {
    const text = control.value.trim();
    if (selected && text !== selected.email) {
      selected = null;
      onChange(null);
    }
    if (text.length === 0) {
      sequence += 1;
      show(false);
      return;
    }
    search(text);
  });

  control.addEventListener('keydown', (event) => {
    if (list.hidden || options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight((active + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active <= 0 ? options.length - 1 : active - 1);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      show(false);
    }
  });

  control.addEventListener('blur', () => {
    show(false);
    // Text typed but no account chosen: back to the chosen account (or empty).
    if (!selected && control.value.trim()) control.value = '';
    if (selected) control.value = selected.email;
  });

  wrapper.selected = () => selected;
  wrapper.fieldControl = control;
  return wrapper;
}
