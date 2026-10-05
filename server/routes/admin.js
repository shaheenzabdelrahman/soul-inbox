import express from 'express';
import { config } from '../config.js';
import { q, audit } from '../db.js';
import { badRequest, forbidden, int, notFound } from '../http.js';
import { requirePerm, revokeSessions } from '../auth.js';
import { ROLES, can } from '../permissions.js';
import { encrypt, hashPassword, validatePassword } from '../security.js';
import { DEFAULTS, getSettings, updateSettings } from '../settings.js';
import { handleAgentOffline } from '../services/assignment.js';
import { checkChannel, subscribePage, subscribeWaba } from '../services/meta.js';
import { broadcast } from '../services/realtime.js';

export const admin = express.Router();

// ---------- Users
admin.get('/users', requirePerm('users.manage'), (req, res) => {
  const items = q.all(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.in_rotation, u.max_open, u.presence, u.last_seen_at, u.created_at,
       (SELECT COUNT(*) FROM conversations c WHERE c.assigned_user_id = u.id AND c.status = 'needs_reply') AS waiting,
       (SELECT COUNT(*) FROM conversations c WHERE c.assigned_user_id = u.id AND c.status <> 'closed') AS open
     FROM users u ORDER BY u.active DESC, u.name`,
  );
  res.json({ items });
});

function checkRoleChange(actor, role) {
  if (!ROLES.includes(role)) throw badRequest('Invalid role');
  if (role === 'admin' && !can(actor, 'users.manage_admins')) throw forbidden('Only an admin can create admins');
}

admin.post('/users', requirePerm('users.manage'), (req, res) => {
  const { name, email, role = 'agent', password, in_rotation = role === 'agent', max_open = 30 } = req.body || {};
  if (!String(name || '').trim()) throw badRequest('Name is required');
  if (!/^[^@\s]+@[^@\s]+$/.test(String(email || ''))) throw badRequest('Valid email is required');
  checkRoleChange(req.user, role);
  const err = validatePassword(password);
  if (err) throw badRequest(err);
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) throw badRequest('Email already used');
  const { id } = q.run(
    'INSERT INTO users (name, email, password_hash, role, in_rotation, max_open, created_at) VALUES (?,?,?,?,?,?,?)',
    String(name).trim(), String(email).trim(), hashPassword(password), role, in_rotation ? 1 : 0, Number(max_open) || 30, Date.now(),
  );
  audit({ userId: req.user.id, type: 'user_created', data: { id, email, role } });
  broadcast('users', {});
  res.json({ id });
});

admin.patch('/users/:id', requirePerm('users.manage'), (req, res) => {
  const id = int(req.params.id);
  const target = q.get('SELECT * FROM users WHERE id = ?', id);
  if (!target) throw notFound();
  if (target.role === 'admin' && !can(req.user, 'users.manage_admins')) throw forbidden('Only an admin can edit admins');
  const b = req.body || {};
  const patch = {};
  if ('name' in b) patch.name = String(b.name).trim();
  if ('role' in b) { checkRoleChange(req.user, b.role); patch.role = b.role; }
  if ('active' in b) {
    if (id === req.user.id && !b.active) throw badRequest('You cannot disable yourself');
    patch.active = b.active ? 1 : 0;
  }
  if ('in_rotation' in b) patch.in_rotation = b.in_rotation ? 1 : 0;
  if ('max_open' in b) {
    const n = Number(b.max_open);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest('Max chats must be 1-500');
    patch.max_open = n;
  }
  if (b.password) {
    const err = validatePassword(b.password);
    if (err) throw badRequest(err);
    patch.password_hash = hashPassword(b.password);
  }
  const keys = Object.keys(patch);
  if (keys.length) {
    q.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), id);
    audit({ userId: req.user.id, type: 'user_updated', data: { id, fields: keys.filter((k) => k !== 'password_hash'), password_reset: Boolean(b.password) } });
  }
  if (patch.active === 0 || patch.password_hash) revokeSessions(id);
  if (patch.active === 0) {
    q.run("UPDATE users SET presence = 'offline' WHERE id = ?", id);
    handleAgentOffline(id);
  }
  broadcast('users', {});
  res.json({ ok: true });
});

// ---------- Settings
admin.get('/settings', requirePerm('settings.manage'), (req, res) => {
  res.json({
    settings: getSettings(),
    webhook: { url: `${config.publicUrl}/webhooks/meta`, verifyTokenSet: Boolean(config.meta.verifyToken), appSecretSet: Boolean(config.meta.appSecret) },
    aiConfigured: Boolean(config.ai.apiKey),
    aiModel: config.ai.model,
  });
});

const NUMBER_KEYS = ['sla_target_min', 'sla_warning_min', 'reassign_window_min', 'max_auto_reassign', 'escalate_supervisor_min',
  'escalate_manager_min', 'comment_sla_min', 'follow_up_escalate_min', 'presence_timeout_min', 'night_ai_max_replies'];

admin.put('/settings', requirePerm('settings.manage'), (req, res) => {
  const patch = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULTS)) continue;
    const def = DEFAULTS[k];
    if (NUMBER_KEYS.includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 10000) throw badRequest(`Invalid value for ${k}`);
      patch[k] = n;
    } else if (typeof def === 'boolean') patch[k] = Boolean(v);
    else if (Array.isArray(def)) {
      if (!Array.isArray(v)) throw badRequest(`${k} must be a list`);
      patch[k] = v.map((x) => String(x).trim()).filter(Boolean);
    } else patch[k] = String(v);
  }
  for (const k of ['business_start', 'business_end']) {
    if (k in patch && !/^([01]\d|2[0-4]):[0-5]\d$/.test(patch[k])) throw badRequest(`${k} must be HH:MM`);
  }
  if ('night_mode' in patch && !['ai', 'message', 'off'].includes(patch.night_mode)) throw badRequest('Invalid night mode');
  const merged = { ...getSettings(), ...patch };
  if (merged.sla_warning_min >= merged.sla_target_min) throw badRequest('Warning must come before the SLA target');
  updateSettings(patch);
  audit({ userId: req.user.id, type: 'settings_changed', data: patch });
  broadcast('settings', {});
  res.json({ settings: getSettings() });
});

// ---------- Channels (admin only: they hold access tokens)
admin.get('/channels', requirePerm('channels.manage'), (req, res) => {
  const items = q.all('SELECT id, kind, name, external_id, page_id, waba_id, active, created_at, access_token_enc IS NOT NULL AS has_token FROM channels ORDER BY kind, name');
  res.json({ items });
});

admin.post('/channels', requirePerm('channels.manage'), (req, res) => {
  const { kind, name, external_id, page_id, waba_id, access_token } = req.body || {};
  if (!['messenger', 'instagram', 'whatsapp'].includes(kind)) throw badRequest('Invalid channel type');
  if (!String(name || '').trim() || !String(external_id || '').trim()) throw badRequest('Name and ID are required');
  if (kind === 'instagram' && !page_id) throw badRequest('Instagram needs the linked Facebook Page ID');
  if (kind === 'whatsapp' && q.get("SELECT 1 FROM channels WHERE kind = 'whatsapp' AND active = 1")) {
    throw badRequest('Only one WhatsApp number is supported. Disable the current one first.');
  }
  if (q.get('SELECT 1 FROM channels WHERE kind = ? AND external_id = ?', kind, String(external_id).trim())) throw badRequest('Channel already exists');
  const { id } = q.run(
    'INSERT INTO channels (kind, name, external_id, page_id, waba_id, access_token_enc, created_at) VALUES (?,?,?,?,?,?,?)',
    kind, String(name).trim(), String(external_id).trim(), page_id || null, waba_id || null, access_token ? encrypt(String(access_token).trim()) : null, Date.now(),
  );
  audit({ userId: req.user.id, type: 'channel_created', data: { id, kind, name } });
  res.json({ id });
});

admin.patch('/channels/:id', requirePerm('channels.manage'), (req, res) => {
  const id = int(req.params.id);
  if (!q.get('SELECT 1 FROM channels WHERE id = ?', id)) throw notFound();
  const b = req.body || {};
  if ('name' in b) q.run('UPDATE channels SET name = ? WHERE id = ?', String(b.name).trim(), id);
  if ('active' in b) q.run('UPDATE channels SET active = ? WHERE id = ?', b.active ? 1 : 0, id);
  if ('page_id' in b) q.run('UPDATE channels SET page_id = ? WHERE id = ?', b.page_id || null, id);
  if ('waba_id' in b) q.run('UPDATE channels SET waba_id = ? WHERE id = ?', b.waba_id || null, id);
  if (b.access_token) q.run('UPDATE channels SET access_token_enc = ? WHERE id = ?', encrypt(String(b.access_token).trim()), id);
  audit({ userId: req.user.id, type: 'channel_updated', data: { id, fields: Object.keys(b).filter((k) => k !== 'access_token'), token_changed: Boolean(b.access_token) } });
  res.json({ ok: true });
});

admin.post('/channels/:id/test', requirePerm('channels.manage'), async (req, res) => {
  const channel = q.get('SELECT * FROM channels WHERE id = ?', int(req.params.id));
  if (!channel) throw notFound();
  res.json({ ok: true, info: await checkChannel(channel) });
});

admin.post('/channels/:id/subscribe', requirePerm('channels.manage'), async (req, res) => {
  const channel = q.get('SELECT * FROM channels WHERE id = ?', int(req.params.id));
  if (!channel) throw notFound();
  const result = channel.kind === 'whatsapp' ? await subscribeWaba(channel) : await subscribePage(channel);
  audit({ userId: req.user.id, type: 'channel_subscribed', data: { id: channel.id } });
  res.json({ ok: true, result });
});

// ---------- Lead stages & lost reasons (configurable without code changes)
admin.put('/stages', requirePerm('settings.manage'), (req, res) => {
  const list = req.body?.stages;
  if (!Array.isArray(list) || !list.length) throw badRequest('Stages are required');
  for (const [i, s] of list.entries()) {
    const key = String(s.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key || !s.name_en || !s.name_ar) throw badRequest('Each stage needs a key and names');
    if (!['open', 'won', 'lost', 'invalid'].includes(s.kind)) throw badRequest('Invalid stage kind');
    q.run(
      `INSERT INTO lead_stages (key, name_en, name_ar, position, kind, requires_phone, requires_follow_up, is_qualified, active)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET name_en = excluded.name_en, name_ar = excluded.name_ar, position = excluded.position,
         kind = excluded.kind, requires_phone = excluded.requires_phone, requires_follow_up = excluded.requires_follow_up,
         is_qualified = excluded.is_qualified, active = excluded.active`,
      key, String(s.name_en), String(s.name_ar), i + 1, s.kind, s.requires_phone ? 1 : 0, s.requires_follow_up ? 1 : 0,
      s.is_qualified ? 1 : 0, s.active === false ? 0 : 1,
    );
  }
  for (const kind of ['won', 'lost']) {
    if (!q.get('SELECT 1 FROM lead_stages WHERE kind = ? AND active = 1', kind)) throw badRequest(`At least one active "${kind}" stage is required`);
  }
  audit({ userId: req.user.id, type: 'stages_changed', data: { count: list.length } });
  broadcast('settings', {});
  res.json({ stages: q.all('SELECT * FROM lead_stages ORDER BY position') });
});

admin.get('/stages', requirePerm('settings.manage'), (req, res) => {
  res.json({ stages: q.all('SELECT * FROM lead_stages ORDER BY position'), lostReasons: q.all('SELECT * FROM lost_reasons ORDER BY position') });
});

admin.put('/lost-reasons', requirePerm('settings.manage'), (req, res) => {
  const list = req.body?.reasons;
  if (!Array.isArray(list)) throw badRequest('Reasons are required');
  for (const [i, r] of list.entries()) {
    const key = String(r.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key || !r.name_en || !r.name_ar) throw badRequest('Each reason needs a key and names');
    q.run(
      `INSERT INTO lost_reasons (key, name_en, name_ar, position, active) VALUES (?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET name_en = excluded.name_en, name_ar = excluded.name_ar, position = excluded.position, active = excluded.active`,
      key, String(r.name_en), String(r.name_ar), i + 1, r.active === false ? 0 : 1,
    );
  }
  audit({ userId: req.user.id, type: 'lost_reasons_changed', data: { count: list.length } });
  broadcast('settings', {});
  res.json({ ok: true });
});

// ---------- Saved replies
admin.post('/templates', requirePerm('templates.manage'), (req, res) => {
  const { title, body, shortcut } = req.body || {};
  if (!String(title || '').trim() || !String(body || '').trim()) throw badRequest('Title and text are required');
  const { id } = q.run('INSERT INTO templates (title, body, shortcut, created_by, created_at) VALUES (?,?,?,?,?)',
    String(title).trim(), String(body), shortcut ? String(shortcut).trim() : null, req.user.id, Date.now());
  broadcast('settings', {});
  res.json({ id });
});

admin.patch('/templates/:id', requirePerm('templates.manage'), (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  q.run(
    'UPDATE templates SET title = COALESCE(?, title), body = COALESCE(?, body), shortcut = COALESCE(?, shortcut), active = COALESCE(?, active) WHERE id = ?',
    b.title ?? null, b.body ?? null, b.shortcut ?? null, 'active' in b ? (b.active ? 1 : 0) : null, id,
  );
  broadcast('settings', {});
  res.json({ ok: true });
});

// ---------- Audit log
admin.get('/audit', requirePerm('audit.view'), (req, res) => {
  const before = Number(req.query.before) || Date.now() + 1;
  const items = q.all(
    `SELECT e.*, u.name AS user_name FROM events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.at < ? ${req.query.user ? 'AND e.user_id = ?' : ''} ORDER BY e.at DESC, e.id DESC LIMIT 200`,
    before, ...(req.query.user ? [Number(req.query.user)] : []),
  );
  res.json({ items });
});
