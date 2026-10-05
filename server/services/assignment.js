import { q, tx, audit } from '../db.js';
import { getSettings } from '../settings.js';
import { isBusinessTime } from './hours.js';
import { broadcast, notify } from './realtime.js';

// Reasons that hand the waiting customer to a new agent mid-cycle: the new agent gets
// a fresh (shorter) window instead of inheriting an already-breached deadline.
const FRESH_WINDOW_REASONS = new Set(['sla_breach', 'agent_offline', 'manual', 'takeover', 'claim']);

/** Agents who can take a chat right now, best candidate first. */
export function availableAgents(excludeIds = []) {
  const s = getSettings();
  const cutoff = Date.now() - s.presence_timeout_min * 60000;
  return q.all(
    `SELECT u.id, u.name, u.max_open, u.last_assigned_at,
       (SELECT COUNT(*) FROM conversations c WHERE c.assigned_user_id = u.id AND c.status = 'needs_reply') AS waiting
     FROM users u
     WHERE u.active = 1 AND u.in_rotation = 1 AND u.presence = 'online' AND u.last_seen_at >= ?`,
    cutoff,
  )
    .filter((u) => !excludeIds.includes(u.id) && u.waiting < u.max_open)
    // least loaded first, then whoever has waited longest for a new chat (round robin)
    .sort((a, b) => a.waiting - b.waiting || (a.last_assigned_at || 0) - (b.last_assigned_at || 0));
}

export function isAvailable(userId) {
  return availableAgents().some((a) => a.id === userId);
}

export function assign(conversationId, toUserId, { byUserId = null, reason }) {
  const now = Date.now();
  const s = getSettings();
  const conv = q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv || conv.assigned_user_id === toUserId) return conv;

  tx(() => {
    const freshWindow = conv.awaiting_since && FRESH_WINDOW_REASONS.has(reason) && isBusinessTime(now);
    q.run(
      `UPDATE conversations SET assigned_user_id = ?, assigned_at = ?,
         sla_due_at = CASE WHEN ? THEN ? ELSE sla_due_at END,
         sla_warned = CASE WHEN ? THEN 0 ELSE sla_warned END,
         sla_breached = CASE WHEN ? THEN 0 ELSE sla_breached END,
         reassign_count = reassign_count + ?
       WHERE id = ?`,
      toUserId, now,
      freshWindow, Math.max(conv.sla_due_at || 0, now + s.reassign_window_min * 60000),
      freshWindow, freshWindow,
      reason === 'sla_breach' || reason === 'agent_offline' ? 1 : 0,
      conversationId,
    );
    q.run(
      'INSERT INTO assignments (conversation_id, from_user_id, to_user_id, by_user_id, reason, at) VALUES (?,?,?,?,?,?)',
      conversationId, conv.assigned_user_id, toUserId, byUserId, reason, now,
    );
    if (toUserId) q.run('UPDATE users SET last_assigned_at = ? WHERE id = ?', now, toUserId);
    audit({
      conversationId, userId: byUserId, type: 'assigned',
      data: { from: conv.assigned_user_id, to: toUserId, reason }, at: now,
    });
  });

  const customer = q.get('SELECT name FROM customers WHERE id = ?', conv.customer_id);
  if (toUserId && toUserId !== byUserId) {
    notify([toUserId], {
      kind: 'assigned',
      title: reason === 'sla_breach' ? 'Chat moved to you (SLA breach)' : 'New chat assigned to you',
      body: customer?.name || 'Customer',
      conversationId,
    });
  }
  if (conv.assigned_user_id && conv.assigned_user_id !== byUserId && conv.assigned_user_id !== toUserId) {
    notify([conv.assigned_user_id], {
      kind: 'unassigned',
      title: reason === 'sla_breach' ? 'Chat moved away: no reply in time' : 'Chat reassigned',
      body: customer?.name || 'Customer',
      conversationId,
    });
  }
  broadcast('conversation', { id: conversationId });
  return q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
}

function previousOwner(customerId) {
  return q.get(
    `SELECT assigned_user_id AS id FROM conversations
     WHERE customer_id = ? AND assigned_user_id IS NOT NULL ORDER BY last_message_at DESC LIMIT 1`,
    customerId,
  )?.id;
}

/**
 * Route a chat that needs an owner. Keeps the current owner when available, otherwise
 * prefers the customer's previous agent (sticky), otherwise the best available agent.
 * Returns the assignee id or null (nobody online / outside business hours).
 */
export function autoAssign(conversationId, { exclude = [], reason = 'auto' } = {}) {
  if (!isBusinessTime()) return null;
  const conv = q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv || conv.status === 'closed') return null;

  const candidates = availableAgents(exclude);
  if (conv.assigned_user_id && !exclude.includes(conv.assigned_user_id)
      && candidates.some((c) => c.id === conv.assigned_user_id)) {
    return conv.assigned_user_id;
  }
  const sticky = previousOwner(conv.customer_id);
  if (sticky && sticky !== conv.assigned_user_id && candidates.some((c) => c.id === sticky)) {
    assign(conversationId, sticky, { reason: reason === 'auto' ? 'sticky' : reason });
    return sticky;
  }
  const pick = candidates[0];
  if (!pick) return null;
  assign(conversationId, pick.id, { reason });
  return pick.id;
}

/** When an agent goes offline, chats where a customer is waiting move to someone online. */
export function handleAgentOffline(userId) {
  const waiting = q.all(
    "SELECT id FROM conversations WHERE assigned_user_id = ? AND status = 'needs_reply'",
    userId,
  );
  for (const c of waiting) autoAssign(c.id, { exclude: [userId], reason: 'agent_offline' });
}
