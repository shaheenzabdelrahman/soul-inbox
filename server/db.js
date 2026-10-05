import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || path.join(config.dataDir, 'soul-inbox.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// node:sqlite rejects undefined and booleans; normalise parameters once here.
function norm(params) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

function plain(row) {
  return row ? { ...row } : row;
}

export const q = {
  get: (sql, ...params) => plain(stmt(sql).get(...norm(params))),
  all: (sql, ...params) => stmt(sql).all(...norm(params)).map(plain),
  run: (sql, ...params) => {
    const r = stmt(sql).run(...norm(params));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
};

let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export function audit({ conversationId = null, leadId = null, userId = null, type, data = null, at = Date.now() }) {
  q.run(
    'INSERT INTO events (conversation_id, lead_id, user_id, type, data_json, at) VALUES (?,?,?,?,?,?)',
    conversationId, leadId, userId, type, data ? JSON.stringify(data) : null, at,
  );
}
