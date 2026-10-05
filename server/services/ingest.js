import { config } from '../config.js';
import { q, tx, audit } from '../db.js';
import { normalizePhone, preview } from '../http.js';
import { getSettings } from '../settings.js';
import { isBusinessTime } from './hours.js';
import { autoAssign } from './assignment.js';
import { startAwaiting, recordResponse } from './sla.js';
import { broadcast } from './realtime.js';
import { fetchProfile } from './meta.js';
import { aiAvailable, classify, nightReply } from './ai.js';
import { sendToCustomer } from './outbound.js';

// Every channel is converted to this normalised shape before it touches the database:
//   channel        row from `channels`
//   externalUserId PSID / IGSID / WhatsApp number
//   profile        { name, username, avatar }
//   message        { externalId, text, attachments: [{type,url?,mediaId?,mime?,filename?}], timestamp, referral }

function defaultSource(channel, referral) {
  if (referral) {
    const url = String(referral.source_url || '');
    if (channel.kind === 'instagram' || /instagram/i.test(url)) return 'instagram_ad';
    return 'facebook_ad';
  }
  return { messenger: 'messenger', instagram: 'instagram_dm', whatsapp: 'whatsapp' }[channel.kind];
}

function findOrCreateIdentity({ channel, externalUserId, profile, phone, simulated, now }) {
  const existing = q.get('SELECT * FROM customer_identities WHERE channel_id = ? AND external_id = ?', channel.id, externalUserId);
  if (existing) return { identity: existing, created: false };

  let customer = null;
  const normalized = normalizePhone(phone);
  if (normalized) {
    // Exact phone match only - anything fuzzier is left to a human merge.
    customer = q.get('SELECT * FROM customers WHERE phone = ? ORDER BY id LIMIT 1', normalized);
  }
  if (!customer) {
    const { id } = q.run(
      'INSERT INTO customers (name, phone, avatar_url, is_simulated, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      profile.name || (normalized ? `+${normalized}` : null), normalized, profile.avatar || null, simulated ? 1 : 0, now, now,
    );
    customer = { id };
  } else {
    audit({ type: 'customer_matched_by_phone', data: { customer_id: customer.id, channel: channel.kind }, at: now });
  }
  const { id } = q.run(
    `INSERT INTO customer_identities (customer_id, channel_id, channel_kind, external_id, display_name, username, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    customer.id, channel.id, channel.kind, externalUserId, profile.name || null, profile.username || null, now,
  );
  return { identity: q.get('SELECT * FROM customer_identities WHERE id = ?', id), created: true };
}

export function ingestInbound({ channel, externalUserId, profile = {}, message, phone = null, simulated = false }) {
  const now = Date.now();
  const ts = Math.min(message.timestamp || now, now);

  const result = tx(() => {
    if (message.externalId && q.get('SELECT 1 FROM messages WHERE channel_kind = ? AND external_id = ?', channel.kind, message.externalId)) {
      return null; // duplicate webhook delivery
    }
    const { identity, created: newIdentity } = findOrCreateIdentity({ channel, externalUserId, profile, phone, simulated, now });

    let conv = q.get('SELECT * FROM conversations WHERE identity_id = ? ORDER BY id DESC LIMIT 1', identity.id);
    let isNew = false;
    if (!conv) {
      const { id } = q.run(
        `INSERT INTO conversations (customer_id, identity_id, channel_id, channel_kind, status, source, ad_id, ad_ref_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        identity.customer_id, identity.id, channel.id, channel.kind, 'needs_reply', defaultSource(channel, message.referral),
        message.referral?.ad_id || message.referral?.source_id || null,
        message.referral ? JSON.stringify(message.referral) : null, ts,
      );
      conv = q.get('SELECT * FROM conversations WHERE id = ?', id);
      isNew = true;
      audit({ conversationId: id, type: 'conversation_created', data: { channel: channel.kind, source: conv.source }, at: ts });
    } else if (conv.status === 'closed') {
      audit({ conversationId: conv.id, type: 'reopened', data: { by: 'customer_message' }, at: ts });
    }

    if (message.referral && !conv.ad_id) {
      q.run(
        'UPDATE conversations SET source = ?, ad_id = ?, ad_ref_json = ? WHERE id = ?',
        defaultSource(channel, message.referral), message.referral.ad_id || message.referral.source_id || null,
        JSON.stringify(message.referral), conv.id,
      );
      audit({ conversationId: conv.id, type: 'ad_referral', data: message.referral, at: ts });
    }

    const attachments = message.attachments?.length ? message.attachments : null;
    const body = message.text || '';
    q.run(
      `INSERT INTO messages (conversation_id, direction, sender_type, channel_kind, external_id, body, attachments_json, delivery_status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      conv.id, 'in', 'customer', channel.kind, message.externalId || null, body,
      attachments ? JSON.stringify(attachments) : null, 'received', ts,
    );
    const shown = body || (attachments ? `[${attachments.map((a) => a.type).join(', ')}]` : '');
    q.run(
      `UPDATE conversations SET last_message_at = ?, last_inbound_at = ?, last_message_preview = ?,
         unread_count = unread_count + 1, status = 'needs_reply', snooze_until = NULL, closed_at = NULL
       WHERE id = ?`,
      ts, ts, preview(shown), conv.id,
    );
    startAwaiting(conv, ts);
    return { conversationId: conv.id, isNew, newIdentity, identityId: identity.id };
  });

  if (!result) return null;
  afterInbound(result, { channel, externalUserId, profile, simulated });
  return result;
}

function afterInbound({ conversationId, isNew, newIdentity, identityId }, { channel, externalUserId, profile, simulated }) {
  broadcast('message', { conversation_id: conversationId });
  broadcast('conversation', { id: conversationId, new: isNew });

  if (isBusinessTime()) {
    autoAssign(conversationId);
  } else {
    scheduleNightReply(conversationId);
  }

  if (newIdentity && !simulated && !profile.name && channel.kind !== 'whatsapp') {
    fetchProfile(channel, externalUserId)
      .then((p) => {
        q.run('UPDATE customer_identities SET display_name = ?, username = ? WHERE id = ?', p.name, p.username, identityId);
        q.run(
          'UPDATE customers SET name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = (SELECT customer_id FROM customer_identities WHERE id = ?)',
          p.name, p.avatar, Date.now(), identityId,
        );
        broadcast('conversation', { id: conversationId });
      })
      .catch((err) => console.warn('[ingest] profile lookup failed:', err.message));
  }

  if (isNew && aiAvailable() && getSettings().ai_auto_classify) {
    // Give the customer a moment to finish their first burst of messages.
    setTimeout(() => {
      classify(conversationId)
        .then((r) => applyClassification(conversationId, r))
        .catch((err) => console.warn('[ai] classify failed:', err.message));
    }, 30000).unref();
  }
}

/** Use the AI classification to fill blanks only - it never overwrites what a human set. */
export function applyClassification(conversationId, r) {
  const conv = q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv) return;
  if (conv.type === 'unknown') q.run('UPDATE conversations SET type = ? WHERE id = ?', r.conversation_type, conversationId);
  if (r.urgency === 'high' || r.sentiment === 'angry') {
    q.run("UPDATE conversations SET priority = CASE WHEN priority = 'normal' THEN 'high' ELSE priority END WHERE id = ?", conversationId);
  }
  const phone = normalizePhone(r.phone);
  if (phone) q.run('UPDATE customers SET phone = COALESCE(phone, ?), updated_at = ? WHERE id = ?', phone, Date.now(), conv.customer_id);
  broadcast('conversation', { id: conversationId });
}

const nightTimers = new Map();

function scheduleNightReply(conversationId) {
  const s = getSettings();
  if (s.night_mode === 'off') return;
  clearTimeout(nightTimers.get(conversationId));
  // Debounce: customers often send several messages in a row.
  const t = setTimeout(() => {
    nightTimers.delete(conversationId);
    sendNightReply(conversationId).catch((err) => console.warn('[night] reply failed:', err.message));
  }, config.isProduction ? 20000 : 3000);
  t.unref();
  nightTimers.set(conversationId, t);
}

async function sendNightReply(conversationId) {
  const s = getSettings();
  const conv = q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv || isBusinessTime() || !conv.awaiting_since) return;
  if (conv.night_ai_replies >= s.night_ai_max_replies) return;

  let text = null;
  let senderType = 'auto';
  if (s.night_mode === 'ai' && aiAvailable()) {
    text = await nightReply(conversationId).catch((err) => {
      console.warn('[night] AI failed, using fixed message:', err.message);
      return null;
    });
    if (text) senderType = 'ai';
  }
  if (!text) {
    if (conv.night_ai_replies > 0) return; // the fixed message is sent once per night
    text = s.night_message;
  }
  q.run('UPDATE conversations SET night_ai_replies = night_ai_replies + 1 WHERE id = ?', conversationId);
  await sendToCustomer(conversationId, { text, senderType });
}

/** A reply made directly in Meta Business Suite / the WhatsApp app: logged, and counts as a response. */
export function ingestEcho({ channel, recipientId, message }) {
  if (message.appId && config.meta.appId && String(message.appId) === String(config.meta.appId)) return; // sent by us
  if (message.externalId && q.get('SELECT 1 FROM messages WHERE channel_kind = ? AND external_id = ?', channel.kind, message.externalId)) return;
  const identity = q.get('SELECT * FROM customer_identities WHERE channel_id = ? AND external_id = ?', channel.id, recipientId);
  if (!identity) return;
  const conv = q.get('SELECT * FROM conversations WHERE identity_id = ? ORDER BY id DESC LIMIT 1', identity.id);
  if (!conv) return;
  // Our own send may still be waiting for its id; skip an echo that matches a pending message.
  const pending = q.get(
    "SELECT 1 FROM messages WHERE conversation_id = ? AND direction = 'out' AND delivery_status = 'pending' AND body = ? AND created_at > ?",
    conv.id, message.text || '', Date.now() - 60000,
  );
  if (pending) return;
  const ts = Math.min(message.timestamp || Date.now(), Date.now());
  tx(() => {
    q.run(
      `INSERT INTO messages (conversation_id, direction, sender_type, channel_kind, external_id, body, attachments_json, delivery_status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      conv.id, 'out', 'external', channel.kind, message.externalId, message.text || '',
      message.attachments?.length ? JSON.stringify(message.attachments) : null, 'sent', ts,
    );
    q.run('UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?', ts, preview(message.text || '[attachment]'), conv.id);
    recordResponse(conv.id, null, ts);
    audit({ conversationId: conv.id, type: 'replied_outside_system', at: ts });
  });
  broadcast('message', { conversation_id: conv.id });
  broadcast('conversation', { id: conv.id });
}

export function ingestDeliveryStatus({ channelKind, externalId, status, error }) {
  const order = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const row = q.get('SELECT id, conversation_id, delivery_status FROM messages WHERE channel_kind = ? AND external_id = ?', channelKind, externalId);
  if (!row || !(status in order)) return;
  if (status !== 'failed' && order[status] <= order[row.delivery_status]) return;
  q.run('UPDATE messages SET delivery_status = ?, error = ? WHERE id = ?', status, error || null, row.id);
  broadcast('message', { conversation_id: row.conversation_id });
}

export function ingestComment({ channel, platform, comment }) {
  const r = q.run(
    `INSERT OR IGNORE INTO comments (channel_id, platform, external_id, post_id, post_link, parent_external_id,
       author_external_id, author_name, body, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    channel.id, platform, comment.externalId, comment.postId || null, comment.postLink || null, comment.parentId || null,
    comment.authorId || null, comment.authorName || null, comment.text || '', Math.min(comment.createdAt || Date.now(), Date.now()),
  );
  if (r.changes) broadcast('comment', { id: r.id });
  return r.changes ? r.id : null;
}
