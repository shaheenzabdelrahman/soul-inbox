import { t } from '../i18n.js';
import { api, esc, fmtDateTime, modal, showError, toast } from '../util.js';
import { can, loadMe, store } from '../store.js';

const state = { el: null, tab: 'general', data: null };

function tabs() {
  return [
    ['general', 's_general'],
    can('channels.manage') && ['channels', 's_channels'],
    ['stages', 's_stages'],
    ['reasons', 's_reasons'],
    ['templates', 's_templates'],
    ['ai', 's_ai'],
    store.simulator && ['sim', 's_sim'],
    can('audit.view') && ['audit', 's_audit'],
  ].filter(Boolean);
}

function render(body) {
  state.el.innerHTML = `
    <div class="page">
      <div class="page-head"><h1>${esc(t('settings'))}</h1></div>
      <div class="tabs" style="margin-bottom:14px">${tabs().map(([k, l]) => `<button class="tab ${state.tab === k ? 'active' : ''}" data-tab="${k}">${esc(t(l))}</button>`).join('')}</div>
      <div data-body>${body}</div>
    </div>`;
  state.el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { location.hash = `#/settings/${b.dataset.tab}`; });
  return state.el.querySelector('[data-body]');
}

async function saveSettings(patch) {
  try {
    await api('PUT', '/settings', patch);
    toast(t('saved'));
    await loadMe();
  } catch (err) { showError(err); }
}

// ---------- general
async function general() {
  const { settings: s, webhook } = await api('GET', '/settings');
  const num = (k, label) => `<label class="field">${esc(t(label))}<input type="number" min="0" name="${k}" value="${esc(s[k])}"></label>`;
  const check = (k, label) => `<label class="check"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}> ${esc(t(label))}</label>`;
  const body = render(`
    <form class="stack" data-form style="max-width:820px">
      <div class="card stack"><h2>${esc(t('s_general'))}</h2>
        <div class="grid-3">
          <label class="field">${esc(t('businessStart'))}<input name="business_start" value="${esc(s.business_start)}" pattern="\\d{2}:\\d{2}"></label>
          <label class="field">${esc(t('businessEnd'))}<input name="business_end" value="${esc(s.business_end)}" pattern="\\d{2}:\\d{2}"></label>
          <label class="field">${esc(t('nightMode'))}<select name="night_mode">${['ai', 'message', 'off'].map((m) => `<option value="${m}" ${s.night_mode === m ? 'selected' : ''}>${esc(t(`night_${m}`))}</option>`).join('')}</select></label>
        </div>
        <p class="small muted" style="margin:0">${esc(t('businessHelp'))}</p>
        <label class="field">${esc(t('nightMessage'))}<textarea name="night_message" rows="4">${esc(s.night_message)}</textarea></label>
      </div>
      <div class="card stack"><h2>SLA</h2>
        <div class="grid-3">${num('sla_target_min', 'slaTarget')}${num('sla_warning_min', 'slaWarning')}${num('reassign_window_min', 'reassignWindow')}
          ${num('max_auto_reassign', 'maxAutoReassign')}${num('escalate_supervisor_min', 'escSupervisor')}${num('escalate_manager_min', 'escManager')}
          ${num('comment_sla_min', 'commentSla')}${num('follow_up_escalate_min', 'followUpEscalate')}${num('presence_timeout_min', 'presenceTimeout')}</div>
        ${check('reassign_on_breach', 'reassignOnBreach')}${check('allow_agent_claim', 'allowClaim')}${check('messenger_human_agent_tag', 'humanAgentTag')}
      </div>
      <div class="card stack"><h2>${esc(t('project'))}</h2>
        <label class="field">${esc(t('projects'))}<textarea name="projects" rows="6">${esc(s.projects.join('\n'))}</textarea></label>
        <label class="field">${esc(t('source'))}<textarea name="lead_sources" rows="5">${esc(s.lead_sources.join('\n'))}</textarea></label>
      </div>
      ${can('channels.manage') ? `<div class="card stack"><h2>Webhook</h2>
        <dl class="kv"><dt>${esc(t('webhookUrl'))}</dt><dd><code>${esc(webhook.url)}</code></dd>
          <dt>${esc(t('verifyToken'))}</dt><dd>${webhook.verifyTokenSet ? `✅ ${esc(t('configured'))}` : `⛔ ${esc(t('notConfigured'))} (META_VERIFY_TOKEN)`}</dd>
          <dt>App secret</dt><dd>${webhook.appSecretSet ? `✅ ${esc(t('configured'))}` : `⛔ ${esc(t('notConfigured'))} (META_APP_SECRET)`}</dd></dl></div>` : ''}
      <div class="row"><button class="btn btn-primary">${esc(t('save'))}</button></div>
    </form>`);
  body.querySelector('[data-form]').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const v = Object.fromEntries(new FormData(f).entries());
    for (const cb of f.querySelectorAll('input[type=checkbox]')) v[cb.name] = cb.checked;
    for (const k of ['projects', 'lead_sources']) v[k] = v[k].split('\n').map((x) => x.trim()).filter(Boolean);
    saveSettings(v);
  };
}

