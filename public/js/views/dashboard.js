import { nameOf, t } from '../i18n.js';
import { api, debounce, esc, fmtMoney, fmtNumber, fmtSeconds, fromLocalInput, showError, toLocalInput } from '../util.js';
import { can, store } from '../store.js';

const state = { el: null, period: 'p_7', user: '', data: null, sort: 'replies' };

function range(period) {
  const now = Date.now();
  const today = fromLocalInput(`${toLocalInput(now).slice(0, 10)}T00:00`);
  switch (period) {
    case 'p_today': return { from: today, to: now };
    case 'p_yesterday': return { from: today - 86400000, to: today };
    case 'p_30': return { from: today - 29 * 86400000, to: now };
    case 'p_month': return { from: fromLocalInput(`${toLocalInput(now).slice(0, 7)}-01T00:00`), to: now };
    default: return { from: today - 6 * 86400000, to: now };
  }
}

const pctText = (v) => (v == null ? '-' : `${fmtNumber(v, 1)}%`);

function kpi(label, value, sub = '', cls = '', icon = '') {
  return `<div class="kpi ${cls}"><span class="label">${icon ? `${icon} ` : ''}${esc(label)}</span><span class="value">${value}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
}

/** Horizontal bars: one series, value at the bar tip, tooltip on hover. */
function hbars(rows, { value = (r) => r.count, label = (r) => r.label, fmt = (v) => fmtNumber(v), tip } = {}) {
  const max = Math.max(1, ...rows.map(value));
  if (!rows.length || !rows.some(value)) return `<p class="muted">${esc(t('noData'))}</p>`;
  return `<div class="hbars">${rows.map((r) => {
    const v = value(r);
    return `<div class="hbar" data-tip="${esc(tip ? tip(r) : `${label(r)}: ${fmt(v)}`)}"><span>${esc(label(r))}</span>
      <span class="track"><span class="fill" style="display:block;width:${(v / max) * 100}%"></span></span><span class="val">${esc(fmt(v))}</span></div>`;
  }).join('')}</div>`;
}

/** Vertical columns for a time axis. */
function columns(rows, { value, label, tip }) {
  const max = Math.max(1, ...rows.map(value));
  if (!rows.some(value)) return `<p class="muted">${esc(t('noData'))}</p>`;
  const every = Math.ceil(rows.length / 12);
  return `<div class="cols">${rows.map((r) => `<div class="col" data-tip="${esc(tip(r))}"><span class="fill" style="height:${(value(r) / max) * 100}%"></span></div>`).join('')}</div>
    <div class="col-labels">${rows.map((r, i) => `<span>${i % every === 0 ? esc(label(r)) : ''}</span>`).join('')}</div>`;
}

function agentTable(agents) {
  const cols = [
    ['name', t('agent')], ['chats_assigned', t('chats')], ['replies', t('replies')], ['median_response', t('medianResponse')],
    ['sla_compliance', t('slaCompliance')], ['breaches', t('breaches')], ['moved_away', t('movedAway')], ['leads', t('leads')],
    ['qualified', t('qualified')], ['won', t('won')], ['lost', t('lost')], ['conversion', t('conversion')], ['booking_value', t('bookingValueTotal')],
    ['follow_ups_done', t('followUpsDone')], ['waiting_now', t('waitingNow')],
  ];
  const sorted = [...agents].sort((a, b) => (state.sort === 'name' ? String(a.name).localeCompare(b.name) : (b[state.sort] ?? -1) - (a[state.sort] ?? -1)));
  const cell = (a, k) => {
    const v = a[k];
    if (k === 'name') return `<td><span class="dot ${a.presence === 'online' ? 'dot-good' : a.presence === 'away' ? 'dot-warn' : 'dot-off'}"></span> <strong>${esc(v)}</strong></td>`;
    if (k === 'median_response') return `<td class="n">${esc(fmtSeconds(v))}</td>`;
    if (k === 'sla_compliance' || k === 'conversion') {
      const bad = k === 'sla_compliance' && v != null && v < 80;
      return `<td class="n">${bad ? '⚠️ ' : ''}${esc(pctText(v))}</td>`;
    }
    if (k === 'booking_value') return `<td class="n">${esc(v ? fmtMoney(v) : '-')}</td>`;
    if (k === 'breaches' || k === 'moved_away') return `<td class="n">${v ? `⛔ ${v}` : '0'}</td>`;
    if (k === 'waiting_now') return `<td class="n">${v}${a.overdue_now ? ` <span class="chip chip-crit">⛔ ${a.overdue_now}</span>` : ''}</td>`;
    return `<td class="n">${esc(fmtNumber(v))}</td>`;
  };
  return `<table class="data"><thead><tr>${cols.map(([k, l]) => `<th class="sortable ${k === 'name' ? '' : 'n'}" data-sort="${k}">${esc(l)}${state.sort === k ? ' ▾' : ''}</th>`).join('')}</tr></thead>
    <tbody>${sorted.map((a) => `<tr>${cols.map(([k]) => cell(a, k)).join('')}</tr>`).join('')}</tbody></table>`;
}

function render() {
  const d = state.data;
  const el = state.el;
  const periods = ['p_today', 'p_yesterday', 'p_7', 'p_30', 'p_month'];
  const head = `
    <div class="page-head"><h1>${esc(t('dashboard'))}</h1><span class="spacer"></span>
      <div class="tabs">${periods.map((p) => `<button class="tab ${state.period === p ? 'active' : ''}" data-period="${p}">${esc(t(p))}</button>`).join('')}</div>
      ${can('analytics.team') ? `<select data-user style="width:auto"><option value="">${esc(t('allAgents'))}</option>${store.users.map((u) => `<option value="${u.id}" ${String(u.id) === state.user ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
    </div>`;
  if (!d) { el.innerHTML = `<div class="page">${head}</div>`; bindHead(); return; }
  const o = d.overview;
  const l = d.live;
  const first = d.funnel[0]?.count || 0;

  el.innerHTML = `
    <div class="page">
      ${head}
      <p class="section-title">${esc(t('liveNow'))}</p>
      <div class="kpis">
        ${kpi(t('needs_reply'), fmtNumber(l.needs_reply), '', '', '💬')}
        ${kpi(t('overdue'), fmtNumber(l.overdue), '', l.overdue ? 'alert' : '', '⛔')}
        ${kpi(t('atRisk'), fmtNumber(l.at_risk), '', l.at_risk ? 'warn' : '', '⚠️')}
        ${kpi(t('unassigned'), fmtNumber(l.unassigned), '', l.unassigned ? 'warn' : '', '◌')}
        ${kpi(t('followUps'), fmtNumber(l.follow_ups_due), l.follow_ups_overdue ? `⛔ ${l.follow_ups_overdue} ${esc(t('overdueLabel'))}` : '', l.follow_ups_overdue ? 'alert' : '', '⏰')}
        ${kpi(t('commentsOpen'), fmtNumber(l.comments_open), l.comments_overdue ? `⛔ ${l.comments_overdue} ${esc(t('overdueLabel'))}` : '', l.comments_overdue ? 'alert' : '', '🗨️')}
        ${kpi(t('unclassified'), fmtNumber(l.unclassified), '', '', '❔')}
      </div>
      <p class="section-title" style="margin-top:16px">${esc(t(state.period))}</p>
      <div class="kpis">
        ${kpi(t('conversion'), pctText(o.conversion_qualified), esc(t('conversionHelp')), 'hero')}
        ${kpi(t('conversations'), fmtNumber(o.conversations), `${fmtNumber(o.inbound_messages)} ${esc(t('customerSays'))}`)}
        ${kpi(t('leads'), fmtNumber(o.leads), `${fmtNumber(o.qualified)} ${esc(t('qualified'))}`)}
        ${kpi(t('bookings'), fmtNumber(o.bookings), o.booking_value ? esc(fmtMoney(o.booking_value)) : '')}
        ${kpi(t('firstResponse'), esc(fmtSeconds(o.first_response.median)), `${esc(t('avgResponse'))}: ${esc(fmtSeconds(o.response.avg))}`)}
        ${kpi(t('slaCompliance'), pctText(o.sla_compliance), `${esc(t('breaches'))}: ${o.sla_breaches} · ${o.sla_target_min}m`, o.sla_compliance != null && o.sla_compliance < 80 ? 'alert' : '')}
      </div>
      <div class="dash-grid">
        <div class="card span-2"><div class="card-head"><h2>${esc(t('agentPerformance'))}</h2></div><div class="table-wrap">${agentTable(d.agents)}</div></div>
        <div class="card"><div class="card-head"><h2>${esc(t('funnel'))}</h2></div>
          ${hbars(d.funnel, { label: (r) => nameOf(r), tip: (r) => `${nameOf(r)}: ${r.count} (${first ? Math.round((r.count / first) * 100) : 0}% ${t('ofFirst')})`,
    fmt: (v) => `${fmtNumber(v)}${first ? ` · ${Math.round((v / first) * 100)}%` : ''}` })}</div>
        <div class="card"><div class="card-head"><h2>${esc(t('lostReasons'))}</h2></div>${hbars(d.lostReasons, { label: (r) => nameOf(r) })}</div>
        <div class="card span-2"><div class="card-head"><h2>${esc(t('channelPerformance'))}</h2></div><div class="table-wrap">
          <table class="data"><thead><tr><th></th><th class="n">${esc(t('conversations'))}</th><th class="n">${esc(t('leads'))}</th><th class="n">${esc(t('won'))}</th>
            <th class="n">${esc(t('conversion'))}</th><th class="n">${esc(t('avgResponse'))}</th><th class="n">${esc(t('slaCompliance'))}</th><th class="n">${esc(t('bookingValueTotal'))}</th></tr></thead>
          <tbody>${d.channels.map((c) => `<tr><td><span class="dot ch-${c.kind}"></span> ${esc(t(c.kind))}</td><td class="n">${fmtNumber(c.conversations)}</td><td class="n">${fmtNumber(c.leads)}</td>
            <td class="n">${fmtNumber(c.won)}</td><td class="n">${esc(pctText(c.conversion))}</td><td class="n">${esc(fmtSeconds(c.avg_response))}</td><td class="n">${esc(pctText(c.sla_compliance))}</td>
            <td class="n">${c.booking_value ? esc(fmtMoney(c.booking_value)) : '-'}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>${esc(t('daily'))}</h2></div>
          ${columns(d.daily, { value: (r) => r.conversations, label: (r) => r.day.slice(5), tip: (r) => `${r.day}: ${r.conversations} ${t('conversations')} · ${r.leads} ${t('leads')} · ${r.bookings} ${t('bookings')}` })}</div>
        <div class="card"><div class="card-head"><h2>${esc(t('hourly'))}</h2></div>
          ${columns(d.hourly, { value: (r) => r.messages, label: (r) => String(r.hour).padStart(2, '0'), tip: (r) => `${String(r.hour).padStart(2, '0')}:00 - ${r.messages}` })}</div>
        <div class="card"><div class="card-head"><h2>${esc(t('responseDist'))}</h2></div>${hbars(d.responseBuckets)}</div>
        <div class="card"><div class="card-head"><h2>${esc(t('bySource'))}</h2></div>
          ${hbars(d.bySource, { value: (r) => r.leads, label: (r) => r.key.replace(/_/g, ' '), tip: (r) => `${r.key}: ${r.leads} ${t('leads')}, ${r.won} ${t('won')} (${pctText(r.conversion)})`, fmt: (v) => fmtNumber(v) })}</div>
        <div class="card"><div class="card-head"><h2>${esc(t('byProject'))}</h2></div>
          ${hbars(d.byProject, { value: (r) => r.leads, label: (r) => r.key, tip: (r) => `${r.key}: ${r.leads} ${t('leads')}, ${r.won} ${t('won')} (${pctText(r.conversion)})` })}</div>
      </div>
    </div>`;
  bindHead();
  el.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => { state.sort = th.dataset.sort; render(); });
}

function bindHead() {
  state.el.querySelectorAll('[data-period]').forEach((b) => b.onclick = () => { state.period = b.dataset.period; load(); });
  state.el.querySelector('[data-user]')?.addEventListener('change', (e) => { state.user = e.target.value; load(); });
}

async function load() {
  const { from, to } = range(state.period);
  const params = new URLSearchParams({ from, to });
  if (state.user) params.set('user', state.user);
  try {
    state.data = await api('GET', `/analytics?${params}`);
    if (state.el) render();
  } catch (err) { showError(err); }
}
const loadSoon = debounce(load, 5000);

export default {
  mount(el) { state.el = el; render(); load(); },
  unmount() { state.el = null; },
  onEvent(type) { if (state.el && (type === 'conversation' || type === 'comment')) loadSoon(); },
};
