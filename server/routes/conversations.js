import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { q, tx, audit } from '../db.js';
import { HttpError, badRequest, forbidden, int, normalizePhone, notFound } from '../http.js';
import { can } from '../permissions.js';
import { randomToken } from '../security.js';
import { getSettings } from '../settings.js';
import { assign } from '../services/assignment.js';
import { broadcast, viewersSnapshot } from '../services/realtime.js';
import { messagingWindow, sendToCustomer } from '../services/outbound.js';
import { createLead } from '../services/leads.js';
import { aiAvailable, classify, suggestReply, summarize } from '../services/ai.js';
import { applyClassification } from '../services/ingest.js';
import { downloadWhatsAppMedia } from '../services/meta.js';

export const conversations = express.Router();

const TYPES = ['unknown', 'sales_lead', 'existing_guest', 'owner', 'broker', 'complaint', 'supplier', 'spam', 'other'];

function visibilitySql(user) {
  if (can(user, 'conv.view_all')) return { sql: '1 = 1', params: [] };
  return getSettings().allow_agent_claim
    ? { sql: '(c.assigned_user_id = ? OR c.assigned_user_id IS NULL)', params: [user.id] }
    : { sql: 'c.assigned_user_id = ?', params: [user.id] };
}

export function loadConversation(id, user) {
  const conv = q.get('SELECT * FROM conversations WHERE id = ?', id);
  if (!conv) throw notFound('Conversation not found');
  const visible = can(user, 'conv.view_all') || conv.assigned_user_id === user.id
    || (conv.assigned_user_id === null && getSettings().allow_agent_claim);
  if (!visible) throw forbidden('This chat is assigned to another agent');
  return conv;
}

function ensureCanAct(conv, user) {
  if (conv.assigned_user_id === user.id || can(user, 'conv.reply_any')) return;
  if (conv.assigned_user_id === null && getSettings().allow_agent_claim) {
    assign(conv.id, user.id, { byUserId: user.id, reason: 'claim' });
    return;
  }
  throw forbidden('This chat is assigned to another agent');
}

const LIST_SELECT = `
  SELECT c.id, c.status, c.type, c.priority, c.channel_kind, c.assigned_user_id, c.awaiting_since, c.sla_start_at,
         c.sla_due_at, c.sla_breached, c.escalation_level, c.last_message_at, c.last_inbound_at, c.last_message_preview,
         c.unread_count, c.snooze_until, c.current_lead_id, c.source,
         cu.name AS customer_name, cu.avatar_url, cu.phone,
         ch.name AS channel_name, u.name AS assigned_name,
         l.stage_key, l.temperature
  FROM conversations c
  JOIN customers cu ON cu.id = c.customer_id
  JOIN channels ch ON ch.id = c.channel_id
  LEFT JOIN users u ON u.id = c.assigned_user_id
  LEFT JOIN leads l ON l.id = c.current_lead_id`;

conversations.get('/conversations', (req, res) => {
  const user = req.user;
  const { view = 'mine', channel, assigned, stage, search, type } = req.query;
  const vis = visibilitySql(user);
  const where = [vis.sql];
  const params = [...vis.params];
  const now = Date.now();

  switch (view) {
    case 'mine': where.push("c.assigned_user_id = ? AND c.status <> 'closed'"); params.push(user.id); break;
    case 'unassigned': where.push("c.assigned_user_id IS NULL AND c.status <> 'closed'"); break;
    case 'needs_reply': where.push("c.status = 'needs_reply'"); break;
    case 'overdue': where.push("c.status = 'needs_reply' AND c.sla_due_at IS NOT NULL AND c.sla_due_at <= ?"); params.push(now); break;
    case 'waiting': where.push("c.status = 'waiting_customer'"); break;
    case 'snoozed': where.push("c.status = 'snoozed'"); break;
    case 'closed': where.push("c.status = 'closed'"); break;
    case 'hot': where.push("l.temperature = 'hot' AND c.status <> 'closed'"); break;
    default: where.push("c.status <> 'closed'");
  }
  if (channel) { where.push('c.channel_kind = ?'); params.push(channel); }
  if (type) { where.push('c.type = ?'); params.push(type); }
  if (assigned === 'none') where.push('c.assigned_user_id IS NULL');
  else if (assigned) { where.push('c.assigned_user_id = ?'); params.push(Number(assigned)); }
  if (stage) { where.push('l.stage_key = ?'); params.push(stage); }
  if (search) {
    const like = `%${String(search).trim()}%`;
    const digits = String(search).replace(/\D/g, '');
    where.push(`(cu.name LIKE ? OR cu.phone LIKE ? OR c.id = ? OR EXISTS (
      SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.body LIKE ?))`);
    params.push(like, digits ? `%${digits}%` : like, Number(search) || -1, like);
  }

  // Customers waiting longest first, then most recent activity.
  const rows = q.all(
    `${LIST_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN c.status = 'needs_reply' THEN 0 ELSE 1 END, COALESCE(c.sla_due_at, 9e15) ASC, c.last_message_at DESC
     LIMIT 300`,
    ...params,
  );

  const counts = q.get(
    `SELECT
       SUM(CASE WHEN c.assigned_user_id = ? AND c.status <> 'closed' THEN 1 ELSE 0 END) AS mine,
       SUM(CASE WHEN c.assigned_user_id IS NULL AND c.status <> 'closed' THEN 1 ELSE 0 END) AS unassigned,
       SUM(CASE WHEN c.status = 'needs_reply' THEN 1 ELSE 0 END) AS needs_reply,
       SUM(CASE WHEN c.status = 'needs_reply' AND c.sla_due_at <= ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN c.status = 'waiting_customer' THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN c.status = 'snoozed' THEN 1 ELSE 0 END) AS snoozed
     FROM conversations c WHERE ${vis.sql}`,
    user.id, now, ...vis.params,
  );
  res.json({ items: rows, counts, viewers: viewersSnapshot(), now });
});

