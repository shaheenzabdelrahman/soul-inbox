import { t } from '../i18n.js';
import { api, esc, fmtDateTime, fmtDuration, showError, toLocalInput } from '../util.js';
import { can } from '../store.js';
import { stageChip } from './leadpanel.js';

const state = { el: null, scope: 'mine', items: [], now: Date.now() };

function group(items, now) {
  const today = toLocalInput(now).slice(0, 10);
  return {
    overdue: items.filter((f) => f.due_at < now),
    today: items.filter((f) => f.due_at >= now && toLocalInput(f.due_at).slice(0, 10) === today),
    upcoming: items.filter((f) => f.due_at >= now && toLocalInput(f.due_at).slice(0, 10) !== today),
  };
}

function row(f, now) {
  const late = f.due_at < now;
  return `
    <div class="fu ${late ? 'overdue' : ''}">
      <div style="flex:1">
        <div class="row"><strong>${esc(f.customer_name || '—')}</strong> ${f.stage_key ? stageChip(f.stage_key) : ''} ${f.project ? `<span class="chip">${esc(f.project)}</span>` : ''}</div>
        <div class="small">${esc(f.note || '')}</div>
        <div class="small muted">${late ? `⛔ ${esc(fmtDuration(now - f.due_at))} · ` : '⏰ '}${esc(fmtDateTime(f.due_at))} · ${esc(f.assigned_name || '')}</div>
      </div>
      ${f.conversation_id ? `<a class="btn btn-sm" href="#/inbox/${f.conversation_id}">${esc(t('openChat'))}</a>` : ''}
      <button class="btn btn-sm" data-done="${f.id}">✓ ${esc(t('done'))}</button>
    </div>`;
}

function render() {
  const g = group(state.items, state.now);
  const section = (key, label) => (g[key].length ? `
    <div class="card"><div class="card-head"><h2>${esc(label)}</h2><span class="chip ${key === 'overdue' ? 'chip-crit' : ''}">${g[key].length}</span></div>
      <div class="stack">${g[key].map((f) => row(f, state.now)).join('')}</div></div>` : '');
  state.el.innerHTML = `
    <div class="page">
      <div class="page-head"><h1>${esc(t('followUps'))}</h1><span class="spacer"></span>
        ${can('conv.view_all') ? `<div class="tabs"><button class="tab ${state.scope === 'mine' ? 'active' : ''}" data-scope="mine">${esc(t('mine'))}</button><button class="tab ${state.scope === 'team' ? 'active' : ''}" data-scope="team">${esc(t('team'))}</button></div>` : ''}
      </div>
      ${state.items.length ? section('overdue', t('overdueLabel')) + section('today', t('today')) + section('upcoming', t('upcoming')) : `<div class="card empty">${esc(t('noFollowUps'))}</div>`}
    </div>`;
  state.el.querySelectorAll('[data-scope]').forEach((b) => b.onclick = () => { state.scope = b.dataset.scope; load(); });
  state.el.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => {
    await api('POST', `/follow-ups/${b.dataset.done}/done`, {}).catch(showError);
    load();
  });
}

async function load() {
  try {
    const data = await api('GET', `/follow-ups?scope=${state.scope}`);
    state.items = data.items;
    state.now = data.now;
    if (state.el) render();
  } catch (err) { showError(err); }
}

export default {
  mount(el) { state.el = el; load(); },
  unmount() { state.el = null; },
  onEvent(type) { if (state.el && type === 'notification') load(); },
};
