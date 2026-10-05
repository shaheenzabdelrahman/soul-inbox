import { t } from '../i18n.js';
import { api, debounce, esc, fmtDuration, showError, timeAgo, toast } from '../util.js';
import { can, store } from '../store.js';
import { stageChip } from './leadpanel.js';

const state = { el: null, status: 'open', platform: '', items: [], counts: {} };

function ageChip(c, now) {
  if (c.status !== 'new') return '';
  const age = now - c.created_at;
  const target = (store.rules.comment_sla_min || 60) * 60000;
  if (age > target) return `<span class="chip chip-crit">⛔ ${esc(fmtDuration(age))}</span>`;
  if (age > target * 0.66) return `<span class="chip chip-warn">⚠️ ${esc(fmtDuration(age))}</span>`;
  return `<span class="chip chip-good">⏱ ${esc(fmtDuration(age))}</span>`;
}

function render() {
  const now = Date.now();
  const tabs = [['open', t('commentsNew'), state.counts.open], ['replied', t('commentsReplied'), state.counts.replied], ['handled', t('commentsHandled'), state.counts.handled], ['all', t('allLeads')]];
  state.el.innerHTML = `
    <div class="page">
      <div class="page-head"><h1>${esc(t('comments'))}</h1>
        <div class="tabs">${tabs.map(([k, label, n]) => `<button class="tab ${state.status === k ? 'active' : ''}" data-status="${k}">${esc(label)}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>
        <span class="spacer"></span>
        <select data-platform style="width:auto"><option value="">${esc(t('allChannels'))}</option><option value="facebook" ${state.platform === 'facebook' ? 'selected' : ''}>Facebook</option><option value="instagram" ${state.platform === 'instagram' ? 'selected' : ''}>Instagram</option></select>
      </div>
      <p class="small muted">${esc(t('onlyOnePrivate'))}</p>
      ${state.items.length ? state.items.map((c) => `
        <div class="card comment-card" data-id="${c.id}">
          <div class="row">
            <span class="dot ch-${esc(c.platform)}"></span><strong>${esc(c.author_name || '—')}</strong>
            <span class="small muted">${esc(c.channel_name)} · ${esc(timeAgo(c.created_at, now))}</span>
            ${ageChip(c, now)}
            <span class="spacer"></span>
            ${c.assigned_name ? `<span class="chip">👤 ${esc(c.assigned_name)}</span>` : `<button class="btn btn-sm" data-take>${esc(t('takeIt'))}</button>`}
            ${c.lead_id ? stageChip(c.stage_key) : ''}
          </div>
          <div class="comment-text">${esc(c.body)}</div>
          <div class="small muted">${esc(t('post'))}: ${c.post_link ? `<a href="${esc(c.post_link)}" target="_blank" rel="noopener">${esc(c.post_id)}</a>` : esc(c.post_id || '-')}</div>
          ${c.public_reply ? `<div class="note-bubble" style="align-self:start;background:var(--out)">↪ ${esc(c.public_reply)}</div>` : ''}
          ${c.private_reply_at ? `<div class="small">✉️ ${esc(t('privateSent'))}</div>` : ''}
          ${c.status !== 'handled' ? `
          <div class="reply-box"><input data-reply-text placeholder="${esc(t('publicReply'))}…" maxlength="1000"><button class="btn btn-primary btn-sm" data-public>${esc(t('publicReply'))}</button></div>
          <div class="row">
            ${!c.private_reply_at && (Date.now() - c.created_at) < 7 * 86400000 ? `<button class="btn btn-sm" data-private>✉️ ${esc(t('privateReply'))}</button>` : ''}
            ${!c.lead_id ? `<button class="btn btn-sm" data-lead>🎯 ${esc(t('toLead'))}</button>` : ''}
            <span class="spacer"></span>
            <button class="btn btn-sm" data-handled>✓ ${esc(t('markHandled'))}</button>
          </div>` : ''}
        </div>`).join('') : `<div class="card empty">${esc(t('noComments'))}</div>`}
    </div>`;
  bind();
}

function bind() {
  const el = state.el;
  el.querySelectorAll('[data-status]').forEach((b) => b.onclick = () => { state.status = b.dataset.status; load(); });
  el.querySelector('[data-platform]').onchange = (e) => { state.platform = e.target.value; load(); };
  el.querySelectorAll('[data-id]').forEach((card) => {
    const id = card.dataset.id;
    const act = async (path, body = {}) => {
      try { await api('POST', `/comments/${id}/${path}`, body); load(); return true; } catch (err) { showError(err); return false; }
    };
    card.querySelector('[data-take]')?.addEventListener('click', () => act('assign', { user_id: store.user.id }));
    card.querySelector('[data-public]')?.addEventListener('click', () => {
      const text = card.querySelector('[data-reply-text]').value.trim();
      if (text) act('reply', { text });
    });
    card.querySelector('[data-private]')?.addEventListener('click', async () => {
      const text = card.querySelector('[data-reply-text]').value.trim();
      if (!text) { card.querySelector('[data-reply-text]').focus(); return; }
      if (await act('private', { text })) toast(t('privateSent'));
    });
    card.querySelector('[data-lead]')?.addEventListener('click', async () => { if (await act('lead')) toast(t('leadCreated')); });
    card.querySelector('[data-handled]')?.addEventListener('click', () => act('handled'));
  });
}

async function load() {
  try {
    const params = new URLSearchParams({ status: state.status });
    if (state.platform) params.set('platform', state.platform);
    const data = await api('GET', `/comments?${params}`);
    state.items = data.items;
    state.counts = data.counts;
    if (state.el) render();
  } catch (err) { showError(err); }
}
const loadSoon = debounce(load, 500);

export default {
  mount(el) { state.el = el; load(); },
  unmount() { state.el = null; },
  onEvent(type) {
    if (type !== 'comment' || !state.el) return;
    // don't wipe a reply someone is typing
    if (document.activeElement?.matches?.('[data-reply-text]') && document.activeElement.value) return;
    loadSoon();
  },
  canManage: () => can('comments.manage'),
};
