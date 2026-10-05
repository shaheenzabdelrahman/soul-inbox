import { nameOf, t } from '../i18n.js';
import {
  api, debounce, esc, fillTemplate, fmtClock, fmtDate, fmtDateTime, fmtDuration, fmtSeconds, fmtTime, initials, modal,
  nextCairoTime, showError, timeAgo, toast,
} from '../util.js';
import { can, store, userName, stageByKey } from '../store.js';
import { bindLead, renderLead, stageChip } from './leadpanel.js';

const TYPES = ['unknown', 'sales_lead', 'existing_guest', 'owner', 'broker', 'complaint', 'supplier', 'spam', 'other'];
const VIEWS = ['mine', 'unassigned', 'needs_reply', 'overdue', 'waiting', 'snoozed', 'hot', 'all', 'closed'];

const state = {
  el: null,
  view: 'mine',
  channel: '',
  assigned: '',
  search: '',
  items: [],
  counts: {},
  openId: null,
  detail: null,
  sideTab: 'lead',
  mode: 'reply',
  drafts: {},
  timer: null,
  showSide: false,
};

// ---------- SLA presentation: status colour always paired with an icon and words
function slaInfo(c, now = Date.now()) {
  if (c.status !== 'needs_reply' || !c.sla_due_at) return null;
  if (c.sla_start_at && now < c.sla_start_at) return { cls: 'chip-info', text: `🌙 ${t('sla_night')} ${fmtTime(c.sla_start_at)}`, level: 'night' };
  const warnMs = ((store.rules.sla_target_min || 15) - (store.rules.sla_warning_min || 10)) * 60000;
  const remaining = c.sla_due_at - now;
  if (remaining <= 0) return { cls: 'chip-crit', text: `⛔ ${fmtClock(remaining)} ${t('sla_over')}`, level: 'over' };
  if (remaining <= warnMs) return { cls: 'chip-warn', text: `⚠️ ${fmtClock(remaining)} ${t('sla_warn')}`, level: 'warn' };
  return { cls: 'chip-good', text: `⏱ ${fmtClock(remaining)} ${t('sla_ok')}`, level: 'ok' };
}

const slaChip = (c) => {
  const s = slaInfo(c);
  return s ? `<span class="chip ${s.cls}" data-sla="${c.id}">${esc(s.text)}</span>` : '';
};

const channelDot = (kind) => `<span class="dot ch-${esc(kind)}" title="${esc(t(kind))}"></span>`;

function avatar(name, url, kind) {
  return `<span class="avatar">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(name))}${kind ? channelDot(kind) : ''}</span>`;
}

