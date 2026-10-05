import express from 'express';
import { q, audit } from '../db.js';
import { badRequest, forbidden, int } from '../http.js';
import { can } from '../permissions.js';
import { changeStage, completeFollowUp, createFollowUp, getLead, updateLead } from '../services/leads.js';
import { broadcast } from '../services/realtime.js';

export const leads = express.Router();

function canTouchLead(user, lead) {
  if (can(user, 'conv.view_all') || lead.owner_user_id === user.id) return true;
  return Boolean(lead.conversation_id && q.get('SELECT 1 FROM conversations WHERE id = ? AND assigned_user_id = ?', lead.conversation_id, user.id));
}

leads.get('/leads', (req, res) => {
  const { stage, owner, project, source, search, from, to } = req.query;
  const where = ['1 = 1'];
  const params = [];
  if (!can(req.user, 'conv.view_all')) { where.push('l.owner_user_id = ?'); params.push(req.user.id); }
  if (stage === 'open') where.push("s.kind = 'open'");
  else if (stage) { where.push('l.stage_key = ?'); params.push(stage); }
  if (owner) { where.push('l.owner_user_id = ?'); params.push(Number(owner)); }
  if (project) { where.push('l.project = ?'); params.push(project); }
  if (source) { where.push('l.source = ?'); params.push(source); }
  if (from) { where.push('l.created_at >= ?'); params.push(Number(from)); }
  if (to) { where.push('l.created_at < ?'); params.push(Number(to)); }
  if (search) {
    const like = `%${String(search).trim()}%`;
    where.push('(cu.name LIKE ? OR cu.phone LIKE ? OR l.booking_ref LIKE ?)');
    params.push(like, like, like);
  }
  const items = q.all(
    `SELECT l.*, s.kind AS stage_kind, cu.name AS customer_name, cu.phone, u.name AS owner_name, c.channel_kind,
       (SELECT MIN(f.due_at) FROM follow_ups f WHERE f.lead_id = l.id AND f.status = 'open') AS next_follow_up
     FROM leads l
     JOIN lead_stages s ON s.key = l.stage_key
     JOIN customers cu ON cu.id = l.customer_id
     LEFT JOIN users u ON u.id = l.owner_user_id
     LEFT JOIN conversations c ON c.id = l.conversation_id
     WHERE ${where.join(' AND ')}
     ORDER BY l.updated_at DESC LIMIT 500`,
    ...params,
  );
  res.json({ items });
});

leads.patch('/leads/:id', (req, res) => {
  const lead = getLead(int(req.params.id));
  if (!canTouchLead(req.user, lead)) throw forbidden();
  res.json({ lead: updateLead(lead.id, req.body || {}, req.user) });
});

leads.post('/leads/:id/stage', (req, res) => {
  const lead = getLead(int(req.params.id));
  if (!canTouchLead(req.user, lead)) throw forbidden();
  const { stage, ...opts } = req.body || {};
  res.json({ lead: changeStage(lead.id, String(stage || ''), opts, req.user) });
});

leads.post('/leads/:id/owner', (req, res) => {
  if (!can(req.user, 'conv.assign')) throw forbidden('Only supervisors can change the lead owner');
  const lead = getLead(int(req.params.id));
  const to = int(req.body?.user_id, 'user');
  if (!q.get('SELECT 1 FROM users WHERE id = ? AND active = 1', to)) throw badRequest('User not found');
  q.run('UPDATE leads SET owner_user_id = ?, updated_at = ? WHERE id = ?', to, Date.now(), lead.id);
  q.run("UPDATE follow_ups SET assigned_user_id = ? WHERE lead_id = ? AND status = 'open'", to, lead.id);
  audit({ conversationId: lead.conversation_id, leadId: lead.id, userId: req.user.id, type: 'lead_owner_changed', data: { from: lead.owner_user_id, to } });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  res.json({ lead: getLead(lead.id) });
});

leads.get('/follow-ups', (req, res) => {
  const mine = req.query.scope !== 'team' || !can(req.user, 'conv.view_all');
  const items = q.all(
    `SELECT f.*, cu.name AS customer_name, u.name AS assigned_name, l.stage_key, l.project
     FROM follow_ups f
     LEFT JOIN leads l ON l.id = f.lead_id
     LEFT JOIN customers cu ON cu.id = l.customer_id
     LEFT JOIN users u ON u.id = f.assigned_user_id
     WHERE f.status = 'open' ${mine ? 'AND f.assigned_user_id = ?' : ''}
     ORDER BY f.due_at LIMIT 500`,
    ...(mine ? [req.user.id] : []),
  );
  res.json({ items, now: Date.now() });
});

leads.post('/follow-ups', (req, res) => {
  const { lead_id, due_at, note } = req.body || {};
  const lead = getLead(int(lead_id, 'lead'));
  if (!canTouchLead(req.user, lead)) throw forbidden();
  const f = createFollowUp({
    leadId: lead.id, conversationId: lead.conversation_id, dueAt: due_at, note,
    assignedUserId: lead.owner_user_id || req.user.id, userId: req.user.id,
  });
  if (lead.conversation_id) broadcast('conversation', { id: lead.conversation_id });
  res.json({ followUp: f });
});

leads.post('/follow-ups/:id/done', (req, res) => {
  const f = completeFollowUp(int(req.params.id), req.user, req.body?.cancel ? 'cancelled' : 'done');
  if (f.conversation_id) broadcast('conversation', { id: f.conversation_id });
  res.json({ followUp: f });
});
