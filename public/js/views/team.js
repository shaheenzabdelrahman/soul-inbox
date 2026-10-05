import { t } from '../i18n.js';
import { api, esc, modal, showError, timeAgo, toast } from '../util.js';
import { can, loadMe, store } from '../store.js';

const state = { el: null, items: [] };
const ROLES = ['agent', 'supervisor', 'manager', 'admin'];

function userForm(u = {}) {
  const roles = ROLES.filter((r) => r !== 'admin' || can('users.manage_admins'));
  return `
    <label class="field">${esc(t('name'))}<input name="name" required value="${esc(u.name || '')}"></label>
    ${u.id ? '' : `<label class="field">${esc(t('email'))}<input name="email" type="email" required></label>`}
    <label class="field">${esc(t('role'))}<select name="role">${roles.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(t(`role_${r}`))}</option>`).join('')}</select></label>
    <label class="field">${esc(u.id ? t('newPassword') : t('password'))}<input name="password" type="password" minlength="10" autocomplete="new-password" ${u.id ? '' : 'required'}></label>
    <div class="grid-2">
      <label class="field">${esc(t('maxOpen'))}<input name="max_open" type="number" min="1" max="500" value="${esc(u.max_open ?? 30)}"></label>
      <div class="stack" style="align-content:end">
        <label class="check"><input type="checkbox" name="in_rotation" ${u.id ? (u.in_rotation ? 'checked' : '') : 'checked'}> ${esc(t('inRotation'))}</label>
        ${u.id ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> ${esc(t('active'))}</label>` : ''}
      </div>
    </div>`;
}

function render() {
  const now = Date.now();
  state.el.innerHTML = `
    <div class="page">
      <div class="page-head"><h1>${esc(t('users'))}</h1><span class="spacer"></span><button class="btn btn-primary" data-add>+ ${esc(t('addUser'))}</button></div>
      <div class="card table-wrap"><table class="data">
        <thead><tr><th>${esc(t('name'))}</th><th>${esc(t('email'))}</th><th>${esc(t('role'))}</th><th>${esc(t('status'))}</th>
          <th class="n">${esc(t('waitingNow'))}</th><th class="n">${esc(t('load'))}</th><th>${esc(t('inRotation'))}</th><th>${esc(t('lastSeen'))}</th><th></th></tr></thead>
        <tbody>${state.items.map((u) => `
          <tr style="${u.active ? '' : 'opacity:.5'}">
            <td><strong>${esc(u.name)}</strong></td><td class="small">${esc(u.email)}</td><td>${esc(t(`role_${u.role}`))}</td>
            <td><span class="dot ${u.presence === 'online' ? 'dot-good' : u.presence === 'away' ? 'dot-warn' : 'dot-off'}"></span> ${esc(t(u.presence))}</td>
            <td class="n">${u.waiting}</td><td class="n">${u.open} / ${u.max_open}</td>
            <td>${u.in_rotation ? '✓' : '-'}</td><td class="small muted">${esc(u.last_seen_at ? timeAgo(u.last_seen_at, now) : '-')}</td>
            <td><button class="btn btn-sm" data-edit="${u.id}">${esc(t('edit'))}</button></td>
          </tr>`).join('')}</tbody></table></div>
    </div>`;
  state.el.querySelector('[data-add]').onclick = async () => {
    const ok = await modal({
      title: t('addUser'), body: userForm(),
      onSubmit: (v) => api('POST', '/users', { ...v, max_open: Number(v.max_open) }),
    });
    if (ok) { toast(t('saved')); load(); loadMe(); }
  };
  state.el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = async () => {
    const u = state.items.find((x) => x.id === Number(b.dataset.edit));
    const ok = await modal({
      title: `${t('edit')}: ${u.name}`, body: userForm(u),
      onSubmit: (v) => {
        const body = { name: v.name, role: v.role, max_open: Number(v.max_open), in_rotation: v.in_rotation, active: v.active };
        if (v.password) body.password = v.password;
        return api('PATCH', `/users/${u.id}`, body);
      },
    });
    if (ok) { toast(t('saved')); load(); loadMe(); }
  });
}

async function load() {
  try {
    state.items = (await api('GET', '/users')).items;
    if (state.el) render();
  } catch (err) { showError(err); }
}

export default {
  mount(el) { state.el = el; load(); },
  unmount() { state.el = null; },
  onEvent(type) { if (state.el && (type === 'presence' || type === 'users')) load(); },
  store,
};