// ---------- layout
function render() {
  const userOptions = store.users.filter((u) => u.active).map((u) => `<option value="${u.id}" ${String(u.id) === state.assigned ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  state.el.innerHTML = `
    <div class="inbox ${state.openId ? 'has-open' : ''} ${state.showSide ? 'show-side' : ''}">
      <aside class="conv-list">
        <div class="list-head">
          <div class="row"><input type="search" data-search placeholder="${esc(t('search'))}" value="${esc(state.search)}" style="flex:1">
            <button class="btn btn-sm" data-next title="Next waiting">⏭</button></div>
          <div class="tabs" data-views></div>
          <div class="row">
            <select data-channel style="flex:1"><option value="">${esc(t('allChannels'))}</option>${['whatsapp', 'messenger', 'instagram'].map((k) => `<option value="${k}" ${state.channel === k ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select>
            ${can('conv.view_all') ? `<select data-assigned style="flex:1"><option value="">${esc(t('allAgents'))}</option><option value="none" ${state.assigned === 'none' ? 'selected' : ''}>${esc(t('unassignedLabel'))}</option>${userOptions}</select>` : ''}
          </div>
        </div>
        <div class="list-items" data-list></div>
      </aside>
      <section class="chat" data-chat><div class="empty">${esc(t('selectConversation'))}</div></section>
      <aside class="side" data-side></aside>
    </div>`;
  const root = state.el;
  root.querySelector('[data-search]').oninput = debounce((e) => { state.search = e.target.value; loadList(); }, 300);
  root.querySelector('[data-channel]').onchange = (e) => { state.channel = e.target.value; loadList(); };
  root.querySelector('[data-assigned]')?.addEventListener('change', (e) => { state.assigned = e.target.value; loadList(); });
  root.querySelector('[data-next]').onclick = openNext;
  renderViews();
}

function renderViews() {
  const box = state.el.querySelector('[data-views]');
  if (!box) return;
  const views = VIEWS.filter((v) => v !== 'unassigned' || can('conv.view_all') || store.rules.allow_agent_claim);
  box.innerHTML = views.map((v) => {
    const n = state.counts[v === 'waiting' ? 'waiting' : v];
    return `<button class="tab ${state.view === v ? 'active' : ''}" data-view="${v}">${esc(t(v))}${n ? ` <span class="n">${n}</span>` : ''}</button>`;
  }).join('');
  box.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { state.view = b.dataset.view; renderViews(); loadList(); });
}

function renderList() {
  const box = state.el?.querySelector('[data-list]');
  if (!box) return;
  if (!state.items.length) {
    box.innerHTML = `<div class="empty">${esc(t('noConversations'))}</div>`;
    return;
  }
  const now = Date.now();
  box.innerHTML = state.items.map((c) => {
    const viewers = (store.viewers[c.id] || []).filter((id) => id !== store.user.id);
    const sla = slaInfo(c, now);
    return `
    <button class="conv-item ${c.id === state.openId ? 'active' : ''} ${c.unread_count ? 'unread' : ''} ${sla?.level === 'over' ? 'overdue' : ''}" data-id="${c.id}">
      ${avatar(c.customer_name, c.avatar_url, c.channel_kind)}
      <span class="ci-main">
        <span class="ci-top"><span class="ci-name">${esc(c.customer_name || c.phone || '—')}</span><span class="ci-time">${esc(timeAgo(c.last_message_at, now))}</span></span>
        <span class="ci-preview" dir="auto">${esc(c.last_message_preview || '')}</span>
        <span class="ci-meta">
          ${slaChip(c)}
          ${c.priority !== 'normal' ? `<span class="chip chip-crit">${c.priority === 'urgent' ? '🔥' : '❗'} ${esc(t(c.priority))}</span>` : ''}
          ${c.stage_key ? stageChip(c.stage_key) : ''}
          ${c.temperature === 'hot' ? '<span class="chip chip-warn">🔥</span>' : ''}
          <span class="chip">${c.assigned_name ? `👤 ${esc(c.assigned_name)}` : `◌ ${esc(t('unassignedLabel'))}`}</span>
          ${viewers.length ? `<span class="chip chip-info">👀 ${esc(viewers.map(userName).join(', '))}</span>` : ''}
          ${c.unread_count ? `<span class="unread-count">${c.unread_count}</span>` : ''}
        </span>
      </span>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { location.hash = `#/inbox/${b.dataset.id}`; });
}

async function loadList() {
  const params = new URLSearchParams({ view: state.view });
  if (state.channel) params.set('channel', state.channel);
  if (state.assigned) params.set('assigned', state.assigned);
  if (state.search) params.set('search', state.search);
  try {
    const data = await api('GET', `/conversations?${params}`);
    state.items = data.items;
    state.counts = data.counts;
    store.viewers = data.viewers || store.viewers;
    renderViews();
    renderList();
  } catch (err) { showError(err); }
}
const loadListSoon = debounce(loadList, 400);

function openNext() {
  const next = state.items.find((c) => c.status === 'needs_reply' && c.id !== state.openId) || state.items.find((c) => c.id !== state.openId);
  if (next) location.hash = `#/inbox/${next.id}`;
}

// ---------- conversation detail
async function loadDetail(id = state.openId) {
  if (!id) return;
  try {
    const d = await api('GET', `/conversations/${id}`);
    if (state.openId !== id) return;
    state.detail = d;
    renderChat();
    renderSide();
    if (d.conversation.unread_count && d.conversation.assigned_user_id === store.user.id) {
      api('POST', `/conversations/${id}/read`, {}).then(loadListSoon).catch(() => {});
    }
  } catch (err) {
    showError(err);
    if (err.status === 403 || err.status === 404) location.hash = '#/inbox';
  }
}
const loadDetailSoon = debounce(() => loadDetail(), 300);

function eventText(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'assigned': return `${t('ev_assigned')} → ${d.to ? userName(d.to) : t('unassignedLabel')} (${t(`reason_${d.reason}`)})`;
    case 'stage_changed': return `${t('ev_stage_changed')}: ${nameOf(stageByKey(d.from)) || '-'} → ${nameOf(stageByKey(d.to))}`;
    case 'status_changed': return `${t('ev_status_changed')}: ${t(d.from === 'waiting_customer' ? 'waiting' : d.from)} → ${t(d.to === 'waiting_customer' ? 'waiting' : d.to)}`;
    case 'sla_breach': case 'sla_warning': return `${t(`ev_${e.type}`)}${d.assignee ? ` (${userName(d.assignee)})` : ''}`;
    case 'lead_updated': case 'customer_updated': return `${t(`ev_${e.type}`)}: ${Object.keys(d).join(', ')}`;
    case 'classified': return `${t('ev_classified')}: ${d.type ? t(`type_${d.type}`) : ''} ${d.priority ? t(d.priority) : ''}`;
    case 'follow_up_created': return `${t('ev_follow_up_created')}: ${fmtDateTime(d.due_at)} ${d.note || ''}`;
    default: return t(`ev_${e.type}`);
  }
}

const SHOWN_IN_CHAT = new Set(['assigned', 'stage_changed', 'status_changed', 'sla_breach', 'sla_escalation_supervisor', 'sla_escalation_manager',
  'lead_created', 'follow_up_created', 'reopened', 'replied_outside_system', 'ad_referral']);

function attachmentHtml(m) {
  if (!m.attachments_json) return '';
  return JSON.parse(m.attachments_json).map((a, i) => {
    const url = a.url || (a.mediaId ? `/api/media/wa/${m.id}/${i}` : null);
    if (!url) return '';
    const u = esc(url);
    if (a.type === 'image' || a.type === 'sticker') return `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>`;
    if (a.type === 'video') return `<video src="${u}" controls preload="metadata"></video>`;
    if (a.type === 'audio') return `<audio src="${u}" controls preload="none"></audio>`;
    return `<a href="${u}" target="_blank" rel="noopener">📎 ${esc(a.filename || t('attach'))}</a>`;
  }).join('');
}

function senderLabel(m) {
  if (m.direction === 'in') return '';
  if (m.sender_type === 'agent') return m.user_id === store.user.id ? t('you') : m.user_name || '';
  return t({ ai: 'aiSender', auto: 'autoSender', external: 'externalSender' }[m.sender_type]);
}

function messagesHtml(d) {
  const items = [
    ...d.messages.map((m) => ({ k: 'm', at: m.created_at, m })),
    ...d.notes.map((n) => ({ k: 'n', at: n.created_at, n })),
    ...d.timeline.filter((e) => SHOWN_IN_CHAT.has(e.type)).map((e) => ({ k: 'e', at: e.at, e })),
  ].sort((a, b) => a.at - b.at);
  let lastDay = '';
  return items.map((it) => {
    const day = fmtDate(it.at);
    const sep = day !== lastDay ? `<div class="day-sep">${esc(day)}</div>` : '';
    lastDay = day;
    if (it.k === 'n') return `${sep}<div class="note-bubble">📝 <strong>${esc(it.n.user_name)}</strong>: ${esc(it.n.body)} <span class="small muted">${esc(fmtTime(it.at))}</span></div>`;
    if (it.k === 'e') {
      const crit = it.e.type.startsWith('sla_');
      return `${sep}<div class="sys-line ${crit ? 'crit' : ''}">${crit ? '⛔' : '•'} ${esc(eventText(it.e))}${it.e.user_name ? ` · ${esc(it.e.user_name)}` : ''} · ${esc(fmtTime(it.at))}</div>`;
    }
    const m = it.m;
    const status = m.direction === 'out'
      ? { pending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠️' }[m.delivery_status] || ''
      : '';
    return `${sep}<div class="msg ${m.direction} ${m.sender_type} ${m.delivery_status === 'failed' ? 'failed' : ''}">
      ${m.direction === 'out' ? `<div class="sender">${esc(senderLabel(m))}</div>` : ''}
      ${attachmentHtml(m)}${m.body ? `<div class="body" dir="auto">${esc(m.body)}</div>` : ''}
      <div class="meta"><span>${esc(fmtTime(m.created_at))}</span>${status ? `<span title="${esc(t(m.delivery_status === 'sent' ? 'sentStatus' : m.delivery_status))}">${status}</span>` : ''}</div>
      ${m.error ? `<div class="small" style="color:var(--crit)">${esc(t('failed'))}: ${esc(m.error)}</div>` : ''}
    </div>`;
  }).join('');
}

function assignControl(c) {
  const mine = c.assigned_user_id === store.user.id;
  if (can('conv.assign') || mine) {
    const opts = store.users.filter((u) => u.active).map((u) => {
      const dot = u.presence === 'online' ? '🟢' : u.presence === 'away' ? '🟡' : '⚫';
      return `<option value="${u.id}" ${u.id === c.assigned_user_id ? 'selected' : ''}>${dot} ${esc(u.name)}</option>`;
    }).join('');
    return `<label class="small muted">${esc(t('assignTo'))} <select data-assign><option value="">${esc(t('unassignedLabel'))}</option>${opts}</select></label>`;
  }
  if (!c.assigned_user_id) return `<button class="btn btn-sm btn-primary" data-claim>${esc(t('assignToMe'))}</button>`;
  return `<span class="chip">👤 ${esc(userName(c.assigned_user_id))}</span>`;
}

function renderChat() {
  const box = state.el.querySelector('[data-chat]');
  const d = state.detail;
  if (!box || !d) return;
  const c = d.conversation;
  const name = d.customer.name || d.customer.phone || '—';
  const viewers = (store.viewers[c.id] || []).filter((id) => id !== store.user.id);
  const sla = slaInfo(c);
  const now = Date.now();
  const winClosingSoon = c.window.open && c.window.closesAt - now < 2 * 3600000;
  const draft = state.drafts[c.id] || '';
  const hadFocus = document.activeElement?.matches?.('[data-text]');
  const canSend = c.assigned_user_id === store.user.id || can('conv.reply_any') || (!c.assigned_user_id && store.rules.allow_agent_claim);

  box.innerHTML = `
    <header class="chat-head">
      <div class="row">
        <button class="icon-btn only-mobile" data-back aria-label="back">←</button>
        <div class="who">${avatar(name, d.customer.avatar_url, c.channel_kind)}
          <div style="min-width:0"><h2>${esc(name)}</h2>
            <div class="small muted">${esc(d.channel.name)} · ${esc(t(c.channel_kind))}${d.customer.phone ? ` · +${esc(d.customer.phone)}` : ''}${c.source ? ` · ${esc(c.source.replace(/_/g, ' '))}` : ''}</div></div></div>
        <span class="spacer"></span>
        ${sla ? `<span class="chip ${sla.cls}" data-sla="${c.id}">${esc(sla.text)}</span>` : ''}
        <button class="btn btn-sm only-narrow" data-toggle-side>ℹ️</button>
      </div>
      <div class="row">
        ${assignControl(c)}
        <select data-type aria-label="${esc(t('typeLabel'))}">${TYPES.map((x) => `<option value="${x}" ${c.type === x ? 'selected' : ''}>${esc(t(`type_${x}`))}</option>`).join('')}</select>
        <select data-priority aria-label="${esc(t('priority'))}">${['normal', 'high', 'urgent'].map((x) => `<option value="${x}" ${c.priority === x ? 'selected' : ''}>${esc(t(x))}</option>`).join('')}</select>
        <span class="spacer"></span>
        ${c.status === 'needs_reply' ? `<button class="btn btn-sm" data-status="waiting_customer">⏳ ${esc(t('markWaiting'))}</button>` : ''}
        ${c.status === 'waiting_customer' || c.status === 'snoozed' ? `<button class="btn btn-sm" data-status="needs_reply">↩ ${esc(t('needsReplyAction'))}</button>` : ''}
        ${c.status !== 'closed' ? `<select data-snooze style="width:auto"><option value="">💤 ${esc(t('snooze'))}</option><option value="1">${esc(t('snooze1h'))}</option><option value="3">${esc(t('snooze3h'))}</option><option value="tomorrow">${esc(t('snoozeTomorrow'))}</option></select>` : ''}
        ${c.status !== 'closed' ? `<button class="btn btn-sm" data-status="closed">✓ ${esc(t('close'))}</button>` : `<button class="btn btn-sm" data-status="waiting_customer">${esc(t('reopen'))}</button>`}
      </div>
      ${viewers.length ? `<div><span class="viewers">👀 ${esc(viewers.map(userName).join(', '))} ${esc(viewers.length > 1 ? t('viewingPlural') : t('viewing'))}</span></div>` : ''}
    </header>
    ${!c.window.open ? `<div class="banner banner-crit">🔒 <strong>${esc(t('windowClosed'))}</strong> ${esc(c.channel_kind === 'whatsapp' ? t('windowClosedWa') : t('windowClosedMeta'))}</div>`
    : winClosingSoon ? `<div class="banner banner-warn">⏳ ${esc(t('windowCloses'))} ${esc(fmtTime(c.window.closesAt))}${!d.customer.phone ? ` - ${esc(t('phone'))}?` : ''}</div>` : ''}
    <div class="messages" data-messages>${messagesHtml(d)}</div>
    <div class="composer ${state.mode === 'note' ? 'note-mode' : ''}">
      <div class="composer-tools">
        <span class="mode-toggle"><button type="button" data-mode="reply" class="${state.mode === 'reply' ? 'active' : ''}">${esc(t('reply'))}</button><button type="button" data-mode="note" class="${state.mode === 'note' ? 'active' : ''}">📝 ${esc(t('note'))}</button></span>
        <button class="btn btn-sm btn-ghost" data-templates>⚡ ${esc(t('templates'))}</button>
        <label class="btn btn-sm btn-ghost">📎 ${esc(t('attach'))}<input type="file" data-file hidden accept="image/*,video/mp4,audio/*,application/pdf"></label>
        ${store.aiAvailable ? `<button class="btn btn-sm btn-ghost" data-ai-suggest>✨ ${esc(t('aiSuggest'))}</button>` : ''}
        ${!c.window.open && c.channel_kind === 'whatsapp' ? `<button class="btn btn-sm" data-wa-template>${esc(t('sendTemplate'))}</button>` : ''}
      </div>
      <div class="row" style="align-items:flex-end">
        <textarea data-text rows="2" style="flex:1" placeholder="${esc(state.mode === 'note' ? t('notePlaceholder') : t('replyPlaceholder'))}"
          ${state.mode === 'reply' && (!c.window.open || !canSend) ? 'disabled' : ''}>${esc(draft)}</textarea>
        <button class="btn btn-primary" data-send>${esc(state.mode === 'note' ? t('addNote') : t('send'))}</button>
      </div>
      <div class="tpl-pop" data-tpl-pop hidden></div>
    </div>`;
  const msgs = box.querySelector('[data-messages]');
  msgs.scrollTop = msgs.scrollHeight;
  bindChat(box, c, d);
  if (hadFocus) {
    const ta = box.querySelector('[data-text]');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

function sendTextFrom(box) {
  return box.querySelector('[data-text]').value.trim();
}

function bindChat(box, c, d) {
  const textarea = box.querySelector('[data-text]');
  textarea.oninput = () => { state.drafts[c.id] = textarea.value; templatePopup(box, d); };
  textarea.onkeydown = (e) => {
    const pop = box.querySelector('[data-tpl-pop]');
    if (!pop.hidden && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      pop.querySelector('button')?.click();
      return;
    }
    if (e.key === 'Escape') pop.hidden = true;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(box, c); }
  };
  box.querySelector('[data-send]').onclick = () => send(box, c);
  box.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { state.mode = b.dataset.mode; renderChat(); box.querySelector('[data-text]')?.focus(); });
  box.querySelector('[data-templates]').onclick = () => templatePopup(box, d, true);
  box.querySelector('[data-back]')?.addEventListener('click', () => { location.hash = '#/inbox'; });
  box.querySelector('[data-toggle-side]')?.addEventListener('click', () => {
    state.showSide = !state.showSide;
    state.el.querySelector('.inbox').classList.toggle('show-side', state.showSide);
  });
  box.querySelector('[data-assign]')?.addEventListener('change', async (e) => {
    try { await api('POST', `/conversations/${c.id}/assign`, { user_id: e.target.value ? Number(e.target.value) : null }); } catch (err) { showError(err); }
    loadDetail(); loadListSoon();
  });
  box.querySelector('[data-claim]')?.addEventListener('click', async () => {
    try { await api('POST', `/conversations/${c.id}/assign`, { user_id: store.user.id }); } catch (err) { showError(err); }
    loadDetail(); loadListSoon();
  });
  box.querySelector('[data-type]').onchange = (e) => api('POST', `/conversations/${c.id}/type`, { type: e.target.value }).then(() => loadDetail()).catch(showError);
  box.querySelector('[data-priority]').onchange = (e) => api('POST', `/conversations/${c.id}/type`, { priority: e.target.value }).then(() => loadDetail()).catch(showError);
  box.querySelectorAll('[data-status]').forEach((b) => b.onclick = () => setStatus(c, b.dataset.status));
  box.querySelector('[data-snooze]')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const until = v === 'tomorrow' ? nextCairoTime(store.rules.business_start || '10:00') : Date.now() + Number(v) * 3600000;
    setStatus(c, 'snoozed', until);
  });
  box.querySelector('[data-file]').onchange = (e) => uploadFile(c, e.target.files[0], box);
  box.querySelector('[data-ai-suggest]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const { text } = await api('POST', `/conversations/${c.id}/ai/suggest`, {});
      state.mode = 'reply';
      state.drafts[c.id] = text;
      renderChat();
    } catch (err) { showError(err); e.target.disabled = false; }
  });
  box.querySelector('[data-wa-template]')?.addEventListener('click', async () => {
    const v = await modal({
      title: t('sendTemplate'),
      body: `<label class="field">${esc(t('templateName'))}<input name="name" required placeholder="follow_up_ar"></label>
             <label class="field">${esc(t('language'))}<input name="language" value="ar"></label>`,
      submitLabel: t('send'),
      onSubmit: (vals) => api('POST', `/conversations/${c.id}/messages`, { template: { name: vals.name, language: vals.language } }),
    });
    if (v) loadDetail();
  });
}

