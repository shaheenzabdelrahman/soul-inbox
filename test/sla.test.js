import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-inbox-test-'));
process.env.DB_FILE = path.join(dir, 'test.db');
process.env.DATA_DIR = dir;

const { q } = await import('../server/db.js');
const { bootstrap } = await import('../server/bootstrap.js');
const { updateSettings } = await import('../server/settings.js');
const { isBusinessTime, nextBusinessStart } = await import('../server/services/hours.js');
const { ingestInbound } = await import('../server/services/ingest.js');
const { tick } = await import('../server/services/sla.js');
const { hashPassword } = await import('../server/security.js');

bootstrap();
const MIN = 60000;

function agent(name) {
  return q.run(
    "INSERT INTO users (name, email, password_hash, role, presence, last_seen_at, created_at) VALUES (?,?,?,'agent','online',?,?)",
    name, `${name}@t.local`, hashPassword('x'.repeat(12)), Date.now(), Date.now(),
  ).id;
}
const keepOnline = (at) => q.run("UPDATE users SET last_seen_at = ? WHERE role = 'agent'", at);

test('business hours: night messages start the SLA clock at opening time', () => {
  updateSettings({ business_start: '10:00', business_end: '24:00' });
  // December: Cairo is UTC+2. 01:00Z = 03:00 Cairo (night), 10:00Z = 12:00 Cairo (day).
  const night = Date.parse('2026-12-01T01:00:00Z');
  assert.equal(isBusinessTime(night), false);
  assert.equal(isBusinessTime(Date.parse('2026-12-01T10:00:00Z')), true);
  assert.equal(isBusinessTime(Date.parse('2026-12-01T21:30:00Z')), true); // 23:30 Cairo
  assert.equal(isBusinessTime(Date.parse('2026-12-01T22:30:00Z')), false); // 00:30 Cairo
  assert.equal(nextBusinessStart(night), Date.parse('2026-12-01T08:00:00Z')); // 10:00 Cairo
});

test('SLA: warning, breach moves the chat to the next agent, then escalation', () => {
  updateSettings({
    business_start: '00:00', business_end: '24:00', sla_target_min: 15, sla_warning_min: 10,
    reassign_window_min: 10, escalate_supervisor_min: 30, escalate_manager_min: 60, night_mode: 'off', ai_enabled: false,
  });
  const a = agent('ahmed');
  const b = agent('sara');
  const channel = q.run("INSERT INTO channels (kind, name, external_id, created_at) VALUES ('whatsapp','WA','pn-1',?)", Date.now()).id;

  const t0 = Date.now();
  const { conversationId } = ingestInbound({
    channel: q.get('SELECT * FROM channels WHERE id = ?', channel),
    externalUserId: '201001112223', phone: '201001112223', profile: { name: 'Test' }, simulated: true,
    message: { externalId: 'wamid.1', text: 'hello', timestamp: t0 },
  });
  const conv = () => q.get('SELECT * FROM conversations WHERE id = ?', conversationId);
  assert.equal(conv().assigned_user_id, a, 'first agent gets the chat');

  // duplicate webhook delivery is ignored
  assert.equal(ingestInbound({
    channel: q.get('SELECT * FROM channels WHERE id = ?', channel), externalUserId: '201001112223', simulated: true,
    message: { externalId: 'wamid.1', text: 'hello', timestamp: t0 },
  }), null);
  assert.equal(q.get('SELECT COUNT(*) AS n FROM messages').n, 1);

  keepOnline(t0 + 11 * MIN);
  tick(t0 + 11 * MIN);
  assert.equal(conv().sla_warned, 1);
  assert.equal(q.get("SELECT COUNT(*) AS n FROM sla_events WHERE kind = 'warning'").n, 1);

  keepOnline(t0 + 16 * MIN);
  tick(t0 + 16 * MIN);
  assert.equal(conv().assigned_user_id, b, 'breach moves the chat to the next available agent');
  assert.equal(conv().reassign_count, 1);
  assert.equal(q.get("SELECT user_id FROM sla_events WHERE kind = 'breach'").user_id, a, 'breach is charged to the agent who missed it');
  assert.equal(q.get("SELECT reason FROM assignments ORDER BY id DESC LIMIT 1").reason, 'sla_breach');

  keepOnline(t0 + 31 * MIN);
  tick(t0 + 31 * MIN);
  assert.equal(conv().escalation_level, 1);
  assert.equal(conv().priority, 'urgent');
  assert.ok(q.get("SELECT COUNT(*) AS n FROM events WHERE type = 'sla_escalation_supervisor'").n >= 1);

  // the audit log cannot be edited
  assert.throws(() => q.run('DELETE FROM events'), /append-only/);
});
