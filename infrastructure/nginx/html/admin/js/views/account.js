// Mi cuenta: the signed-in member's name, password and session.
import { button, card, clear, el, facts, field, icon, input, toast } from '../dom.js';
import { errorText, label, ROLE_LABELS } from '../format.js';
import { pageHeader } from '../list.js';

/** A form inside a card that shows its own result (no dialog). */
function inlineForm(fields, submitLabel, submit) {
  const status = el('div', { class: 'form__status', role: 'alert' });
  const submitButton = button(submitLabel, { type: 'submit', variant: 'primary' });
  const form = el('form', { class: 'form' },
    el('div', { class: 'form__fields form__fields--single' }, fields),
    status,
    el('div', { class: 'form__actions' }, submitButton));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear(status);
    if (!form.reportValidity()) return;
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    try {
      await submit(form);
    } catch (error) {
      clear(status, el('p', { class: 'form__error' }, icon('alert'), errorText(error)));
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    }
  });
  return form;
}

export function render(ctx) {
  const { user } = ctx.meta;

  const name = input({ required: true, maxlength: 120, value: user.name ?? '', autocomplete: 'name' });
  const profile = inlineForm([field('Nombre', name, { hint: 'Así te ven los demás en la auditoría y en las listas.' })], 'Guardar nombre', async () => {
    await ctx.api.patch('/users/me', { name: name.value.trim() });
    toast('Nombre guardado.', 'success');
    await ctx.refreshMeta();
  });

  const current = input({ type: 'password', required: true, maxlength: 128, autocomplete: 'current-password' });
  const next = input({ type: 'password', required: true, minlength: 8, maxlength: 128, autocomplete: 'new-password' });
  const repeat = input({ type: 'password', required: true, minlength: 8, maxlength: 128, autocomplete: 'new-password' });
  const password = inlineForm([
    field('Contraseña actual', current),
    field('Contraseña nueva', next, { hint: 'Al menos 8 caracteres. Mejor una frase larga que no uses en otro sitio.' }),
    field('Repite la contraseña nueva', repeat),
  ], 'Cambiar contraseña', async (form) => {
    if (next.value !== repeat.value) throw new Error('Las contraseñas nuevas no coinciden.');
    const tokens = await ctx.api.post('/auth/password', { currentPassword: current.value, newPassword: next.value });
    // The change closes every session, this one included: keep the new pair it returns.
    ctx.session.adopt(tokens);
    form.reset();
    toast('Contraseña cambiada. Se cerraron tus sesiones en la app y en otros navegadores.', 'success');
  });

  clear(ctx.outlet, el('div', { class: 'page' },
    pageHeader('Mi cuenta', 'Tus datos, tu contraseña y tu sesión en este panel.'),
    el('div', { class: 'grid grid--2' },
      el('div', { class: 'stack' },
        card('Tus datos', el('div', { class: 'stack' },
          facts([
            ['Correo', user.email],
            ['Rol', label(ROLE_LABELS, user.role)],
            ['Puede', user.role === 'ADMIN'
              ? 'Todo: también cuentas, integraciones, auditoría y regiones.'
              : 'Operar viajes, geocercas y lugares, y ver eventos, dispositivos y regiones.'],
          ], 'facts--stacked'),
          profile)),
        card('Sesión', el('div', { class: 'stack' },
          el('p', {}, 'La sesión de este panel se guarda solo en esta pestaña: si la cierras, tendrás que iniciar sesión de nuevo.'),
          el('div', { class: 'actions' },
            button('Cerrar sesión', { icon: 'logout', onClick: () => ctx.signOut() }))))),
      card('Cambiar contraseña', el('div', { class: 'stack' },
        el('p', { class: 'muted small' }, 'Cierra también tus sesiones en la app y en otros navegadores.'),
        password)))));
}
