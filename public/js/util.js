import { getLang, t } from './i18n.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event('soul:unauthorized'));
  }
  if (!res.ok) throw new ApiError(data.error || t('errorGeneric'), res.status, data.code);
  return data;
}

const locale = () => (getLang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const TZ = 'Africa/Cairo';

export function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function fmtDate(value) {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: TZ });
}

/** "5m", "2h 10m", "3d" */
export function fmtDuration(ms) {
  if (ms == null) return '-';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  return `${Math.floor(h / 24)}d ${h % 24 ? `${h % 24}h` : ''}`.trim();
}

export const fmtSeconds = (s) => (s == null ? '-' : fmtDuration(s * 1000));

/** mm:ss countdown */
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? fmtDuration(Math.abs(ms)) : `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 60000) return getLang() === 'ar' ? 'الآن' : 'now';
  if (diff < 86400000) return fmtDuration(diff);
  return fmtDate(ts);
}

export function fmtNumber(n, digits = 0) {
  if (n == null) return '-';
  return Number(n).toLocaleString(locale(), { maximumFractionDigits: digits });
}

export function fmtMoney(n) {
  if (n == null) return '-';
  return `${Number(n).toLocaleString(locale(), { maximumFractionDigits: 0 })} ${getLang() === 'ar' ? 'ج.م' : 'EGP'}`;
}

export const initials = (name) => (String(name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('') || '?').toUpperCase();

/** datetime-local value in Cairo time <-> epoch ms */
export function toLocalInput(ts) {
  const d = new Date(ts);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromLocalInput(value) {
  if (!value) return null;
  // Interpret the wall-clock value as Cairo time.
  const guess = Date.parse(`${value}:00Z`);
  const offset = Date.parse(`${toLocalInput(guess)}:00Z`) - guess;
  return guess - offset;
}

/** Next occurrence of HH:MM Cairo time. */
export function nextCairoTime(hhmm) {
  const now = Date.now();
  const today = toLocalInput(now).slice(0, 10);
  let ts = fromLocalInput(`${today}T${hhmm}`);
  if (ts <= now) ts += 86400000;
  return ts;
}

// ---------- toast
export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

export function showError(err) {
  toast(err?.message || t('errorGeneric'), 'error');
}

// ---------- modal: resolves with FormData values, or null when cancelled
export function modal({ title, body, submitLabel = t('save'), wide = false, onSubmit }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <form class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="${esc(t('cancel'))}">✕</button></header>
        <div class="modal-body">${body}</div>
        <p class="form-error" hidden></p>
        <footer class="modal-foot">
          <button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
          ${submitLabel ? `<button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>` : ''}
        </footer>
      </form>`;
    const form = wrap.querySelector('form');
    const close = (value) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(null); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      for (const cb of form.querySelectorAll('input[type=checkbox][name]')) values[cb.name] = cb.checked;
      if (!onSubmit) return close(values);
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const result = await onSubmit(values, form);
        close(result ?? values);
      } catch (err) {
        const p = form.querySelector('.form-error');
        p.textContent = err.message;
        p.hidden = false;
        btn.disabled = false;
      }
    });
    document.body.appendChild(wrap);
    (form.querySelector('[autofocus]') || form.querySelector('input, select, textarea'))?.focus();
  });
}

// ---------- hover tooltip for charts: any element with data-tip
let tip;
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) { if (tip) tip.hidden = true; return; }
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    document.body.appendChild(tip);
  }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - 220, Math.max(8, r.left + r.width / 2 - 60))}px`;
  tip.style.top = `${Math.max(8, r.top - 36)}px`;
});

export function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

export function fillTemplate(text, vars) {
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] ?? m));
}
