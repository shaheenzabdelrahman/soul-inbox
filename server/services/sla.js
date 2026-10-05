import { q, tx, audit } from '../db.js';
import { getSettings } from '../settings.js';
import { isBusinessTime, nextBusinessStart } from './hours.js';
import { assign, autoAssign, availableAgents, handleAgentOffline } from './assignment.js';
import { broadcast, notify, usersWithRoles } from './realtime.js';

/** Called inside the ingest transaction when a customer message arrives. */
export function startAwaiting(conv, ts) {
  if (conv.awaiting_since) return;
  const s = getSettings();
  const start = nextBusinessStart(ts);
  q.run(
    `UPDATE conversations SET awaiting_since = ?, sla_start_at = ?, sla_due_at = ?,
       sla_warned = 0, sla_breached = 0, escalation_level = 0, reassign_count = 0
     WHERE id = ?`,
    ts, start, start + s.sla_target_min * 60000, conv.id,
  );
}

/** Called when a human reply is delivered. Stops the clock and records the response time. */
export function recordResponse(conversationId, userId, at = Date.now()) {
  const conv = q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv?.awaiting_since) return null;
  const s = getSettings();
  const isFirst = !q.get('SELECT 1 FROM responses WHERE conversation_id = ? LIMIT 1', conversationId);
  const secondsRaw = Math.max(0, Math.round((at - conv.awaiting_since) / 1000));
  const secondsSla = Math.max(0, Math.round((at - conv.sla_start_at) / 1000));
  q.run(
    `INSERT INTO responses (conversation_id, user_id, assigned_user_id, channel_kind, awaiting_since, sla_start_at,
       responded_at, seconds_raw, seconds_sla, within_sla, is_first) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    conversationId, userId, conv.assigned_user_id, conv.channel_kind, conv.awaiting_since, conv.sla_start_at,
    at, secondsRaw, secondsSla, secondsSla <= s.sla_target_min * 60 ? 1 : 0, isFirst ? 1 : 0,
  );
  q.run(
    `UPDATE conversations SET awaiting_since = NULL, sla_start_at = NULL, sla_due_at = NULL, sla_warned = 0,
       sla_breached = 0, escalation_level = 0, reassign_count = 0, unread_count = 0, night_ai_replies = 0,
       status = CASE WHEN status = 'needs_reply' THEN 'waiting_customer' ELSE status END
     WHERE id = ?`,
    conversationId,
  );
  return { secondsRaw, secondsSla };
}

function customerName(conv) {
  return q.get('SELECT name FROM customers WHERE id = ?', conv.customer_id)?.name || 'Customer';
}

function slaEvent(conv, kind, now) {
  q.run('INSERT INTO sla_events (conversation_id, user_id, kind, at) VALUES (?,?,?,?)', conv.id, conv.assigned_user_id, kind, now);
  audit({ conversationId: conv.id, type: `sla_${kind}`, data: { assignee: conv.assigned_user_id }, at: now });
}

function checkPresence(now, s) {
  const cutoff = now - s.presence_timeout_min * 60000;
  const stale = q.all("SELECT id FROM users WHERE presence = 'online' AND (last_seen_at IS NULL OR last_seen_at < ?)", cutoff);
  for (const u of stale) {
    q.run("UPDATE users SET presence = 'offline' WHERE id = ?", u.id);
    audit({ userId: u.id, type: 'presence', data: { presence: 'offline', reason: 'timeout' }, at: now });
    handleAgentOffline(u.id);
    broadcast('presence', { user_id: u.id, presence: 'offline' });
  }
}

function wakeSnoozed(now) {
  const due = q.all("SELECT id FROM conversations WHERE status = 'snoozed' AND snooze_until <= ?", now);
  for (const c of due) {
    q.run("UPDATE conversations SET status = 'needs_reply', snooze_until = NULL WHERE id = ?", c.id);
    audit({ conversationId: c.id, type: 'snooze_ended', at: now });
    const conv = q.get('SELECT assigned_user_id FROM conversations WHERE id = ?', c.id);
    notify([conv.assigned_user_id], { kind: 'snooze', title: 'Snoozed chat is back', conversationId: c.id });
    broadcast('conversation', { id: c.id });
  }
}

function routeUnassigned() {
  const waiting = q.all(
    "SELECT id FROM conversations WHERE status = 'needs_reply' AND (assigned_user_id IS NULL OR assigned_user_id NOT IN (SELECT id FROM users WHERE active = 1)) ORDER BY awaiting_since",
  );
  if (!waiting.length || !availableAgents().length) return;
  for (const c of waiting) autoAssign(c.id);
}

function checkTimers(now, s) {
  const warnBeforeMs = (s.sla_target_min - s.sla_warning_min) * 60000;
  const supervisors = () => usersWithRoles(['supervisor', 'manager', 'admin']);
  const managers = () => usersWithRoles(['manager', 'admin']);

  const open = q.all(
    "SELECT * FROM conversations WHERE status = 'needs_reply' AND awaiting_since IS NOT NULL AND sla_due_at IS NOT NULL",
  );
  for (const conv of open) {
    if (now < conv.sla_start_at) continue; // still outside business hours
    const name = customerName(conv);

    if (!conv.sla_warned && now >= conv.sla_due_at - warnBeforeMs && now < conv.sla_due_at) {
      tx(() => {
        q.run('UPDATE conversations SET sla_warned = 1 WHERE id = ?', conv.id);
        slaEvent(conv, 'warning', now);
      });
      notify([conv.assigned_user_id], { kind: 'sla_warning', title: 'Reply needed soon', body: name, conversationId: conv.id });
      broadcast('conversation', { id: conv.id });
    }

    if (!conv.sla_breached && now >= conv.sla_due_at) {
      tx(() => {
        q.run("UPDATE conversations SET sla_breached = 1, sla_warned = 1, priority = CASE WHEN priority = 'normal' THEN 'high' ELSE priority END WHERE id = ?", conv.id);
        slaEvent(conv, 'breach', now);
      });
      notify([conv.assigned_user_id], { kind: 'sla_breach', title: 'SLA breached', body: name, conversationId: conv.id });
      let movedTo = null;
      if (s.reassign_on_breach && conv.reassign_count < s.max_auto_reassign) {
        const next = availableAgents(conv.assigned_user_id ? [conv.assigned_user_id] : [])[0];
        if (next) {
          assign(conv.id, next.id, { reason: 'sla_breach' });
          movedTo = next.name;
        }
      }
      notify(supervisors(), {
        kind: 'sla_breach',
        title: movedTo ? `SLA breach - moved to ${movedTo}` : 'SLA breach - no agent available to take over',
        body: name,
        conversationId: conv.id,
      });
      broadcast('conversation', { id: conv.id });
    }

    const waitedMin = (now - conv.sla_start_at) / 60000;
    if (conv.escalation_level < 1 && waitedMin >= s.escalate_supervisor_min) {
      tx(() => {
        q.run("UPDATE conversations SET escalation_level = 1, priority = 'urgent' WHERE id = ?", conv.id);
        slaEvent(conv, 'escalation_supervisor', now);
      });
      notify(supervisors(), { kind: 'escalation', title: `Customer waiting ${s.escalate_supervisor_min}+ min`, body: name, conversationId: conv.id });
      broadcast('conversation', { id: conv.id });
    } else if (conv.escalation_level < 2 && waitedMin >= s.escalate_manager_min) {
      tx(() => {
        q.run("UPDATE conversations SET escalation_level = 2, priority = 'urgent' WHERE id = ?", conv.id);
        slaEvent(conv, 'escalation_manager', now);
      });
      notify(managers(), { kind: 'escalation', title: `Customer waiting ${s.escalate_manager_min}+ min`, body: name, conversationId: conv.id });
      broadcast('conversation', { id: conv.id });
    }
  }
}

function checkFollowUps(now, s) {
  const due = q.all(
    `SELECT f.*, c.name AS customer_name FROM follow_ups f
     LEFT JOIN leads l ON l.id = f.lead_id LEFT JOIN customers c ON c.id = l.customer_id
     WHERE f.status = 'open' AND f.notified = 0 AND f.due_at <= ?`,
    now,
  );
  for (const f of due) {
    q.run('UPDATE follow_ups SET notified = 1 WHERE id = ?', f.id);
    notify([f.assigned_user_id], {
      kind: 'follow_up', title: 'Follow-up due', body: `${f.customer_name || ''} ${f.note || ''}`.trim(), conversationId: f.conversation_id,
    });
  }
  const overdue = q.all(
    `SELECT f.*, c.name AS customer_name FROM follow_ups f
     LEFT JOIN leads l ON l.id = f.lead_id LEFT JOIN customers c ON c.id = l.customer_id
     WHERE f.status = 'open' AND f.escalated = 0 AND f.due_at <= ?`,
    now - s.follow_up_escalate_min * 60000,
  );
  for (const f of overdue) {
    q.run('UPDATE follow_ups SET escalated = 1 WHERE id = ?', f.id);
    audit({ conversationId: f.conversation_id, leadId: f.lead_id, type: 'follow_up_overdue', data: { follow_up_id: f.id }, at: now });
    notify(usersWithRoles(['supervisor', 'manager', 'admin']), {
      kind: 'follow_up_overdue', title: 'Follow-up overdue', body: f.customer_name || '', conversationId: f.conversation_id,
    });
  }
}

export function tick(now = Date.now()) {
  const s = getSettings();
  checkPresence(now, s);
  wakeSnoozed(now);
  if (isBusinessTime(now)) routeUnassigned();
  checkTimers(now, s);
  checkFollowUps(now, s);
}

export function startSlaLoop() {
  const run = () => {
    try {
      tick();
    } catch (err) {
      console.error('[sla] tick failed', err);
    }
  };
  run();
  return setInterval(run, 15000);
}
