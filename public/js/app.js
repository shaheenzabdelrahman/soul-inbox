import { applyDir, getLang, setLang, t } from './i18n.js';
import { api, debounce, esc, modal, showError, timeAgo, toast } from './util.js';
import { can, loadMe, store } from './store.js';
import inbox from './views/inbox.js';
import comments from './views/comments.js';
import leads from './views/leads.js';
import followUps from './views/followups.js';
import dashboard from './views/dashboard.js';
import team from './views/team.js';
import settings from './views/settings.js';

const root = document.getElementById('app');

const ROUTES = [
  { key: 'inbox', view: inbox, icon: '💬' },
  { key: 'comments', view: comments, icon: '🗨️' },
  { key: 'leads', view: leads, icon: '🎯' },
  { key: 'followUps', path: 'follow-ups', view: followUps, icon: '⏰' },
  { key: 'dashboard', view: dashboard, icon: '📊' },
  { key: 'team', view: team, icon: '👥', perm: 'users.manage' },
  { key: 'settings', view: settings, icon: '⚙️', perm: 'settings.manage' },
];

let current = null; // { route, view }
let events = null;

// ---------- theme
function applyTheme() {
  let theme = null;
  try { theme = localStorage.getItem('soul.theme'); } catch { /* storage unavailable */ }
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  try { localStorage.setItem('soul.theme', dark ? 'light' : 'dark'); } catch { /* storage unavailable */ }
  applyTheme();
}

// ---------- login
function renderLogin() {
  stopRealtime();
  root.innerHTML = `
    <div class="login">
      <form>
        <div class="brand-mark"><span class="logo">S</span><strong>${esc(t('app'))}</strong><span class="spacer"></span>
          <button type="button" class="btn btn-sm" data-lang>${getLang() === 'ar' ? 'English' : 'عربي'}</button></div>
        <label class="field">${esc(t('email'))}<input name="email" type="email" autocomplete="username" required autofocus></label>
        <label class="field">${esc(t('password'))}<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" hidden style="margin:0"></p>
        <button class="btn btn-primary" type="submit">${esc(t('signIn'))}</button>
      </form>
    </div>`;
  const form = root.querySelector('form');
  form.querySelector('[data-lang]').onclick = () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); renderLogin(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    try {
      await api('POST', '/auth/login', Object.fromEntries(new FormData(form)));
      await start();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  };
}

// ---------- shell
function renderShell() {
  const routes = ROUTES.filter((r) => !r.perm || can(r.perm));
  root.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand-mark"><span class="logo">S</span><strong class="hide-sm">${esc(store.rules.company_name || 'Soul')}</strong></div>
        <span class="spacer"></span>
        <select class="presence-select" aria-label="presence" data-presence>
          ${['online', 'away', 'offline'].map((p) => `<option value="${p}" ${store.user.presence === p ? 'selected' : ''}>${p === 'online' ? '🟢' : p === 'away' ? '🟡' : '⚫'} ${esc(t(p))}</option>`).join('')}
        </select>
        <button class="icon-btn bell" data-bell aria-label="${esc(t('notifications'))}">🔔<span class="count" hidden></span></button>
        <button class="icon-btn" data-lang title="Language">${getLang() === 'ar' ? 'EN' : 'ع'}</button>
        <button class="icon-btn" data-theme title="Theme">◐</button>
        <button class="btn btn-sm hide-sm" data-account>${esc(store.user.name)}</button>
      </header>
      <nav class="sidenav">
        ${routes.map((r) => `<a href="#/${r.path || r.key}" data-route="${r.key}"><span class="nav-ico">${r.icon}</span>${esc(t(r.key))}<span class="badge" data-badge="${r.key}" hidden></span></a>`).join('')}
      </nav>
      <main class="main" id="view"></main>
      <div class="notif-panel" hidden></div>
    </div>`;

  root.querySelector('[data-presence]').onchange = async (e) => {
    try {
      await api('POST', '/me/presence', { presence: e.target.value });
      store.user.presence = e.target.value;
    } catch (err) { showError(err); }
  };
  root.querySelector('[data-lang]').onclick = () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); renderShell(); route(); };
  root.querySelector('[data-theme]').onclick = toggleTheme;
  root.querySelector('[data-bell]').onclick = toggleNotifications;
  root.querySelector('[data-account]').onclick = accountMenu;
  refreshBell();
  refreshBadges();
}

async function accountMenu() {
  const result = await modal({
    title: store.user.name,
    body: `
      <p class="muted">${esc(store.user.email)} · ${esc(t(`role_${store.user.role}`))}</p>
      <h3>${esc(t('changePassword'))}</h3>
      <label class="field">${esc(t('currentPassword'))}<input type="password" name="current" autocomplete="current-password"></label>
      <label class="field">${esc(t('newPassword'))}<input type="password" name="next" autocomplete="new-password" minlength="10"></label>
      <button type="button" class="btn" data-notify>${esc(t('enableNotifications'))}</button>
      <button type="button" class="btn btn-danger" data-logout>${esc(t('logout'))}</button>`,
    submitLabel: t('changePassword'),
    onSubmit: async (v) => {
      if (!v.current || !v.next) throw new Error(t('required'));
      await api('POST', '/me/password', { current: v.current, next: v.next });
      return 'changed';
    },
  });
  if (result === 'changed') { toast(t('passwordChanged')); renderLogin(); }
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-logout]')) {
    await api('POST', '/auth/logout', {}).catch(() => {});
    document.querySelector('.modal-backdrop')?.remove();
    renderLogin();
  }
  if (e.target.closest('[data-notify]') && 'Notification' in window) {
    Notification.requestPermission().then((p) => toast(p));
  }
});

// ---------- notifications
async function refreshBell() {
  try {
    const { unread } = await api('GET', '/notifications');
    const el = root.querySelector('.bell .count');
    if (el) { el.textContent = unread; el.hidden = !unread; }
  } catch { /* ignore */ }
}

async function toggleNotifications() {
  const panel = root.querySelector('.notif-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  const { items } = await api('GET', '/notifications');
  panel.innerHTML = `
    <div class="row" style="padding:10px 12px;border-bottom:1px solid var(--border)"><strong>${esc(t('notifications'))}</strong><span class="spacer"></span>
      <button class="btn btn-sm" data-readall>${esc(t('markAllRead'))}</button></div>
    ${items.length ? items.map((n) => `
      <button class="item ${n.read_at ? '' : 'unread'}" data-conv="${n.conversation_id || ''}">
        <div><strong>${esc(n.title)}</strong></div>
        <div class="small muted">${esc(n.body || '')} · ${esc(timeAgo(n.created_at))}</div>
      </button>`).join('') : `<p class="muted" style="padding:12px">${esc(t('noNotifications'))}</p>`}`;
  panel.hidden = false;
  panel.querySelector('[data-readall]').onclick = async () => { await api('POST', '/notifications/read', {}); panel.hidden = true; refreshBell(); };
  panel.querySelectorAll('[data-conv]').forEach((b) => b.onclick = () => {
    panel.hidden = true;
    if (b.dataset.conv) location.hash = `#/inbox/${b.dataset.conv}`;
  });
}

