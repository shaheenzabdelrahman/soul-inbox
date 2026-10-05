import { q } from '../db.js';

// Server-Sent Events: one stream per open browser tab.
const clients = new Map(); // userId -> Set<res>
const viewing = new Map(); // userId -> { conversationId, at }

export function addClient(user, res) {
  if (!clients.has(user.id)) clients.set(user.id, new Set());
  clients.get(user.id).add(res);
  res.on('close', () => {
    const set = clients.get(user.id);
    set?.delete(res);
    if (set && set.size === 0) clients.delete(user.id);
  });
}

function write(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Send to every connected user, or only to the ids in `userIds`. */
export function broadcast(type, data, userIds = null) {
  for (const [uid, set] of clients) {
    if (userIds && !userIds.includes(uid)) continue;
    for (const res of set) write(res, type, data);
  }
}

export function isConnected(userId) {
  return clients.has(userId);
}

setInterval(() => {
  for (const set of clients.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();

// "Who is looking at this chat" - shown in the UI so two agents don't answer the same customer.
export function setViewing(userId, conversationId) {
  if (conversationId) viewing.set(userId, { conversationId: Number(conversationId), at: Date.now() });
  else viewing.delete(userId);
  broadcast('viewers', viewersSnapshot());
}

export function viewersSnapshot() {
  const out = {};
  const cutoff = Date.now() - 90000;
  for (const [uid, v] of viewing) {
    if (v.at < cutoff) continue;
    (out[v.conversationId] ||= []).push(uid);
  }
  return out;
}

export function notify(userIds, { kind, title, body = null, conversationId = null }) {
  const now = Date.now();
  for (const uid of new Set(userIds.filter(Boolean))) {
    const { id } = q.run(
      'INSERT INTO notifications (user_id, kind, title, body, conversation_id, created_at) VALUES (?,?,?,?,?,?)',
      uid, kind, title, body, conversationId, now,
    );
    broadcast('notification', { id, kind, title, body, conversation_id: conversationId, created_at: now }, [uid]);
  }
}

export function usersWithRoles(roles) {
  return q.all(
    `SELECT id FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')})`,
    ...roles,
  ).map((u) => u.id);
}
