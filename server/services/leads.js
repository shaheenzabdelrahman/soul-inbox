import { q, tx, audit } from '../db.js';
import { badRequest, forbidden, notFound } from '../http.js';
import { can } from '../permissions.js';
import { broadcast } from './realtime.js';

export const LEAD_FIELDS = ['source', 'campaign', 'project', 'unit_type', 'check_in', 'check_out', 'guests', 'budget', 'temperature'];

export function stages() {
  return q.all('SELECT * FROM lead_stages ORDER BY position');
}

export function getLead(id) {
  const lead = q.get('SELECT * FROM leads WHERE id = ?', id);
  if (!lead) throw notFound('Lead not found');
  return lead;
}

function cleanFields(input) {
  const out = {};
  for (const f of LEAD_FIELDS) {
    if (!(f in input)) continue;
    let v = input[f];
    if (v === '' || v === undefined) v = null;
    if (f === 'guests' && v !== null) {
      v = Number(v);
      if (!Number.isInteger(v) || v < 0 || v > 200) throw badRequest('Guests must be a whole number');
    }
    if ((f === 'check_in' || f === 'check_out') && v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw badRequest('Dates must be YYYY-MM-DD');
    }
    if (f === 'temperature' && v !== null && !['hot', 'warm', 'cold'].includes(v)) throw badRequest('Invalid temperature');
    out[f] = v === null ? null : f === 'guests' ? v : String(v).slice(0, 200);
  }
  if (out.check_in && out.check_out && out.check_out <= out.check_in) throw badRequest('Check-out must be after check-in');
  return out;
}

export function createLead({ conversationId = null, customerId, userId = null, fields = {} }) {
  const conv = conversationId ? q.get('SELECT * FROM conversations WHERE id = ?', conversationId) : null;
  const now = Date.now();
  const data = cleanFields({ source: conv?.source, ...fields });
  const owner = conv?.assigned_user_id || userId;
  const lead = tx(() => {
    const { id } = q.run(
      `INSERT INTO leads (customer_id, conversation_id, stage_key, owner_user_id, source, campaign, project, unit_type,
         check_in, check_out, guests, budget, temperature, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      customerId ?? conv.customer_id, conversationId, 'new', owner, data.source, data.campaign ?? conv?.ad_id ?? null,
      data.project, data.unit_type, data.check_in, data.check_out, data.guests, data.budget, data.temperature,
      userId, now, now,
    );
    q.run('INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, user_id, at) VALUES (?,?,?,?,?)', id, null, 'new', userId, now);
    if (conversationId) {
      q.run(
        "UPDATE conversations SET current_lead_id = ?, type = CASE WHEN type = 'unknown' THEN 'sales_lead' ELSE type END WHERE id = ?",
        id, conversationId,
      );
    }
    audit({ conversationId, leadId: id, userId, type: 'lead_created', data, at: now });
    return getLead(id);
  });
  if (conversationId) broadcast('conversation', { id: conversationId });
  return lead;
}

export function updateLead(leadId, input, user) {
  const lead = getLead(leadId);
  const data = cleanFields(input);
  const keys = Object.keys(data);
  if (!keys.length) return lead;
  const changes = {};
  for (const k of keys) if (lead[k] !== data[k]) changes[k] = { from: lead[k], to: data[k] };
  if (!Object.keys(changes).length) return lead;
  tx(() => {
    q.run(
      `UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...keys.map((k) => data[k]), Date.now(), leadId,
    );
    audit({ conversationId: lead.conversation_id, leadId, userId: user.id, type: 'lead_updated', data: changes });
  });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  return getLead(leadId);
}