// ---------- channels
async function channels() {
  const { items } = await api('GET', '/channels');
  const { webhook } = await api('GET', '/settings');
  const body = render(`
    <div class="card stack" style="max-width:980px">
      <div class="row"><h2>${esc(t('s_channels'))}</h2><span class="spacer"></span><button class="btn btn-primary" data-add>+ ${esc(t('addChannel'))}</button></div>
      <p class="small muted" style="margin:0">${esc(t('webhookUrl'))}: <code>${esc(webhook.url)}</code></p>
      <div class="table-wrap"><table class="data"><thead><tr><th></th><th>${esc(t('name'))}</th><th>${esc(t('externalId'))}</th><th>Token</th><th>${esc(t('status'))}</th><th></th></tr></thead>
      <tbody>${items.map((c) => `<tr>
        <td><span class="dot ch-${c.kind}"></span> ${esc(t(c.kind))}</td><td><strong>${esc(c.name)}</strong></td>
        <td class="small">${esc(c.external_id)}${c.page_id ? `<div class="muted">page ${esc(c.page_id)}</div>` : ''}${c.waba_id ? `<div class="muted">WABA ${esc(c.waba_id)}</div>` : ''}</td>
        <td>${c.has_token ? '✅' : '⛔'}</td><td>${c.active ? `🟢 ${esc(t('active'))}` : '⚫'}</td>
        <td class="row">
          <button class="btn btn-sm" data-test="${c.id}">${esc(t('test'))}</button>
          <button class="btn btn-sm" data-sub="${c.id}">${esc(t('subscribe'))}</button>
          <button class="btn btn-sm" data-token="${c.id}">Token</button>
          <button class="btn btn-sm" data-toggle="${c.id}" data-active="${c.active}">${esc(c.active ? t('disable') : t('enable'))}</button>
        </td></tr>`).join('')}</tbody></table></div>
    </div>`);
  body.querySelector('[data-add]').onclick = async () => {
    const ok = await modal({
      title: t('addChannel'),
      body: `
        <label class="field">${esc(t('channelType'))}<select name="kind" data-kind>${['whatsapp', 'messenger', 'instagram'].map((k) => `<option value="${k}">${esc(t(k))}</option>`).join('')}</select></label>
        <label class="field">${esc(t('name'))}<input name="name" required placeholder="Soul Hospitality"></label>
        <label class="field"><span data-id-label>${esc(t('idHelp_whatsapp'))}</span><input name="external_id" required></label>
        <label class="field" data-page hidden>${esc(t('pageId'))}<input name="page_id"></label>
        <label class="field" data-waba>${esc(t('wabaId'))}<input name="waba_id"></label>
        <label class="field">${esc(t('accessToken'))}<input name="access_token" type="password" autocomplete="off" required></label>`,
      onSubmit: (v) => api('POST', '/channels', v),
    });
    if (ok) { toast(t('saved')); channels(); loadMe(); }
  };

  body.querySelectorAll('[data-test]').forEach((b) => b.onclick = async () => {
    try { const r = await api('POST', `/channels/${b.dataset.test}/test`, {}); toast(`✅ ${r.info}`); } catch (err) { showError(err); }
  });
  body.querySelectorAll('[data-sub]').forEach((b) => b.onclick = async () => {
    try { await api('POST', `/channels/${b.dataset.sub}/subscribe`, {}); toast('✅'); } catch (err) { showError(err); }
  });
  body.querySelectorAll('[data-token]').forEach((b) => b.onclick = async () => {
    const ok = await modal({
      title: t('accessToken'),
      body: `<label class="field">${esc(t('accessToken'))}<input name="access_token" type="password" required autocomplete="off"></label>`,
      onSubmit: (v) => api('PATCH', `/channels/${b.dataset.token}`, v),
    });
    if (ok) { toast(t('tokenSaved')); channels(); }
  });
  body.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
    await api('PATCH', `/channels/${b.dataset.toggle}`, { active: b.dataset.active !== '1' }).catch(showError);
    channels();
    loadMe();
  });
}