function timeline(convId) {
  return q.all(
    `SELECT e.id, e.type, e.data_json, e.at, e.user_id, u.name AS user_name FROM events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.conversation_id = ? OR e.lead_id IN (SELECT id FROM leads WHERE conversation_id = ?)
     ORDER BY e.at, e.id`,
    convId, convId,
  ).map((e) => ({ ...e, data: e.data_json ? JSON.parse(e.data_json) : null, data_json: undefined }));
}

conversations.get('/conversations/:id', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  const customer = q.get('SELECT * FROM customers WHERE id = ?', conv.customer_id);
  const messages = q.all(
    `SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = ? ORDER BY m.created_at, m.id LIMIT 500`,
    conv.id,
  );
  const notes = q.all(
    'SELECT n.*, u.name AS user_name FROM notes n JOIN users u ON u.id = n.user_id WHERE n.conversation_id = ? ORDER BY n.created_at',
    conv.id,
  );
  const leads = q.all(
    `SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.customer_id = ? ORDER BY l.created_at DESC`,
    conv.customer_id,
  );
  const leadIds = leads.map((l) => l.id);
  const stageHistory = leadIds.length
    ? q.all(
      `SELECT h.*, u.name AS user_name FROM lead_stage_history h LEFT JOIN users u ON u.id = h.user_id
       WHERE h.lead_id IN (${leadIds.map(() => '?').join(',')}) ORDER BY h.at`,
      ...leadIds,
    )
    : [];
  const followUps = q.all(
    `SELECT f.*, u.name AS assigned_name FROM follow_ups f LEFT JOIN users u ON u.id = f.assigned_user_id
     WHERE f.conversation_id = ? OR f.lead_id IN (SELECT id FROM leads WHERE customer_id = ?) ORDER BY f.due_at DESC`,
    conv.id, conv.customer_id,
  );
  const responses = q.all(
    'SELECT r.*, u.name AS user_name FROM responses r LEFT JOIN users u ON u.id = r.user_id WHERE r.conversation_id = ? ORDER BY r.responded_at',
    conv.id,
  );
  const otherConversations = q.all(
    `SELECT c.id, c.channel_kind, c.status, c.last_message_at, ch.name AS channel_name FROM conversations c
     JOIN channels ch ON ch.id = c.channel_id WHERE c.customer_id = ? AND c.id <> ? ORDER BY c.last_message_at DESC`,
    conv.customer_id, conv.id,
  );
  res.json({
    conversation: {
      ...conv,
      ai: conv.ai_json ? JSON.parse(conv.ai_json) : null,
      ai_summary: conv.ai_summary ? JSON.parse(conv.ai_summary) : null,
      ad_ref: conv.ad_ref_json ? JSON.parse(conv.ad_ref_json) : null,
      window: messagingWindow(conv),
    },
    channel: q.get('SELECT id, kind, name FROM channels WHERE id = ?', conv.channel_id),
    customer,
    identities: q.all(
      `SELECT i.channel_kind, i.external_id, i.display_name, i.username, ch.name AS channel_name
       FROM customer_identities i JOIN channels ch ON ch.id = i.channel_id WHERE i.customer_id = ?`,
      conv.customer_id,
    ),
    messages,
    notes,
    leads,
    stageHistory,
    followUps,
    responses,
    otherConversations,
    timeline: timeline(conv.id),
  });
});