function templatePopup(box, d, force = false) {
  const pop = box.querySelector('[data-tpl-pop]');
  const textarea = box.querySelector('[data-text]');
  const value = textarea.value;
  if (!force && !value.startsWith('/')) { pop.hidden = true; return; }
  const query = value.startsWith('/') ? value.slice(1).toLowerCase() : '';
  const list = store.templates.filter((tp) => !query || tp.title.toLowerCase().includes(query) || (tp.shortcut || '').toLowerCase().includes(query) || tp.body.includes(query));
  if (!list.length) { pop.hidden = true; return; }
  pop.innerHTML = list.map((tp, i) => `<button type="button" data-tpl="${tp.id}" class="${i === 0 ? 'sel' : ''}"><strong>${esc(tp.title)}</strong>${tp.shortcut ? ` <span class="chip">/${esc(tp.shortcut)}</span>` : ''}<div class="tpl-body">${esc(tp.body)}</div></button>`).join('');
  pop.hidden = false;
  pop.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => {
    const tp = store.templates.find((x) => x.id === Number(b.dataset.tpl));
    const text = fillTemplate(tp.body, { customer_name: (d.customer.name || '').split(' ')[0], agent_name: store.user.name.split(' ')[0] });
    textarea.value = text;
    state.drafts[d.conversation.id] = text;
    pop.hidden = true;
    textarea.focus();
  });
}

