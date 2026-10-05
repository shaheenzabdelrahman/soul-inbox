import express from 'express';
import { config } from '../config.js';
import { q, audit } from '../db.js';
import { badRequest } from '../http.js';
import { login, logout, requireAuth, revokeSessions } from '../auth.js';
import { can, permissionsFor } from '../permissions.js';
import { hashPassword, validatePassword, verifyPassword } from '../security.js';
import { getSettings } from '../settings.js';
import { addClient, broadcast, setViewing, viewersSnapshot } from '../services/realtime.js';
import { handleAgentOffline } from '../services/assignment.js';
import { aiAvailable } from '../services/ai.js';
import { isBusinessTime } from '../services/hours.js';

export const account = express.Router();

account.post('/auth/login', (req, res) => {
  const user = login(req, res, req.body || {});
  res.json({ ok: true, id: user.id });
});

account.post('/auth/logout', (req, res) => {
  logout(req, res);
  res.json({ ok: true });
});

account.use(requireAuth);

/** Everything the UI needs to boot: who am I, reference data, rules. */
account.get('/me', (req, res) => {
  const s = getSettings();
  res.json({
    user: req.user,
    permissions: permissionsFor(req.user),
    users: q.all('SELECT id, name, role, presence, active, in_rotation FROM users ORDER BY name'),
    channels: q.all('SELECT id, kind, name, active FROM channels ORDER BY kind, name'),
    stages: q.all('SELECT * FROM lead_stages WHERE active = 1 ORDER BY position'),
    lostReasons: q.all('SELECT * FROM lost_reasons WHERE active = 1 ORDER BY position'),
    templates: q.all('SELECT id, title, body, shortcut FROM templates WHERE active = 1 ORDER BY title'),
    rules: {
      company_name: s.company_name,
      business_start: s.business_start,
      business_end: s.business_end,
      sla_target_min: s.sla_target_min,
      sla_warning_min: s.sla_warning_min,
      comment_sla_min: s.comment_sla_min,
      projects: s.projects,
      lead_sources: s.lead_sources,
      allow_agent_claim: s.allow_agent_claim,
    },
    businessNow: isBusinessTime(),
    aiAvailable: aiAvailable(),
    simulator: config.simulatorEnabled && can(req.user, 'simulator'),
    viewers: viewersSnapshot(),
  });
});

account.post('/me/heartbeat', (req, res) => {
  q.run('UPDATE users SET last_seen_at = ? WHERE id = ?', Date.now(), req.user.id);
  setViewing(req.user.id, req.body?.viewing || null);
  res.json({ ok: true, businessNow: isBusinessTime() });
});

account.post('/me/presence', (req, res) => {
  const presence = req.body?.presence;
  if (!['online', 'away', 'offline'].includes(presence)) throw badRequest('Invalid presence');
  q.run('UPDATE users SET presence = ?, last_seen_at = ? WHERE id = ?', presence, Date.now(), req.user.id);
  audit({ userId: req.user.id, type: 'presence', data: { presence } });
  if (presence !== 'online') handleAgentOffline(req.user.id);
  broadcast('presence', { user_id: req.user.id, presence });
  res.json({ ok: true });
});

account.post('/me/password', (req, res) => {
  const { current, next } = req.body || {};
  const row = q.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(current || ''), row.password_hash)) throw badRequest('Current password is wrong');
  const err = validatePassword(next);
  if (err) throw badRequest(err);
  q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  revokeSessions(req.user.id);
  audit({ userId: req.user.id, type: 'password_changed' });
  logout(req, res);
  res.json({ ok: true });
});

account.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  addClient(req.user, res);
});

account.get('/notifications', (req, res) => {
  res.json({
    items: q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', req.user.id),
    unread: q.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n,
  });
});

account.post('/notifications/read', (req, res) => {
  q.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', Date.now(), req.user.id);
  res.json({ ok: true });
});