// Add-channel dialog: show the fields that matter for the chosen channel type.
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-kind]')) return;
  const form = e.target.closest('form');
  form.querySelector('[data-id-label]').textContent = t(`idHelp_${e.target.value}`);
  form.querySelector('[data-page]').hidden = e.target.value !== 'instagram';
  form.querySelector('[data-waba]').hidden = e.target.value !== 'whatsapp';
});
// ---------- stages & reasons (editable tables)
async function stages() {
  const { stages: list } = await api('GET', '/stages');
  const row = (s = {}) => `<tr>
    <td><input name="key" value="${esc(s.key || '')}" ${s.key ? 'readonly' : ''} style="min-width:110px"></td>
    <td><input name="name_en" value="${esc(s.name_en || '')}"></td><td><input name="name_ar" value="${esc(s.name_ar || '')}" dir="rtl"></td>
    <td><select name="kind">${['open', 'won', 'lost', 'invalid'].map((k) => `<option ${s.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
    <td><input type="checkbox" name="requires_phone" ${s.requires_phone ? 'checked' : ''}></td>
    <td><input type="checkbox" name="requires_follow_up" ${s.requires_follow_up ? 'checked' : ''}></td>
    <td><input type="checkbox" name="is_qualified" ${s.is_qualified ? 'checked' : ''}></td>
    <td><input type="checkbox" name="active" ${s.active === 0 ? '' : 'checked'}></td>
    <td><button type="button" class="icon-btn" data-up>▲</button><button type="button" class="icon-btn" data-down>▼</button></td></tr>`;
  const body = render(`
    <form class="card stack" data-form>
      <div class="table-wrap"><table class="data"><thead><tr><th>${esc(t('key'))}</th><th>${esc(t('nameEn'))}</th><th>${esc(t('nameAr'))}</th><th>${esc(t('kind'))}</th>
        <th>${esc(t('needsPhone'))}</th><th>${esc(t('needsFollowUp'))}</th><th>${esc(t('countsQualified'))}</th><th>${esc(t('active'))}</th><th></th></tr></thead>
        <tbody data-rows>${list.map(row).join('')}</tbody></table></div>
      <div class="row"><button type="button" class="btn" data-add>+ ${esc(t('addStage'))}</button><span class="spacer"></span><button class="btn btn-primary">${esc(t('save'))}</button></div>
    </form>`);
  wireRows(body, row);
  body.querySelector('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    const rows = [...body.querySelectorAll('[data-rows] tr')].map((tr) => ({
      key: tr.querySelector('[name=key]').value, name_en: tr.querySelector('[name=name_en]').value, name_ar: tr.querySelector('[name=name_ar]').value,
      kind: tr.querySelector('[name=kind]').value, requires_phone: tr.querySelector('[name=requires_phone]').checked,
      requires_follow_up: tr.querySelector('[name=requires_follow_up]').checked, is_qualified: tr.querySelector('[name=is_qualified]').checked,
      active: tr.querySelector('[name=active]').checked,
    })).filter((r) => r.key);
    try { await api('PUT', '/stages', { stages: rows }); toast(t('saved')); await loadMe(); stages(); } catch (err) { showError(err); }
  };
}

async function reasons() {
  const { lostReasons } = await api('GET', '/stages');
  const row = (r = {}) => `<tr><td><input name="key" value="${esc(r.key || '')}" ${r.key ? 'readonly' : ''}></td>
    <td><input name="name_en" value="${esc(r.name_en || '')}"></td><td><input name="name_ar" value="${esc(r.name_ar || '')}" dir="rtl"></td>
    <td><input type="checkbox" name="active" ${r.active === 0 ? '' : 'checked'}></td>
    <td><button type="button" class="icon-btn" data-up>▲</button><button type="button" class="icon-btn" data-down>▼</button></td></tr>`;
  const body = render(`
    <form class="card stack" data-form style="max-width:820px">
      <table class="data"><thead><tr><th>${esc(t('key'))}</th><th>${esc(t('nameEn'))}</th><th>${esc(t('nameAr'))}</th><th>${esc(t('active'))}</th><th></th></tr></thead>
        <tbody data-rows>${lostReasons.map(row).join('')}</tbody></table>
      <div class="row"><button type="button" class="btn" data-add>+ ${esc(t('addReason'))}</button><span class="spacer"></span><button class="btn btn-primary">${esc(t('save'))}</button></div>
    </form>`);
  wireRows(body, row);
  body.querySelector('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    const rows = [...body.querySelectorAll('[data-rows] tr')].map((tr) => ({
      key: tr.querySelector('[name=key]').value, name_en: tr.querySelector('[name=name_en]').value,
      name_ar: tr.querySelector('[name=name_ar]').value, active: tr.querySelector('[name=active]').checked,
    })).filter((r) => r.key);
    try { await api('PUT', '/lost-reasons', { reasons: rows }); toast(t('saved')); await loadMe(); } catch (err) { showError(err); }
  };
}

function wireRows(body, row) {
  const tbody = body.querySelector('[data-rows]');
  body.querySelector('[data-add]').onclick = () => tbody.insertAdjacentHTML('beforeend', row());
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (e.target.matches('[data-up]') && tr.previousElementSibling) tr.parentNode.insertBefore(tr, tr.previousElementSibling);
    if (e.target.matches('[data-down]') && tr.nextElementSibling) tr.parentNode.insertBefore(tr.nextElementSibling, tr);
  });
}

// ---------- saved replies
async function templates() {
  await loadMe();
  const form = (tp = {}) => `
    <label class="field">${esc(t('title'))}<input name="title" required value="${esc(tp.title || '')}"></label>
    <label class="field">${esc(t('shortcut'))}<input name="shortcut" value="${esc(tp.shortcut || '')}"></label>
    <label class="field">${esc(t('body'))}<textarea name="body" rows="5" required>${esc(tp.body || '')}</textarea></label>
    <p class="small muted" style="margin:0">${esc(t('templateVars'))}</p>
    ${tp.id ? `<label class="check"><input type="checkbox" name="active" checked> ${esc(t('active'))}</label>` : ''}`;
  const body = render(`
    <div class="card stack" style="max-width:820px">
      <div class="row"><h2>${esc(t('s_templates'))}</h2><span class="spacer"></span>${can('templates.manage') ? `<button class="btn btn-primary" data-add>+ ${esc(t('addTemplate'))}</button>` : ''}</div>
      ${store.templates.map((tp) => `<div class="fu"><div style="flex:1"><strong>${esc(tp.title)}</strong> ${tp.shortcut ? `<span class="chip">/${esc(tp.shortcut)}</span>` : ''}
        <div class="small muted" style="white-space:pre-wrap">${esc(tp.body)}</div></div>
        ${can('templates.manage') ? `<button class="btn btn-sm" data-edit="${tp.id}">${esc(t('edit'))}</button>` : ''}</div>`).join('')}
    </div>`);
  body.querySelector('[data-add]')?.addEventListener('click', async () => {
    if (await modal({ title: t('addTemplate'), body: form(), onSubmit: (v) => api('POST', '/templates', v) })) templates();
  });
  body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = async () => {
    const tp = store.templates.find((x) => x.id === Number(b.dataset.edit));
    if (await modal({ title: t('edit'), body: form(tp), onSubmit: (v) => api('PATCH', `/templates/${tp.id}`, v) })) templates();
  });
}

// ---------- AI
async function ai() {
  const { settings: s, aiConfigured, aiModel } = await api('GET', '/settings');
  const body = render(`
    <form class="card stack" data-form style="max-width:820px">
      <p>${aiConfigured ? `✅ ${esc(t('configured'))} · ${esc(t('aiModel'))}: <code>${esc(aiModel)}</code>` : `⛔ ${esc(t('notConfigured'))} (ANTHROPIC_API_KEY)`}</p>
      <label class="check"><input type="checkbox" name="ai_enabled" ${s.ai_enabled ? 'checked' : ''}> ${esc(t('aiEnabled'))}</label>
      <label class="check"><input type="checkbox" name="ai_auto_classify" ${s.ai_auto_classify ? 'checked' : ''}> ${esc(t('aiAutoClassify'))}</label>
      <label class="field">${esc(t('knowledgeBase'))}<textarea name="knowledge_base" rows="10">${esc(s.knowledge_base)}</textarea></label>
      <div class="row"><button class="btn btn-primary">${esc(t('save'))}</button></div>
    </form>`);
  body.querySelector('[data-form]').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    saveSettings({ ai_enabled: f.ai_enabled.checked, ai_auto_classify: f.ai_auto_classify.checked, knowledge_base: f.knowledge_base.value });
  };
}

// ---------- simulator
function sim() {
  const body = render(`
    <div class="grid-2" style="max-width:980px">
      <form class="card stack" data-msg>
        <h2>💬 ${esc(t('s_sim'))}</h2><p class="small muted" style="margin:0">${esc(t('simIntro'))}</p>
        <label class="field">${esc(t('channelType'))}<select name="kind">${['whatsapp', 'messenger', 'instagram'].map((k) => `<option value="${k}">${esc(t(k))}</option>`).join('')}</select></label>
        <label class="field">${esc(t('simCustomer'))}<input name="name" required value="Mona Ahmed"></label>
        <label class="field">${esc(t('phone'))} (WhatsApp)<input name="phone" placeholder="01001234567"></label>
        <label class="field">${esc(t('simText'))}<textarea name="text" required>عايزة شاليه 3 غرف في فوكا باي من 1 لـ 4 أغسطس، 6 أفراد</textarea></label>
        <label class="field">${esc(t('simAd'))}<input name="ad"></label>
        <button class="btn btn-primary">${esc(t('simSend'))}</button>
      </form>
      <form class="card stack" data-comment>
        <h2>🗨️ ${esc(t('comments'))}</h2>
        <label class="field">${esc(t('channelType'))}<select name="platform"><option value="facebook">Facebook</option><option value="instagram">Instagram</option></select></label>
        <label class="field">${esc(t('simCustomer'))}<input name="name" required value="Karim"></label>
        <label class="field">${esc(t('simText'))}<textarea name="text" required>بكام الليلة في جايا؟</textarea></label>
        <button class="btn btn-primary">${esc(t('simComment'))}</button>
      </form>
    </div>`);
  body.querySelector('[data-msg]').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/sim/inbound', Object.fromEntries(new FormData(e.target).entries()));
      toast(t('sentOk'));
      if (r?.conversationId) e.target.insertAdjacentHTML('beforeend', `<a href="#/inbox/${r.conversationId}" class="small">→ ${esc(t('openChat'))} #${r.conversationId}</a>`);
    } catch (err) { showError(err); }
  };
  body.querySelector('[data-comment]').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/sim/comment', Object.fromEntries(new FormData(e.target).entries())); toast(t('sentOk')); } catch (err) { showError(err); }
  };
}