async function send(box, c) {
  const text = sendTextFrom(box);
  if (!text) return;
  const btn = box.querySelector('[data-send]');
  btn.disabled = true;
  try {
    if (state.mode === 'note') await api('POST', `/conversations/${c.id}/notes`, { body: text });
    else await api('POST', `/conversations/${c.id}/messages`, { text });
    state.drafts[c.id] = '';
    await loadDetail();
    loadListSoon();
    state.el.querySelector('[data-text]')?.focus();
  } catch (err) {
    showError(err);
    btn.disabled = false;
  }
}

async function setStatus(c, status, snoozeUntil) {
  try {
    if (status === 'closed' && c.type === 'unknown') {
      const v = await modal({
        title: t('typeLabel'),
        body: `<select name="type" required>${TYPES.filter((x) => x !== 'unknown').map((x) => `<option value="${x}">${esc(t(`type_${x}`))}</option>`).join('')}</select>`,
        submitLabel: t('close'),
      });
      if (!v) return;
      await api('POST', `/conversations/${c.id}/type`, { type: v.type });
    }
    await api('POST', `/conversations/${c.id}/status`, { status, snooze_until: snoozeUntil });
    loadDetail();
    loadListSoon();
  } catch (err) { showError(err); }
}

function uploadFile(c, file, box) {
  if (!file) return;
  if (file.size > 16 * 1024 * 1024) { showError(new Error('16 MB max')); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      toast(t('pending'));
      await api('POST', `/conversations/${c.id}/attachments`, {
        filename: file.name, mime: file.type, data: String(reader.result).split(',')[1], caption: sendTextFrom(box) || undefined,
      });
      state.drafts[c.id] = '';
      loadDetail();
    } catch (err) { showError(err); }
  };
  reader.readAsDataURL(file);
}

