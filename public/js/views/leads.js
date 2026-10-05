import { nameOf, t } from '../i18n.js';
import { api, debounce, esc, fmtDate, fmtDateTime, modal, showError, timeAgo } from '../util.js';
import { can, store } from '../store.js';
import { bindLead, renderLead, stageChip } from './leadpanel.js';

const state = { el: null, stage: 'open', owner: '', project: '', search: '', items: [] };

function render() {
  const now = Date.now();
  const stageTabs = [['open', t('openLeads')], ...store.stages.map((s) => [s.key, nameOf(s)]), ['', t('allLeads')]];
  state.el.innerHTML = `
    <div class="page">
      <div class="page-head"><h1>${esc(t('leadsTitle'))}</h1><span class="chip">${state.items.length}</span><span class="spacer"></span>
        <input type="search" data-search placeholder="${esc(t('search'))}" value="${esc(state.search)}" style="width:240px">
        <select data-project style="width:auto"><option value="">${esc(t('allProjects'))}</option>${(store.rules.projects || []).map((p) => `<option ${state.project === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        ${can('conv.view_all') ? `<select data-owner style="width:auto"><option value="">${esc(t('allAgents'))}</option>${store.users.map((u) => `<option value="${u.id}" ${String(u.id) === state.owner ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="tabs" style="margin-bottom:12px">${stageTabs.map(([k, label]) => `<button class="tab ${state.stage === k ? 'active' : ''}" data-stage-tab="${esc(k)}">${esc(label)}</button>`).join('')}</div>
      <div class="card table-wrap">
        ${state.items.length ? `<table class="data">
          <thead><tr><th>${esc(t('customerCol'))}</th><th>${esc(t('stage'))}</th><th>${esc(t('project'))}</th><th>${esc(t('dates'))}</th>
            <th class="n">${esc(t('guests'))}</th><th>${esc(t('owner'))}</th><th>${esc(t('source'))}</th><th>${esc(t('nextFollowUp'))}</th><th>${esc(t('updated'))}</th></tr></thead>
          <tbody>${state.items.map((l) => `
            <tr class="clickable" data-lead="${l.id}" data-conv="${l.conversation_id || ''}">
              <td><strong>${esc(l.customer_name || '—')}</strong>${l.temperature === 'hot' ? ' 🔥' : ''}<div class="small muted">${l.phone ? `+${esc(l.phone)}` : ''}</div></td>
              <td>${stageChip(l.stage_key)}</td>
              <td>${esc(l.project || '-')}</td>
              <td class="num">${l.check_in ? `${esc(fmtDate(l.check_in))} → ${esc(fmtDate(l.check_out))}` : '-'}</td>
              <td class="n">${esc(l.guests ?? '-')}</td>
              <td>${esc(l.owner_name || '-')}</td>
              <td class="small">${esc((l.source || '-').replace(/_/g, ' '))}</td>
              <td>${l.next_follow_up ? `<span class="chip ${l.next_follow_up < now ? 'chip-crit' : 'chip-gold'}">${l.next_follow_up < now ? '⛔' : '⏰'} ${esc(fmtDateTime(l.next_follow_up))}</span>` : (l.stage_kind === 'open' ? '<span class="chip chip-warn">⚠️ -</span>' : '')}</td>
              <td class="small muted">${esc(timeAgo(l.updated_at, now))}</td>
            </tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(t('noLeads'))}</div>`}
      </div>
    </div>`;
  const el = state.el;
  el.querySelector('[data-search]').oninput = debounce((e) => { state.search = e.target.value; load(); }, 300);
  el.querySelector('[data-project]').onchange = (e) => { state.project = e.target.value; load(); };
  el.querySelector('[data-owner]')?.addEventListener('change', (e) => { state.owner = e.target.value; load(); });
  el.querySelectorAll('[data-stage-tab]').forEach((b) => b.onclick = () => { state.stage = b.dataset.stageTab; load(); });
  el.querySelectorAll('[data-lead]').forEach((row) => row.onclick = () => {
    if (row.dataset.conv) location.hash = `#/inbox/${row.dataset.conv}`;
    else openLeadModal(Number(row.dataset.lead));
  });
}

/** Leads without a chat (e.g. from a comment) are edited in a dialog. */
async function openLeadModal(id) {
  const lead = state.items.find((l) => l.id === id);
  const fetchFollowUps = () => api('GET', '/follow-ups?scope=team').then((r) => r.items).catch(() => []);
  let followUps = await fetchFollowUps();
  const done = modal({ title: lead.customer_name || t('lead'), body: '<div data-lead-modal class="stack"></div>', submitLabel: null, wide: true });
  const box = document.querySelector('[data-lead-modal]');
  const draw = (l) => {
    box.innerHTML = renderLead(l, followUps);
    bindLead(box, l, async () => {
      await load();
      followUps = await fetchFollowUps();
      const fresh = state.items.find((x) => x.id === id);
      if (fresh) draw(fresh);
    });
  };
  draw(lead);
  await done;
}

async function load() {
  const params = new URLSearchParams();
  if (state.stage) params.set('stage', state.stage);
  if (state.owner) params.set('owner', state.owner);
  if (state.project) params.set('project', state.project);
  if (state.search) params.set('search', state.search);
  try {
    const data = await api('GET', `/leads?${params}`);
    state.items = data.items;
    if (state.el && !document.querySelector('[data-lead-modal]')) render();
  } catch (err) { showError(err); }
}

export default {
  mount(el) { state.el = el; load(); },
  unmount() { state.el = null; },
  onEvent: debounce((type) => { if (state.el && type === 'conversation') load(); }, 1000),
};
