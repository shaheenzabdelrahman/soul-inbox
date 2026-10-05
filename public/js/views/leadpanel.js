import { nameOf, t } from '../i18n.js';
import { api, esc, fmtDateTime, fromLocalInput, modal, showError, toLocalInput, toast } from '../util.js';
import { can, store, stageByKey } from '../store.js';

// Lead editor shared by the inbox side panel and the Leads page.

export function stageChip(key) {
  const s = stageByKey(key);
  if (!s) return '';
  const cls = s.kind === 'won' ? 'chip-good' : s.kind === 'lost' || s.kind === 'invalid' ? 'chip-crit' : 'chip-gold';
  return `<span class="chip ${cls}">${esc(nameOf(s))}</span>`;
}

const sourceLabel = (s) => (s ? s.replace(/_/g, ' ') : '-');

function followUpForm(defaultHours = 24) {
  return `
    <label class="field">${esc(t('followUpAt'))}<input type="datetime-local" name="follow_up_at" required value="${toLocalInput(Date.now() + defaultHours * 3600000)}"></label>
    <label class="field">${esc(t('followUpNote'))}<input name="follow_up_note" maxlength="300"></label>`;
}

/** Ask for whatever the target stage requires, then move the lead. Returns true when moved. */
export async function moveStage(lead, key) {
  const st = stageByKey(key);
  const hasFollowUp = lead._openFollowUps > 0;
  let body = '';
  if (st.kind === 'lost') {
    body = `<label class="field">${esc(t('lostReason'))}<select name="lost_reason_key" required><option value=""></option>${store.lostReasons.map((r) => `<option value="${esc(r.key)}">${esc(nameOf(r))}</option>`).join('')}</select></label>
      <label class="field">${esc(t('lostNote'))}<input name="lost_note" maxlength="300"></label>`;
  } else if (st.kind === 'won') {
    body = `<label class="field">${esc(t('bookingRef'))}<input name="booking_ref" maxlength="100"></label>
      <label class="field">${esc(t('bookingValue'))}<input name="booking_value" type="number" min="0" step="1"></label>`;
  } else if (st.requires_follow_up && !hasFollowUp) {
    body = followUpForm();
  }
  let payload = { stage: key };
  if (body) {
    const values = await modal({ title: `${t('stage')}: ${nameOf(st)}`, body, submitLabel: t('confirm') });
    if (!values) return false;
    payload = { ...payload, ...values };
    if (values.follow_up_at) payload.follow_up_at = fromLocalInput(values.follow_up_at);
  }
  try {
    await api('POST', `/leads/${lead.id}/stage`, payload);
    return true;
  } catch (err) {
    if (err.code === 'follow_up_required') {
      const v = await modal({ title: `${t('stage')}: ${nameOf(st)}`, body: followUpForm(), submitLabel: t('confirm') });
      if (!v) return false;
      await api('POST', `/leads/${lead.id}/stage`, { stage: key, follow_up_at: fromLocalInput(v.follow_up_at), follow_up_note: v.follow_up_note }).catch(showError);
      return true;
    }
    showError(err);
    return false;
  }
}

export async function addFollowUp(lead) {
  const v = await modal({ title: t('addFollowUp'), body: followUpForm(), submitLabel: t('save') });
  if (!v) return false;
  await api('POST', '/follow-ups', { lead_id: lead.id, due_at: fromLocalInput(v.follow_up_at), note: v.follow_up_note }).catch(showError);
  return true;
}