// ---------- side panel
function renderSide() {
  const box = state.el.querySelector('[data-side]');
  const d = state.detail;
  if (!box || !d) return;
  const tabs = ['lead', 'customer', 'cycle', 'ai'];
  box.innerHTML = `
    <div class="side-tabs">${tabs.map((k) => `<button class="${state.sideTab === k ? 'active' : ''}" data-side-tab="${k}">${esc(t(k))}</button>`).join('')}
      <button class="only-narrow" data-close-side>✕</button></div>
    <div class="side-body" data-side-body></div>`;
  box.querySelectorAll('[data-side-tab]').forEach((b) => b.onclick = () => { state.sideTab = b.dataset.sideTab; renderSide(); });
  box.querySelector('[data-close-side]')?.addEventListener('click', () => {
    state.showSide = false;
    state.el.querySelector('.inbox').classList.remove('show-side');
  });
  const body = box.querySelector('[data-side-body]');
  ({ lead: sideLead, customer: sideCustomer, cycle: sideCycle, ai: sideAi })[state.sideTab](body, d);
}

function sideLead(body, d) {
  const c = d.conversation;
  const lead = d.leads.find((l) => l.id === c.current_lead_id);
  const others = d.leads.filter((l) => l.id !== c.current_lead_id);
  const switcher = others.length ? `
    <div><p class="section-title">${esc(t('previousLeads'))}</p><div class="stack">${others.map((l) => `
      <button class="btn btn-sm" data-switch-lead="${l.id}" style="justify-content:flex-start">${stageChip(l.stage_key)} ${esc(l.project || '')} ${l.check_in ? esc(fmtDate(l.check_in)) : ''} · ${esc(fmtDate(l.created_at))}</button>`).join('')}</div></div>` : '';
  if (!lead) {
    body.innerHTML = `<p class="muted">${esc(t('noLead'))}</p><button class="btn btn-primary" data-create-lead>+ ${esc(t('createLead'))}</button>${switcher}`;
  } else {
    body.innerHTML = `${renderLead(lead, d.followUps)}${switcher}${current_lead_new_button(lead)}`;
    bindLead(body, lead, () => loadDetail());
  }
  body.querySelector('[data-create-lead]')?.addEventListener('click', () => createLeadFromAi(d));
  body.querySelectorAll('[data-switch-lead]').forEach((b) => b.onclick = async () => {
    await api('POST', `/conversations/${c.id}/current-lead`, { lead_id: Number(b.dataset.switchLead) }).catch(showError);
    loadDetail();
  });
}

