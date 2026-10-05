import express from 'express';
import { config } from '../config.js';
import { q } from '../db.js';
import { HttpError, badRequest } from '../http.js';
import { requirePerm } from '../auth.js';
import { randomToken } from '../security.js';
import { ingestComment, ingestInbound } from '../services/ingest.js';

// Lets the team train and test the whole flow (routing, SLA, stages, analytics) before
// Meta approves the app. Simulated customers never trigger real API calls.
export const simulator = express.Router();

simulator.use('/sim', (req, res, next) => {
  if (!config.simulatorEnabled) return next(new HttpError(404, 'Simulator is disabled'));
  next();
}, requirePerm('simulator'));

function demoChannel(kind) {
  const existing = q.get('SELECT * FROM channels WHERE kind = ? AND external_id = ?', kind, `demo-${kind}`);
  if (existing) return existing;
  const names = { messenger: 'Demo Facebook Page', instagram: 'Demo Instagram', whatsapp: 'Demo WhatsApp' };
  const { id } = q.run(
    'INSERT INTO channels (kind, name, external_id, page_id, created_at) VALUES (?,?,?,?,?)',
    kind, names[kind], `demo-${kind}`, kind === 'instagram' ? 'demo-page' : null, Date.now(),
  );
  return q.get('SELECT * FROM channels WHERE id = ?', id);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').slice(0, 40);

simulator.post('/sim/inbound', (req, res) => {
  const { kind = 'whatsapp', name, text, phone, ad } = req.body || {};
  if (!['messenger', 'instagram', 'whatsapp'].includes(kind)) throw badRequest('Invalid channel');
  if (!String(name || '').trim() || !String(text || '').trim()) throw badRequest('Name and message are required');
  const channel = demoChannel(kind);
  const externalUserId = kind === 'whatsapp' && phone ? String(phone).replace(/\D/g, '') : `sim-${slug(name)}`;
  const result = ingestInbound({
    channel,
    externalUserId,
    phone: kind === 'whatsapp' ? phone || null : null,
    profile: { name: String(name).trim() },
    simulated: true,
    message: {
      externalId: `sim-${randomToken(9)}`,
      text: String(text),
      timestamp: Date.now(),
      referral: ad ? { source: 'ADS', type: 'OPEN_THREAD', ad_id: String(ad), source_url: kind === 'instagram' ? 'https://instagram.com' : 'https://facebook.com' } : null,
    },
  });
  res.json(result);
});

simulator.post('/sim/comment', (req, res) => {
  const { platform = 'facebook', name, text } = req.body || {};
  if (!String(name || '').trim() || !String(text || '').trim()) throw badRequest('Name and comment are required');
  const channel = demoChannel(platform === 'instagram' ? 'instagram' : 'messenger');
  const id = ingestComment({
    channel,
    platform: platform === 'instagram' ? 'instagram' : 'facebook',
    comment: {
      externalId: `sim-${randomToken(9)}`, postId: 'demo-post-summer-offer', postLink: null,
      authorId: `sim-${slug(name)}`, authorName: String(name).trim(), text: String(text), createdAt: Date.now(),
    },
  });
  res.json({ id });
});