export function renderLead(lead, followUps, { now = Date.now() } = {}) {
  const current = stageByKey(lead.stage_key);
  const openStages = store.stages.filter((s) => s.kind === 'open');
  const closing = store.stages.filter((s) => s.kind !== 'open');
  const open = followUps.filter((f) => f.lead_id === lead.id && f.status === 'open');
  lead._openFollowUps = open.filter((f) => f.due_at > now).length;
  const options = (list, val) => list.map((x) => `<option value="${esc(x)}" ${x === val ? 'selected' : ''}>${esc(x.replace(/_/g, ' '))}</option>`).join('');
  return `
    <div>
      <p class="section-title">${esc(t('stage'))}</p>
      <div class="stages">
        ${openStages.map((s) => `<button class="stage-btn ${s.key === lead.stage_key ? 'current' : current?.kind === 'open' && s.position < current.position ? 'done' : ''}" data-stage="${esc(s.key)}">${esc(nameOf(s))}</button>`).join('')}
      </div>
      <div class="stages" style="margin-top:6px">
        ${closing.map((s) => `<button class="stage-btn ${s.kind} ${s.key === lead.stage_key ? 'current' : ''}" data-stage="${esc(s.key)}">${s.kind === 'won' ? '✓' : '✕'} ${esc(nameOf(s))}</button>`).join('')}
      </div>
      ${current?.kind === 'lost' && lead.lost_reason_key ? `<p class="small" style="margin:6px 0 0">${esc(t('lostReason'))}: <strong>${esc(nameOf(store.lostReasons.find((r) => r.key === lead.lost_reason_key)))}</strong> ${esc(lead.lost_note || '')}</p>` : ''}
      ${current?.kind === 'won' ? `<p class="small" style="margin:6px 0 0">${esc(t('bookingRef'))}: <strong>${esc(lead.booking_ref || '-')}</strong> · ${lead.booking_value != null ? esc(Number(lead.booking_value).toLocaleString()) : '-'}</p>` : ''}
    </div>
    <form class="stack" data-lead-form>
      <div class="grid-2">
        <label class="field">${esc(t('project'))}<select name="project"><option value=""></option>${options(store.rules.projects || [], lead.project)}</select></label>
        <label class="field">${esc(t('unitType'))}<input name="unit_type" value="${esc(lead.unit_type || '')}" placeholder="2BR"></label>
        <label class="field">${esc(t('checkIn'))}<input type="date" name="check_in" value="${esc(lead.check_in || '')}"></label>
        <label class="field">${esc(t('checkOut'))}<input type="date" name="check_out" value="${esc(lead.check_out || '')}"></label>
        <label class="field">${esc(t('guests'))}<input type="number" min="0" name="guests" value="${esc(lead.guests ?? '')}"></label>
        <label class="field">${esc(t('budget'))}<input name="budget" value="${esc(lead.budget || '')}"></label>
        <label class="field">${esc(t('temperature'))}<select name="temperature"><option value=""></option>${['hot', 'warm', 'cold'].map((x) => `<option value="${x}" ${lead.temperature === x ? 'selected' : ''}>${esc(t(`${x}_t`))}</option>`).join('')}</select></label>
        <label class="field">${esc(t('source'))}<select name="source"><option value=""></option>${options(store.rules.lead_sources || [], lead.source)}</select></label>
      </div>
      <label class="field">${esc(t('campaign'))}<input name="campaign" value="${esc(lead.campaign || '')}"></label>
      <div class="row"><span class="small muted">${esc(t('owner'))}:
        ${can('conv.assign')
    ? `<select data-lead-owner style="width:auto;min-height:28px;padding:2px 6px">${store.users.filter((u) => u.active).map((u) => `<option value="${u.id}" ${u.id === lead.owner_user_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`
    : `<strong>${esc(lead.owner_name || '-')}</strong>`}</span>
        <span class="spacer"></span><button class="btn btn-sm btn-primary" type="submit">${esc(t('save'))}</button></div>
    </form>
    <div>
      <div class="row"><p class="section-title" style="margin:0">${esc(t('openFollowUps'))}</p><span class="spacer"></span>
        ${current?.kind === 'open' ? `<button class="btn btn-sm" data-add-fu>+ ${esc(t('addFollowUp'))}</button>` : ''}</div>
      <div class="stack" style="margin-top:6px">
        ${open.length ? open.map((f) => `
          <div class="fu ${f.due_at < now ? 'overdue' : ''}">
            <div style="flex:1"><div><strong>${esc(fmtDateTime(f.due_at))}</strong> ${f.due_at < now ? `<span class="chip chip-crit">⛔ ${esc(t('overdueLabel'))}</span>` : ''}</div>
              <div class="small muted">${esc(f.note || '')} · ${esc(f.assigned_name || '')}</div></div>
            <button class="btn btn-sm" data-fu-done="${f.id}">✓ ${esc(t('done'))}</button>
          </div>`).join('') : `<p class="small muted" style="margin:0">${esc(t('noFollowUps'))}</p>`}
      </div>
    </div>`;
}

/** Wire the controls rendered by renderLead. `refresh` reloads the surrounding view. */
export function bindLead(container, lead, refresh) {
  container.querySelectorAll('[data-stage]').forEach((b) => b.onclick = async () => {
    if (b.dataset.stage === lead.stage_key) return;
    if (await moveStage(lead, b.dataset.stage)) refresh();
  });
  const form = container.querySelector('[data-lead-form]');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        await api('PATCH', `/leads/${lead.id}`, values);
        toast(t('saved'));
        refresh();
      } catch (err) { showError(err); }
    };
  }
  const owner = container.querySelector('[data-lead-owner]');
  if (owner) owner.onchange = async () => { await api('POST', `/leads/${lead.id}/owner`, { user_id: Number(owner.value) }).catch(showError); refresh(); };
  container.querySelector('[data-add-fu]')?.addEventListener('click', async () => { if (await addFollowUp(lead)) refresh(); });
  container.querySelectorAll('[data-fu-done]').forEach((b) => b.onclick = async () => {
    await api('POST', `/follow-ups/${b.dataset.fuDone}/done`, {}).catch(showError);
    refresh();
  });
}

export { sourceLabel };