let audioCtx;
function beep() {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.25);
  } catch { /* audio unavailable */ }
}

function onNotification(n) {
  refreshBell();
  toast(`${n.title}${n.body ? ` - ${n.body}` : ''}`, n.kind?.startsWith('sla_breach') || n.kind === 'escalation' ? 'error' : 'info');
  beep();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const desktop = new Notification(n.title, { body: n.body || '', tag: `soul-${n.id}` });
    desktop.onclick = () => { window.focus(); if (n.conversation_id) location.hash = `#/inbox/${n.conversation_id}`; };
  }
}

// ---------- sidebar badges
const refreshBadges = debounce(async () => {
  try {
    const { counts } = await api('GET', '/conversations?view=overdue');
    setBadge('inbox', counts.overdue, true) || setBadge('inbox', can('conv.view_all') ? counts.needs_reply : counts.mine, false);
    const c = await api('GET', '/comments?status=open');
    setBadge('comments', c.counts.open, false);
  } catch { /* ignore */ }
}, 1500);

function setBadge(key, n, alert) {
  const el = root.querySelector(`[data-badge="${key}"]`);
  if (!el) return false;
  el.hidden = !n;
  el.textContent = n || '';
  el.classList.toggle('badge-soft', !alert);
  return Boolean(n);
}

// ---------- realtime
function startRealtime() {
  stopRealtime();
  events = new EventSource('/api/stream');
  const dispatch = (type) => (e) => {
    const data = JSON.parse(e.data || '{}');
    if (type === 'notification') onNotification(data);
    if (type === 'viewers') store.viewers = data;
    if (type === 'presence' || type === 'users' || type === 'settings') loadMe().catch(() => {});
    if (type === 'conversation' || type === 'comment') refreshBadges();
    current?.view.onEvent?.(type, data);
  };
  for (const type of ['conversation', 'message', 'comment', 'notification', 'presence', 'users', 'settings', 'viewers']) {
    events.addEventListener(type, dispatch(type));
  }
}
function stopRealtime() {
  events?.close();
  events = null;
}

let heartbeat;
function startHeartbeat() {
  clearInterval(heartbeat);
  const beat = () => api('POST', '/me/heartbeat', { viewing: current?.view.viewing?.() || null })
    .then((r) => { store.businessNow = r.businessNow; })
    .catch(() => {});
  beat();
  heartbeat = setInterval(beat, 30000);
}
export function sendHeartbeatNow() {
  api('POST', '/me/heartbeat', { viewing: current?.view.viewing?.() || null }).catch(() => {});
}

// ---------- router
function route() {
  const [, name = 'inbox', ...rest] = location.hash.replace(/^#/, '').split('/');
  const r = ROUTES.find((x) => (x.path || x.key) === name && (!x.perm || can(x.perm))) || ROUTES[0];
  root.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === r.key));
  const el = root.querySelector('#view');
  if (!el) return;
  if (current?.route === r && current.view.update) {
    current.view.update(rest);
  } else {
    current?.view.unmount?.();
    el.innerHTML = '';
    current = { route: r, view: r.view };
    r.view.mount(el, rest);
  }
  sendHeartbeatNow();
}
window.addEventListener('hashchange', route);
window.addEventListener('soul:unauthorized', () => renderLogin());
document.addEventListener('click', (e) => {
  const panel = root.querySelector('.notif-panel');
  if (panel && !panel.hidden && !e.target.closest('.notif-panel') && !e.target.closest('[data-bell]')) panel.hidden = true;
});

async function start() {
  await loadMe();
  renderShell();
  startRealtime();
  startHeartbeat();
  route();
}

applyDir();
applyTheme();
start().catch(() => renderLogin());