function current_lead_new_button(lead) {
  // A customer asking about a second stay gets a second lead once the first is closed.
  return stageByKey(lead.stage_key)?.kind !== 'open'
    ? `<button class="btn" data-create-lead>+ ${esc(t('createLead'))}</button>` : '';
}

async function createLeadFromAi(d) {
  const ai = d.conversation.ai || {};
  const fields = {};
  for (const k of ['project', 'unit_type', 'check_in', 'check_out', 'budget']) if (ai[k]) fields[k] = ai[k];
  if (ai.guests) fields.guests = ai.guests;
  if (ai.temperature && ai.temperature !== 'unknown') fields.temperature = ai.temperature;
  if (fields.project && !(store.rules.projects || []).includes(fields.project)) delete fields.project;
  try {
    await api('POST', `/conversations/${d.conversation.id}/leads`, fields);
    toast(t('leadCreated'));
    loadDetail();
    loadListSoon();
  } catch (err) { showError(err); }
}

function sideCustomer(body, d) {
  const cu = d.customer;
  body.innerHTML = `
    <form class="stack" data-customer>
      <label class="field">${esc(t('name'))}<input name="name" value="${esc(cu.name || '')}"></label>
      <label class="field">${esc(t('phone'))}<input name="phone" value="${esc(cu.phone ? `+${cu.phone}` : '')}" inputmode="tel" placeholder="01xxxxxxxxx"></label>
      <label class="field">${esc(t('email'))}<input name="email" type="email" value="${esc(cu.email || '')}"></label>
      <label class="field">${esc(t('notes'))}<textarea name="notes">${esc(cu.notes || '')}</textarea></label>
      <div class="row"><span class="spacer"></span><button class="btn btn-primary btn-sm">${esc(t('save'))}</button></div>
    </form>
    <div><p class="section-title">${esc(t('identities'))}</p>
      ${d.identities.map((i) => `<div class="row small">${channelDot(i.channel_kind)} ${esc(i.channel_name)} · ${esc(i.username ? `@${i.username}` : i.display_name || i.external_id)}</div>`).join('')}</div>
    ${d.otherConversations.length ? `<div><p class="section-title">${esc(t('otherChats'))}</p>${d.otherConversations.map((o) => `
      <a class="row small" href="#/inbox/${o.id}">${channelDot(o.channel_kind)} ${esc(o.channel_name)} · ${esc(timeAgo(o.last_message_at))}</a>`).join('')}</div>` : ''}
    <div><p class="section-title">${esc(t('previousLeads'))}</p>${d.leads.length ? d.leads.map((l) => `
      <div class="row small">${stageChip(l.stage_key)} ${esc(l.project || '')} · ${esc(fmtDate(l.created_at))} · ${esc(l.owner_name || '')}</div>`).join('') : '<span class="muted small">-</span>'}</div>`;
  body.querySelector('[data-customer]').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PATCH', `/customers/${cu.id}`, Object.fromEntries(new FormData(e.target).entries()));
      toast(t('saved'));
      loadDetail();
      loadListSoon();
    } catch (err) { showError(err); }
  };
}

