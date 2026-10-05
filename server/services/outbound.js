import { q, tx } from '../db.js';
import { HttpError, badRequest, preview } from '../http.js';
import { getSettings } from '../settings.js';
import { sendPageMessage, sendWhatsApp } from './meta.js';
import { recordResponse } from './sla.js';
import { broadcast } from './realtime.js';

const DAY = 24 * 3600 * 1000;

/** Meta only allows free-form replies within 24h of the customer's last message. */
export function messagingWindow(conv, now = Date.now()) {
  if (!conv.last_inbound_at) return { open: false, closesAt: null };
  const closesAt = conv.last_inbound_at + DAY;
  return { open: now < closesAt, closesAt };
}

function storeExternalId(messageId, externalId, status, error) {
  try {
    q.run('UPDATE messages SET external_id = ?, delivery_status = ?, error = ? WHERE id = ?', externalId, status, error, messageId);
  } catch (err) {
    // The echo webhook beat us to it and stored the same platform id as an "external" message: keep ours.
    if (!/UNIQUE/i.test(err.message)) throw err;
    const row = q.get('SELECT channel_kind FROM messages WHERE id = ?', messageId);
    q.run('DELETE FROM messages WHERE channel_kind = ? AND external_id = ? AND id <> ?', row.channel_kind, externalId, messageId);
    q.run('UPDATE messages SET external_id = ?, delivery_status = ?, error = ? WHERE id = ?', externalId, status, error, messageId);
  }
}

/**
 * Send a message to the customer of a conversation.
 * senderType: 'agent' (a human - stops the SLA clock), 'ai' / 'auto' (after-hours, does not).
 */
export async function sendToCustomer(conversationId, { text, attachment, template, senderType = 'agent', userId = null }) {
  const conv = q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
  if (!conv) throw new HttpError(404, 'Conversation not found');
  const channel = q.get('SELECT * FROM channels WHERE id = ?', conv.channel_id);
  const identity = q.get('SELECT * FROM customer_identities WHERE id = ?', conv.identity_id);
  const customer = q.get('SELECT * FROM customers WHERE id = ?', conv.customer_id);
  const now = Date.now();

  if (!text && !attachment && !template) throw badRequest('Message is empty');
  if (text && text.length > 4000) throw badRequest('Message is too long (4000 characters max)');
  if (template && conv.channel_kind !== 'whatsapp') throw badRequest('Templates are only for WhatsApp');

  let tag = null;
  const win = messagingWindow(conv, now);
  if (!template && !win.open) {
    if (conv.channel_kind === 'whatsapp') {
      throw new HttpError(409, 'The 24-hour window is closed. WhatsApp only allows an approved template now.', 'window_closed');
    }
    const within7Days = conv.last_inbound_at && now - conv.last_inbound_at < 7 * DAY;
    if (getSettings().messenger_human_agent_tag && within7Days && senderType === 'agent') {
      tag = 'HUMAN_AGENT';
    } else {
      throw new HttpError(409, 'The 24-hour window is closed. Meta does not allow messaging this customer until they write again.', 'window_closed');
    }
  }

  const body = text || (template ? `[Template: ${template.name}]` : attachment?.caption || '');
  const attachments = attachment ? [{ type: attachment.mime?.split('/')[0] || 'file', url: attachment.url, mime: attachment.mime, filename: attachment.filename }] : null;
  const { id: messageId } = q.run(
    `INSERT INTO messages (conversation_id, direction, sender_type, user_id, channel_kind, body, attachments_json, delivery_status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    conversationId, 'out', senderType, userId, conv.channel_kind, body, attachments ? JSON.stringify(attachments) : null, 'pending', now,
  );
  broadcast('message', { conversation_id: conversationId });

  let externalId = null;
  let error = null;
  try {
    if (customer.is_simulated) {
      externalId = `sim-out-${messageId}`;
    } else if (conv.channel_kind === 'whatsapp') {
      externalId = await sendWhatsApp(channel, identity.external_id, { text, attachment, template });
    } else {
      externalId = await sendPageMessage(channel, { id: identity.external_id }, { text, attachment, tag });
      if (attachment?.caption) {
        await sendPageMessage(channel, { id: identity.external_id }, { text: attachment.caption, tag });
      }
    }
  } catch (err) {
    error = err.message || 'Send failed';
  }

  tx(() => {
    storeExternalId(messageId, externalId, error ? 'failed' : 'sent', error);
    if (!error) {
      q.run('UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?', now, preview(body), conversationId);
      if (senderType === 'agent') recordResponse(conversationId, userId, now);
    }
  });
  broadcast('message', { conversation_id: conversationId });
  broadcast('conversation', { id: conversationId });
  if (error) throw new HttpError(502, `Not delivered: ${error}`, 'send_failed');
  return q.get('SELECT * FROM messages WHERE id = ?', messageId);
}