export function createFollowUp({ leadId = null, conversationId = null, dueAt, note = null, assignedUserId, userId }) {
  const due = Number(dueAt);
  if (!Number.isFinite(due)) throw badRequest('Follow-up date is required');
  if (due < Date.now() - 60000) throw badRequest('Follow-up must be in the future');
  const { id } = q.run(
    `INSERT INTO follow_ups (lead_id, conversation_id, assigned_user_id, due_at, note, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    leadId, conversationId, assignedUserId, due, note ? String(note).slice(0, 500) : null, userId, Date.now(),
  );
  audit({ conversationId, leadId, userId, type: 'follow_up_created', data: { id, due_at: due, note } });
  return q.get('SELECT * FROM follow_ups WHERE id = ?', id);
}

export function completeFollowUp(id, user, status = 'done') {
  const f = q.get('SELECT * FROM follow_ups WHERE id = ?', id);
  if (!f) throw notFound('Follow-up not found');
  if (f.status !== 'open') return f;
  if (f.assigned_user_id !== user.id && !can(user, 'conv.view_all')) throw forbidden();
  q.run('UPDATE follow_ups SET status = ?, done_at = ?, done_by = ? WHERE id = ?', status, Date.now(), user.id, id);
  audit({ conversationId: f.conversation_id, leadId: f.lead_id, userId: user.id, type: `follow_up_${status}`, data: { id } });
  return q.get('SELECT * FROM follow_ups WHERE id = ?', id);
}

/**
 * Move a lead through the pipeline, enforcing the operational rules:
 *  - stages flagged requires_phone need a customer phone number (Meta's 24h window makes it essential);
 *  - stages flagged requires_follow_up need a scheduled next action;
 *  - Lost needs a reason; reopening a closed lead needs manager rights.
 */
export function changeStage(leadId, toKey, opts, user) {
  const lead = getLead(leadId);
  const to = q.get('SELECT * FROM lead_stages WHERE key = ? AND active = 1', toKey);
  if (!to) throw badRequest('Unknown stage');
  if (lead.stage_key === toKey) return lead;
  const from = q.get('SELECT * FROM lead_stages WHERE key = ?', lead.stage_key);
  const customer = q.get('SELECT * FROM customers WHERE id = ?', lead.customer_id);

  if (from.kind !== 'open' && !can(user, 'leads.reopen')) throw forbidden('Only a manager can reopen a closed lead');
  if (to.requires_phone && !customer.phone) {
    throw badRequest('Add the customer phone number before moving to this stage', 'phone_required');
  }
  if (to.kind === 'lost') {
    const reason = q.get('SELECT key FROM lost_reasons WHERE key = ? AND active = 1', opts.lost_reason_key || '');
    if (!reason) throw badRequest('Choose a lost reason', 'lost_reason_required');
  }
  const hasFutureFollowUp = q.get(
    "SELECT 1 FROM follow_ups WHERE lead_id = ? AND status = 'open' AND due_at > ?", leadId, Date.now(),
  );
  if (to.requires_follow_up && !opts.follow_up_at && !hasFutureFollowUp) {
    throw badRequest('Schedule a follow-up for this stage', 'follow_up_required');
  }
  let bookingValue = null;
  if (to.kind === 'won' && opts.booking_value !== undefined && opts.booking_value !== '' && opts.booking_value !== null) {
    bookingValue = Number(opts.booking_value);
    if (!Number.isFinite(bookingValue) || bookingValue < 0) throw badRequest('Invalid booking value');
  }

  const now = Date.now();
  tx(() => {
    const reachedQualified = to.is_qualified || (to.kind === 'won');
    q.run(
      `UPDATE leads SET stage_key = ?, updated_at = ?,
         qualified_at = CASE WHEN qualified_at IS NULL AND ? THEN ? ELSE qualified_at END,
         won_at = CASE WHEN ? THEN ? ELSE won_at END,
         closed_at = CASE WHEN ? THEN ? ELSE NULL END,
         lost_reason_key = CASE WHEN ? THEN ? ELSE lost_reason_key END,
         lost_note = CASE WHEN ? THEN ? ELSE lost_note END,
         booking_ref = CASE WHEN ? THEN ? ELSE booking_ref END,
         booking_value = CASE WHEN ? THEN ? ELSE booking_value END
       WHERE id = ?`,
      toKey, now,
      reachedQualified ? 1 : 0, now,
      to.kind === 'won', now,
      to.kind !== 'open', now,
      to.kind === 'lost', opts.lost_reason_key || null,
      to.kind === 'lost', opts.lost_note ? String(opts.lost_note).slice(0, 500) : null,
      to.kind === 'won', opts.booking_ref ? String(opts.booking_ref).slice(0, 100) : null,
      to.kind === 'won', bookingValue,
      leadId,
    );
    q.run('INSERT INTO lead_stage_history (lead_id, from_stage, to_stage, user_id, at) VALUES (?,?,?,?,?)', leadId, lead.stage_key, toKey, user.id, now);
    audit({
      conversationId: lead.conversation_id, leadId, userId: user.id, type: 'stage_changed',
      data: { from: lead.stage_key, to: toKey, lost_reason: opts.lost_reason_key || undefined, booking_value: bookingValue ?? undefined },
      at: now,
    });
    if (opts.follow_up_at) {
      createFollowUp({
        leadId, conversationId: lead.conversation_id, dueAt: opts.follow_up_at, note: opts.follow_up_note,
        assignedUserId: lead.owner_user_id || user.id, userId: user.id,
      });
    }
    if (to.kind !== 'open') {
      q.run("UPDATE follow_ups SET status = 'cancelled', done_at = ?, done_by = ? WHERE lead_id = ? AND status = 'open'", now, user.id, leadId);
    }
  });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  return getLead(leadId);
}