function sideCycle(body, d) {
  const c = d.conversation;
  const firstIn = d.messages.find((m) => m.direction === 'in');
  const firstAssign = d.timeline.find((e) => e.type === 'assigned' && e.data?.to);
  const firstResp = d.responses[0];
  const avg = d.responses.length ? Math.round(d.responses.reduce((a, r) => a + r.seconds_sla, 0) / d.responses.length) : null;
  const breaches = d.timeline.filter((e) => e.type === 'sla_breach').length;
  const moves = d.timeline.filter((e) => e.type === 'assigned').length;
  const lead = d.leads.find((l) => l.id === c.current_lead_id);
  const hist = lead ? d.stageHistory.filter((h) => h.lead_id === lead.id) : [];
  const target = (store.rules.sla_target_min || 15) * 60;

  body.innerHTML = `
    <div class="milestones">
      <div class="milestone"><div class="l">${esc(t('firstMessage'))}</div><div class="v">${esc(firstIn ? fmtDateTime(firstIn.created_at) : '-')}</div></div>
      <div class="milestone"><div class="l">${esc(t('firstAssigned'))}</div><div class="v">${esc(firstAssign ? userName(firstAssign.data.to) : '-')}</div>
        <div class="l">${firstAssign && firstIn ? `${esc(t('after'))} ${esc(fmtDuration(firstAssign.at - firstIn.created_at))}` : ''}</div></div>
      <div class="milestone"><div class="l">${esc(t('firstReply'))}</div><div class="v">${esc(firstResp ? fmtSeconds(firstResp.seconds_sla) : '-')} ${firstResp ? (firstResp.within_sla ? '✅' : '⛔') : ''}</div>
        <div class="l">${firstResp ? `${esc(t('by'))} ${esc(firstResp.user_name || t('externalSender'))}` : ''}</div></div>
      <div class="milestone"><div class="l">${esc(t('avgReply'))} · ${esc(t('replies'))}</div><div class="v">${esc(fmtSeconds(avg))} · ${d.responses.length}</div>
        <div class="l">${d.responses.filter((r) => r.seconds_sla > target).length} &gt; ${store.rules.sla_target_min}m</div></div>
      <div class="milestone"><div class="l">${esc(t('breaches'))}</div><div class="v">${breaches ? `⛔ ${breaches}` : '✅ 0'}</div></div>
      <div class="milestone"><div class="l">${esc(t('reassignments'))}</div><div class="v">${Math.max(0, moves - 1)}</div></div>
    </div>
    ${hist.length ? `<div><p class="section-title">${esc(t('stageHistory'))}</p><ul class="timeline">${hist.map((h, i) => {
    const next = hist[i + 1]?.at ?? (stageByKey(h.to_stage)?.kind === 'open' ? Date.now() : null);
    const st = stageByKey(h.to_stage);
    return `<li class="${st?.kind === 'won' ? 'good' : st?.kind === 'lost' ? 'crit' : ''}"><span></span><div>${stageChip(h.to_stage)} <span class="small muted">${esc(fmtDateTime(h.at))} · ${esc(h.user_name || t('system'))}${next ? ` · ${esc(fmtDuration(next - h.at))}` : ''}</span></div></li>`;
  }).join('')}</ul></div>` : ''}
    <div><p class="section-title">${esc(t('fullLog'))}</p><ul class="timeline">${d.timeline.slice().reverse().map((e) => `
      <li class="${e.type.startsWith('sla_') ? 'crit' : ''}"><span></span><div><div>${esc(eventText(e))}</div><div class="small muted">${esc(fmtDateTime(e.at))}${e.user_name ? ` · ${esc(e.user_name)}` : ''}</div></div></li>`).join('')}</ul></div>`;
}