conversations.post('/conversations/:id/messages', async (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  ensureCanAct(conv, req.user);
  const { text, template } = req.body || {};
  const message = await sendToCustomer(conv.id, {
    text: typeof text === 'string' ? text.trim() : undefined,
    template: template?.name ? { name: String(template.name), language: String(template.language || 'ar') } : undefined,
    senderType: 'agent',
    userId: req.user.id,
  });
  res.json({ message });
});

const UPLOADS = path.join(config.dataDir, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|video\/mp4|audio\/(mpeg|ogg|aac|mp4)|application\/pdf)$/;

conversations.post('/conversations/:id/attachments', express.json({ limit: '25mb' }), async (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  ensureCanAct(conv, req.user);
  const { filename = 'file', mime, data, caption } = req.body || {};
  if (!ALLOWED_MIME.test(mime || '')) throw badRequest('Allowed: JPG, PNG, WEBP, GIF, MP4, MP3/OGG audio, PDF');
  const buffer = Buffer.from(String(data || ''), 'base64');
  if (!buffer.length || buffer.length > 16 * 1024 * 1024) throw badRequest('File must be under 16 MB');
  const ext = { 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mp4': 'm4a' }[mime]
    || mime.split('/')[1];
  const stored = `${randomToken(18)}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, stored), buffer);
  const message = await sendToCustomer(conv.id, {
    attachment: { url: `${config.publicUrl}/media/${stored}`, mime, filename: String(filename).slice(0, 100), caption: caption ? String(caption).slice(0, 1000) : undefined },
    senderType: 'agent',
    userId: req.user.id,
  });
  res.json({ message });
});

/** WhatsApp media needs the channel token, so the browser loads it through us. */
conversations.get('/media/wa/:messageId/:index', async (req, res) => {
  const msg = q.get('SELECT * FROM messages WHERE id = ?', int(req.params.messageId));
  if (!msg) throw notFound();
  const conv = loadConversation(msg.conversation_id, req.user);
  const att = JSON.parse(msg.attachments_json || '[]')[Number(req.params.index)];
  if (!att?.mediaId) throw notFound();
  const channel = q.get('SELECT * FROM channels WHERE id = ?', conv.channel_id);
  const media = await downloadWhatsAppMedia(channel, att.mediaId);
  res.setHeader('Content-Type', media.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(media.buffer);
});

conversations.post('/conversations/:id/notes', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  const body = String(req.body?.body || '').trim();
  if (!body) throw badRequest('Note is empty');
  const { id } = q.run('INSERT INTO notes (conversation_id, user_id, body, created_at) VALUES (?,?,?,?)', conv.id, req.user.id, body.slice(0, 4000), Date.now());
  audit({ conversationId: conv.id, userId: req.user.id, type: 'note_added', data: { note_id: id } });
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true, id });
});

conversations.post('/conversations/:id/assign', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  const to = req.body?.user_id ? int(req.body.user_id, 'user') : null;
  if (!can(req.user, 'conv.assign')) {
    // Agents may only hand their own chat to someone else or claim an unassigned one.
    const ownChat = conv.assigned_user_id === req.user.id;
    const claiming = conv.assigned_user_id === null && to === req.user.id && getSettings().allow_agent_claim;
    if (!ownChat && !claiming) throw forbidden('Only supervisors can reassign');
  }
  if (to && !q.get('SELECT 1 FROM users WHERE id = ? AND active = 1', to)) throw badRequest('User not found');
  const reason = to === req.user.id ? (conv.assigned_user_id ? 'takeover' : 'claim') : 'manual';
  res.json({ conversation: assign(conv.id, to, { byUserId: req.user.id, reason }) });
});

conversations.post('/conversations/:id/status', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  ensureCanAct(conv, req.user);
  const { status } = req.body || {};
  if (!['needs_reply', 'waiting_customer', 'snoozed', 'closed'].includes(status)) throw badRequest('Invalid status');
  let snoozeUntil = null;
  if (status === 'snoozed') {
    snoozeUntil = Number(req.body.snooze_until);
    if (!Number.isFinite(snoozeUntil) || snoozeUntil <= Date.now()) throw badRequest('Choose when the chat should come back');
  }
  if (status === 'closed' && conv.type === 'unknown') {
    throw badRequest('Set the conversation type before closing it', 'type_required');
  }
  const now = Date.now();
  tx(() => {
    q.run(
      `UPDATE conversations SET status = ?, snooze_until = ?, closed_at = ?,
         awaiting_since = CASE WHEN ? THEN NULL ELSE awaiting_since END,
         sla_start_at = CASE WHEN ? THEN NULL ELSE sla_start_at END,
         sla_due_at = CASE WHEN ? THEN NULL ELSE sla_due_at END
       WHERE id = ?`,
      status, snoozeUntil, status === 'closed' ? now : null,
      status === 'closed', status === 'closed', status === 'closed', conv.id,
    );
    audit({
      conversationId: conv.id, userId: req.user.id, type: 'status_changed',
      data: { from: conv.status, to: status, snooze_until: snoozeUntil || undefined, closed_without_reply: status === 'closed' && conv.awaiting_since ? true : undefined },
    });
  });
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true });
});

conversations.post('/conversations/:id/type', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  ensureCanAct(conv, req.user);
  const { type, priority } = req.body || {};
  if (type !== undefined && !TYPES.includes(type)) throw badRequest('Invalid type');
  if (priority !== undefined && !['normal', 'high', 'urgent'].includes(priority)) throw badRequest('Invalid priority');
  q.run('UPDATE conversations SET type = COALESCE(?, type), priority = COALESCE(?, priority) WHERE id = ?', type ?? null, priority ?? null, conv.id);
  audit({ conversationId: conv.id, userId: req.user.id, type: 'classified', data: { type, priority } });
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true });
});

conversations.post('/conversations/:id/read', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  if (conv.assigned_user_id === req.user.id) q.run('UPDATE conversations SET unread_count = 0 WHERE id = ?', conv.id);
  res.json({ ok: true });
});

conversations.post('/conversations/:id/leads', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  ensureCanAct(conv, req.user);
  const lead = createLead({ conversationId: conv.id, customerId: conv.customer_id, userId: req.user.id, fields: req.body || {} });
  res.json({ lead });
});

conversations.post('/conversations/:id/current-lead', (req, res) => {
  const conv = loadConversation(int(req.params.id), req.user);
  const leadId = int(req.body?.lead_id, 'lead');
  if (!q.get('SELECT 1 FROM leads WHERE id = ? AND customer_id = ?', leadId, conv.customer_id)) throw badRequest('Lead not found');
  q.run('UPDATE conversations SET current_lead_id = ? WHERE id = ?', leadId, conv.id);
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true });
});

conversations.patch('/customers/:id', (req, res) => {
  const id = int(req.params.id);
  const customer = q.get('SELECT * FROM customers WHERE id = ?', id);
  if (!customer) throw notFound();
  const allowed = can(req.user, 'conv.view_all')
    || q.get('SELECT 1 FROM conversations WHERE customer_id = ? AND assigned_user_id = ?', id, req.user.id);
  if (!allowed) throw forbidden();
  const patch = {};
  if ('name' in req.body) patch.name = String(req.body.name || '').trim().slice(0, 120) || null;
  if ('phone' in req.body) {
    patch.phone = req.body.phone ? normalizePhone(req.body.phone) : null;
    if (req.body.phone && !patch.phone) throw badRequest('Invalid phone number');
  }
  if ('email' in req.body) patch.email = String(req.body.email || '').trim().slice(0, 200) || null;
  if ('notes' in req.body) patch.notes = String(req.body.notes || '').slice(0, 4000) || null;
  const keys = Object.keys(patch);
  if (!keys.length) return res.json({ customer });
  q.run(`UPDATE customers SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => patch[k]), Date.now(), id);
  const changes = Object.fromEntries(keys.filter((k) => customer[k] !== patch[k]).map((k) => [k, { from: customer[k], to: patch[k] }]));
  const conv = q.get('SELECT id FROM conversations WHERE customer_id = ? ORDER BY last_message_at DESC LIMIT 1', id);
  audit({ conversationId: conv?.id, userId: req.user.id, type: 'customer_updated', data: changes });
  if (conv) broadcast('conversation', { id: conv.id });
  res.json({ customer: q.get('SELECT * FROM customers WHERE id = ?', id) });
});

// ---- AI helpers (assistive: results are shown to the agent, never sent automatically)
function requireAi() {
  if (!aiAvailable()) throw new HttpError(503, 'AI is not configured');
}

conversations.post('/conversations/:id/ai/suggest', async (req, res) => {
  requireAi();
  const conv = loadConversation(int(req.params.id), req.user);
  res.json({ text: await suggestReply(conv.id, req.user.name) });
});

conversations.post('/conversations/:id/ai/summary', async (req, res) => {
  requireAi();
  const conv = loadConversation(int(req.params.id), req.user);
  res.json({ summary: await summarize(conv.id) });
});

conversations.post('/conversations/:id/ai/classify', async (req, res) => {
  requireAi();
  const conv = loadConversation(int(req.params.id), req.user);
  const result = await classify(conv.id);
  applyClassification(conv.id, result);
  res.json({ result });
});
