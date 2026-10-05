import express from 'express';
import { config } from '../config.js';
import { q } from '../db.js';
import { verifyMetaSignature } from '../security.js';
import { ingestInbound, ingestEcho, ingestComment, ingestDeliveryStatus } from '../services/ingest.js';

export const webhooks = express.Router();

// Meta calls this once when you save the callback URL in the app dashboard.
webhooks.get('/meta', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && config.meta.verifyToken && token === config.meta.verifyToken) {
    return res.status(200).send(String(challenge));
  }
  res.sendStatus(403);
});

webhooks.post('/meta', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
  if (config.meta.appSecret) {
    if (!verifyMetaSignature(raw, req.get('x-hub-signature-256'), config.meta.appSecret)) return res.sendStatus(401);
  } else if (config.isProduction) {
    return res.sendStatus(503); // never accept unsigned webhooks in production
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }
  // Acknowledge immediately; Meta retries if we are slow. Duplicates are dropped by message id.
  res.sendStatus(200);
  setImmediate(() => processPayload(payload));
});

function log(payload, error = null) {
  q.run('INSERT INTO webhook_log (object, received_at, payload, error) VALUES (?,?,?,?)',
    payload?.object || null, Date.now(), JSON.stringify(payload).slice(0, 20000), error);
}

export function processPayload(payload) {
  try {
    if (payload.object === 'page') handlePage(payload);
    else if (payload.object === 'instagram') handleInstagram(payload);
    else if (payload.object === 'whatsapp_business_account') handleWhatsApp(payload);
    log(payload);
  } catch (err) {
    console.error('[webhook] processing failed', err);
    log(payload, String(err.stack || err.message).slice(0, 2000));
  }
}

const channelBy = (kind, externalId) =>
  q.get('SELECT * FROM channels WHERE kind = ? AND external_id = ? AND active = 1', kind, String(externalId));

function pageAttachments(list = []) {
  return list
    .filter((a) => a.payload?.url)
    .map((a) => ({ type: a.type === 'file' ? 'file' : a.type, url: a.payload.url }));
}

// An ad click can arrive as its own event just before the customer's first message.
// Keep it briefly and attach it to that message so the chat is attributed to the ad.
const pendingReferrals = new Map(); // `${channelId}:${senderId}` -> { referral, at }

function takeReferral(channel, senderId) {
  const key = `${channel.id}:${senderId}`;
  const hit = pendingReferrals.get(key);
  pendingReferrals.delete(key);
  return hit && Date.now() - hit.at < 30 * 60000 ? hit.referral : null;
}

function handleMessaging(channel, events) {
  for (const ev of events || []) {
    const msg = ev.message;
    if (!msg) {
      if (ev.referral && ev.sender?.id) {
        pendingReferrals.set(`${channel.id}:${ev.sender.id}`, { referral: ev.referral, at: Date.now() });
      }
      continue;
    }
    if (msg.is_deleted) continue;
    const message = {
      externalId: msg.mid,
      text: msg.text || (msg.quick_reply?.payload ?? ''),
      attachments: pageAttachments(msg.attachments),
      timestamp: ev.timestamp,
      referral: msg.referral || ev.referral || (msg.is_echo ? null : takeReferral(channel, ev.sender.id)),
      appId: msg.app_id,
    };
    if (msg.is_echo) ingestEcho({ channel, recipientId: ev.recipient.id, message });
    else ingestInbound({ channel, externalUserId: ev.sender.id, message });
  }
}

function handlePage(payload) {
  for (const entry of payload.entry || []) {
    const channel = channelBy('messenger', entry.id);
    if (!channel) continue;
    handleMessaging(channel, entry.messaging);
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add') continue;
      if (v.from?.id === entry.id) continue; // our own page replying
      ingestComment({
        channel, platform: 'facebook',
        comment: {
          externalId: v.comment_id, postId: v.post_id, postLink: v.post?.permalink_url || null, parentId: v.parent_id !== v.post_id ? v.parent_id : null,
          authorId: v.from?.id, authorName: v.from?.name, text: v.message, createdAt: v.created_time ? v.created_time * 1000 : Date.now(),
        },
      });
    }
  }
}

function handleInstagram(payload) {
  for (const entry of payload.entry || []) {
    const channel = channelBy('instagram', entry.id);
    if (!channel) continue;
    handleMessaging(channel, entry.messaging);
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field !== 'comments') continue;
      if (v.from?.id === entry.id) continue;
      ingestComment({
        channel, platform: 'instagram',
        comment: {
          externalId: v.id, postId: v.media?.id, parentId: v.parent_id || null,
          authorId: v.from?.id, authorName: v.from?.username, text: v.text, createdAt: Date.now(),
        },
      });
    }
  }
}

function waAttachments(m) {
  const media = m[m.type];
  if (!media?.id) return [];
  const type = m.type === 'document' ? 'file' : m.type === 'sticker' ? 'image' : m.type;
  return [{ type, mediaId: media.id, mime: media.mime_type, filename: media.filename }];
}

function waText(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'image': case 'video': case 'document': return m[m.type]?.caption || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    case 'location': return `📍 ${m.location?.name || ''} https://maps.google.com/?q=${m.location?.latitude},${m.location?.longitude}`;
    case 'contacts': return `👤 ${(m.contacts || []).map((c) => `${c.name?.formatted_name} ${c.phones?.[0]?.phone || ''}`).join(', ')}`;
    case 'reaction': return m.reaction?.emoji || '';
    default: return '';
  }
}

function handleWhatsApp(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const channel = channelBy('whatsapp', v.metadata?.phone_number_id);
      if (!channel) continue;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        if (m.type === 'unsupported' || m.type === 'system') continue;
        ingestInbound({
          channel,
          externalUserId: m.from,
          phone: m.from,
          profile: { name: names[m.from] || null },
          message: {
            externalId: m.id,
            text: waText(m),
            attachments: waAttachments(m),
            timestamp: Number(m.timestamp) * 1000,
            referral: m.referral || null,
          },
        });
      }
      for (const st of v.statuses || []) {
        ingestDeliveryStatus({
          channelKind: 'whatsapp', externalId: st.id, status: st.status,
          error: st.errors?.map((e) => e.title || e.message).join('; '),
        });
      }
    }
  }
}