function sideAi(body, d) {
  const c = d.conversation;
  if (!store.aiAvailable) { body.innerHTML = `<p class="muted">${esc(t('aiOff'))}</p>`; return; }
  const s = c.ai_summary;
  const a = c.ai;
  body.innerHTML = `
    <div class="card"><div class="card-head"><h3>${esc(t('summary'))}</h3><span class="spacer"></span><button class="btn btn-sm" data-ai-summary>✨ ${esc(t('generate'))}</button></div>
      ${s ? `<dl class="kv"><dt>${esc(t('summary'))}</dt><dd>${esc(s.summary)}</dd><dt>${esc(t('requirements'))}</dt><dd>${esc(s.requirements)}</dd>
        <dt>${esc(t('lastRequest'))}</dt><dd>${esc(s.last_request)}</dd><dt>${esc(t('status'))}</dt><dd>${esc(s.status)}</dd><dt>${esc(t('nextAction'))}</dt><dd><strong>${esc(s.next_action)}</strong></dd></dl>
        <p class="small muted">${esc(fmtDateTime(s.at))}</p>` : ''}</div>
    <div class="card"><div class="card-head"><h3>${esc(t('classify'))}</h3><span class="spacer"></span><button class="btn btn-sm" data-ai-classify>✨ ${esc(t('classify'))}</button></div>
      ${a ? `<dl class="kv"><dt>${esc(t('typeLabel'))}</dt><dd>${esc(t(`type_${a.conversation_type}`))}</dd><dt>${esc(t('intent'))}</dt><dd>${esc(a.intent)}</dd>
        <dt>${esc(t('sentiment'))}</dt><dd>${esc(a.sentiment)}</dd><dt>${esc(t('urgency'))}</dt><dd>${esc(a.urgency)}</dd><dt>${esc(t('temperature'))}</dt><dd>${esc(a.temperature)}</dd>
        <dt>${esc(t('project'))}</dt><dd>${esc(a.project || '-')}</dd><dt>${esc(t('dates'))}</dt><dd>${esc(a.check_in || '-')} → ${esc(a.check_out || '-')}</dd>
        <dt>${esc(t('guests'))}</dt><dd>${esc(a.guests || '-')}</dd><dt>${esc(t('budget'))}</dt><dd>${esc(a.budget || '-')}</dd></dl>
        <p class="small muted">${esc(a.reason || '')}</p>
        ${!c.current_lead_id && a.conversation_type === 'sales_lead' ? `<button class="btn btn-primary btn-sm" data-ai-lead>+ ${esc(t('createLead'))}</button>` : ''}` : ''}</div>`;
  body.querySelector('[data-ai-summary]').onclick = async (e) => {
    e.target.disabled = true;
    await api('POST', `/conversations/${c.id}/ai/summary`, {}).catch(showError);
    loadDetail();
  };
  body.querySelector('[data-ai-classify]').onclick = async (e) => {
    e.target.disabled = true;
    await api('POST', `/conversations/${c.id}/ai/classify`, {}).catch(showError);
    loadDetail();
  };
  body.querySelector('[data-ai-lead]')?.addEventListener('click', () => createLeadFromAi(d));
}

// ---------- timers
function tickSla() {
  const now = Date.now();
  state.el?.querySelectorAll('[data-sla]').forEach((el) => {
    const id = Number(el.dataset.sla);
    const c = state.detail?.conversation.id === id ? state.detail.conversation : state.items.find((x) => x.id === id);
    const s = c && slaInfo(c, now);
    if (!s) return;
    el.className = `chip ${s.cls}`;
    el.textContent = s.text;
  });
}

function open(id) {
  state.openId = id;
  state.detail = null;
  state.el.querySelector('.inbox')?.classList.toggle('has-open', Boolean(id));
  renderList();
  if (!id) {
    const chat = state.el.querySelector('[data-chat]');
    if (chat) chat.innerHTML = `<div class="empty">${esc(t('selectConversation'))}</div>`;
    const side = state.el.querySelector('[data-side]');
    if (side) side.innerHTML = '';
    return;
  }
  loadDetail(id);
}

export default {
  mount(el, rest) {
    state.el = el;
    if (!can('conv.view_all') && state.view === 'all') state.view = 'mine';
    render();
    loadList();
    open(rest[0] ? Number(rest[0]) : null);
    clearInterval(state.timer);
    state.timer = setInterval(tickSla, 1000);
  },
  update(rest) {
    open(rest[0] ? Number(rest[0]) : null);
  },
  unmount() {
    clearInterval(state.timer);
    state.el = null;
  },
  viewing: () => state.openId,
  onEvent(type, data) {
    if (!state.el) return;
    if (type === 'conversation' || type === 'message') {
      loadListSoon();
      const id = type === 'message' ? data.conversation_id : data.id;
      if (id === state.openId) loadDetailSoon();
    }
    if (type === 'viewers') {
      renderList();
      if (state.detail) {
        const c = state.detail.conversation;
        const viewers = (store.viewers[c.id] || []).filter((id) => id !== store.user.id);
        const head = state.el.querySelector('.chat-head');
        const existing = head?.querySelector('.viewers')?.parentElement;
        existing?.remove();
        if (head && viewers.length) {
          head.insertAdjacentHTML('beforeend', `<div><span class="viewers">👀 ${esc(viewers.map(userName).join(', '))} ${esc(viewers.length > 1 ? t('viewingPlural') : t('viewing'))}</span></div>`);
        }
      }
    }
  },
};