// ---------- audit
async function audit(before) {
  const { items } = await api('GET', `/audit${before ? `?before=${before}` : ''}`);
  const rows = items.map((e) => `<tr><td class="small num">${esc(fmtDateTime(e.at))}</td><td>${esc(e.user_name || t('system'))}</td>
    <td>${esc(t(`ev_${e.type}`) === `ev_${e.type}` ? e.type : t(`ev_${e.type}`))}</td>
    <td class="small">${e.conversation_id ? `<a href="#/inbox/${e.conversation_id}">#${e.conversation_id}</a> ` : ''}<code style="white-space:pre-wrap">${esc(e.data_json || '')}</code></td></tr>`).join('');
  if (before) {
    state.el.querySelector('[data-rows]').insertAdjacentHTML('beforeend', rows);
  } else {
    render(`<div class="card table-wrap"><table class="data"><thead><tr><th>${esc(t('when'))}</th><th>${esc(t('who'))}</th><th>${esc(t('event'))}</th><th>${esc(t('details'))}</th></tr></thead>
      <tbody data-rows>${rows}</tbody></table><div class="row" style="margin-top:10px"><button class="btn" data-more>${esc(t('loadMore'))}</button></div></div>`);
  }
  const more = state.el.querySelector('[data-more]');
  if (more) more.onclick = () => items.length && audit(items[items.length - 1].at);
}

const TABS = { general, channels, stages, reasons, templates, ai, sim, audit };

function show(rest) {
  const allowed = tabs().map(([k]) => k);
  state.tab = allowed.includes(rest[0]) ? rest[0] : 'general';
  Promise.resolve(TABS[state.tab]()).catch(showError);
}

export default {
  mount(el, rest) { state.el = el; show(rest); },
  update(rest) { show(rest); },
  unmount() { state.el = null; },
};
