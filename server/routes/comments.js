import express from 'express';
import { q, tx, audit } from '../db.js';
import { badRequest, forbidden, int, notFound } from '../http.js';
import { can } from '../permissions.js';
import { createLead } from '../services/leads.js';
import { replyToCommentPrivately, replyToCommentPublicly } from '../services/meta.js';
import { broadcast } from '../services/realtime.js';

export const comments = express.Router();

const isSimulated = (c) => String(c.author_external_id || '').startsWith('sim-');

function load(id) {
  const c = q.get('SELECT * FROM comments WHERE id = ?', id);
  if (!c) throw notFound('Comment not found');
  return c;
}

function ensureCanAct(c, user) {
  if (can(user, 'comments.manage') || !c.assigned_user_id || c.assigned_user_id === user.id) return;
  throw forbidden('This comment is assigned to another agent');
}

comments.get('/comments', (req, res) => {
  const { status = 'open', platform } = req.query;
  const where = [];
  const params = [];
  if (status === 'open') where.push("c.status = 'new'");
  else if (status !== 'all') { where.push('c.status = ?'); params.push(status); }
  if (platform) { where.push('c.platform = ?'); params.push(platform); }
  const items = q.all(
    `SELECT c.*, ch.name AS channel_name, u.name AS assigned_name, l.stage_key
     FROM comments c JOIN channels ch ON ch.id = c.channel_id
     LEFT JOIN users u ON u.id = c.assigned_user_id
     LEFT JOIN leads l ON l.id = c.lead_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE WHEN c.status = 'new' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 300`,
    ...params,
  );
  const counts = q.get(
    "SELECT SUM(status = 'new') AS open, SUM(status = 'replied') AS replied, SUM(status = 'handled') AS handled FROM comments",
  );
  res.json({ items, counts, now: Date.now() });
});

comments.post('/comments/:id/reply', async (req, res) => {
  const c = load(int(req.params.id));
  ensureCanAct(c, req.user);
  const text = String(req.body?.text || '').trim();
  if (!text) throw badRequest('Reply is empty');
  if (!isSimulated(c)) {
    const channel = q.get('SELECT * FROM channels WHERE id = ?', c.channel_id);
    await replyToCommentPublicly(channel, c.platform, c.external_id, text);
  }
  const now = Date.now();
  q.run(
    "UPDATE comments SET public_reply = ?, public_reply_at = ?, public_reply_by = ?, status = 'replied', assigned_user_id = COALESCE(assigned_user_id, ?) WHERE id = ?",
    text, now, req.user.id, req.user.id, c.id,
  );
  audit({ userId: req.user.id, type: 'comment_replied', data: { comment_id: c.id, public: true } });
  broadcast('comment', { id: c.id });
  res.json({ comment: load(c.id) });
});

comments.post('/comments/:id/private', async (req, res) => {
  const c = load(int(req.params.id));
  ensureCanAct(c, req.user);
  if (c.private_reply_at) throw badRequest('Meta allows only one private reply per comment');
  const text = String(req.body?.text || '').trim();
  if (!text) throw badRequest('Message is empty');
  if (!isSimulated(c)) {
    const channel = q.get('SELECT * FROM channels WHERE id = ?', c.channel_id);
    await replyToCommentPrivately(channel, c.external_id, text);
  }
  const now = Date.now();
  q.run(
    "UPDATE comments SET private_reply_at = ?, private_reply_by = ?, status = CASE WHEN status = 'new' THEN 'replied' ELSE status END, assigned_user_id = COALESCE(assigned_user_id, ?) WHERE id = ?",
    now, req.user.id, req.user.id, c.id,
  );
  audit({ userId: req.user.id, type: 'comment_replied', data: { comment_id: c.id, private: true } });
  broadcast('comment', { id: c.id });
  res.json({ comment: load(c.id) });
});

comments.post('/comments/:id/assign', (req, res) => {
  const c = load(int(req.params.id));
  const to = req.body?.user_id ? int(req.body.user_id, 'user') : null;
  if (!can(req.user, 'comments.manage') && to !== req.user.id) throw forbidden();
  q.run('UPDATE comments SET assigned_user_id = ? WHERE id = ?', to, c.id);
  audit({ userId: req.user.id, type: 'comment_assigned', data: { comment_id: c.id, to } });
  broadcast('comment', { id: c.id });
  res.json({ comment: load(c.id) });
});

comments.post('/comments/:id/handled', (req, res) => {
  const c = load(int(req.params.id));
  ensureCanAct(c, req.user);
  q.run("UPDATE comments SET status = 'handled', handled_at = ?, handled_by = ? WHERE id = ?", Date.now(), req.user.id, c.id);
  audit({ userId: req.user.id, type: 'comment_handled', data: { comment_id: c.id } });
  broadcast('comment', { id: c.id });
  res.json({ comment: load(c.id) });
});

/** Turn a commenter into a lead so the sales case is tracked even before they DM us. */
comments.post('/comments/:id/lead', (req, res) => {
  const c = load(int(req.params.id));
  ensureCanAct(c, req.user);
  if (c.lead_id) throw badRequest('A lead already exists for this comment');
  const lead = tx(() => {
    let customerId = c.customer_id;
    if (!customerId) {
      const now = Date.now();
      customerId = q.run(
        'INSERT INTO customers (name, notes, is_simulated, created_at, updated_at) VALUES (?,?,?,?,?)',
        c.author_name || 'Commenter', `From ${c.platform} comment: ${String(c.body || '').slice(0, 200)}`, isSimulated(c) ? 1 : 0, now, now,
      ).id;
    }
    const l = createLead({
      customerId, userId: req.user.id,
      fields: { source: c.platform === 'instagram' ? 'instagram_comment' : 'facebook_comment', campaign: c.post_id, ...(req.body || {}) },
    });
    q.run('UPDATE leads SET owner_user_id = COALESCE(owner_user_id, ?) WHERE id = ?', req.user.id, l.id);
    q.run(
      "UPDATE comments SET customer_id = ?, lead_id = ?, assigned_user_id = COALESCE(assigned_user_id, ?) WHERE id = ?",
      customerId, l.id, req.user.id, c.id,
    );
    return l;
  });
  broadcast('comment', { id: c.id });
  res.json({ lead, comment: load(c.id) });
});
