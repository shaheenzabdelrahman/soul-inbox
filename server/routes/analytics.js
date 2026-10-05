import express from 'express';
import { config } from '../config.js';
import { q } from '../db.js';
import { badRequest } from '../http.js';
import { can } from '../permissions.js';
import { getSettings } from '../settings.js';
import { localHour } from '../services/hours.js';

export const analytics = express.Router();

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const localDay = (ts) => dayFmt.format(new Date(ts));

function stats(values) {
  if (!values.length) return { count: 0, avg: null, median: null, p90: null, min: null, max: null };
  const s = [...values].sort((a, b) => a - b);
  const pick = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return {
    count: s.length,
    avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    median: pick(0.5),
    p90: pick(0.9),
    min: s[0],
    max: s[s.length - 1],
  };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/**
 * KPI definitions (all for the selected period unless marked "now"):
 *  - Response time: business-hours seconds from the first unanswered customer message to the human reply.
 *  - SLA compliance: replies within the SLA target / all replies.
 *  - First response: the first reply in a conversation.
 *  - Lead conversion: leads created in the period that are Won / leads created in the period (cohort).
 *  - Qualified conversion (official KPI): Won / leads that reached a "qualified" stage.
 */
analytics.get('/analytics', (req, res) => {
  const now = Date.now();
  const to = Number(req.query.to) || now;
  const from = Number(req.query.from) || to - 7 * 86400000;
  if (from >= to || to - from > 400 * 86400000) throw badRequest('Invalid period');
  const team = can(req.user, 'analytics.team');
  const only = team ? (req.query.user ? Number(req.query.user) : null) : req.user.id;
  const s = getSettings();

  const users = q.all('SELECT id, name, role, presence, active, in_rotation FROM users ORDER BY name');
  const stages = q.all('SELECT * FROM lead_stages ORDER BY position');
  const stageByKey = Object.fromEntries(stages.map((st) => [st.key, st]));

  // ---- raw data for the period
  const responses = q.all(
    `SELECT * FROM responses WHERE responded_at >= ? AND responded_at < ? ${only ? 'AND (user_id = ? OR (user_id IS NULL AND assigned_user_id = ?))' : ''}`,
    from, to, ...(only ? [only, only] : []),
  );
  const conversations = q.all(
    `SELECT id, channel_kind, source, created_at, assigned_user_id FROM conversations WHERE created_at >= ? AND created_at < ?
     ${only ? 'AND id IN (SELECT conversation_id FROM assignments WHERE to_user_id = ?)' : ''}`,
    from, to, ...(only ? [only] : []),
  );
  const leads = q.all(
    `SELECT l.*, c.channel_kind FROM leads l LEFT JOIN conversations c ON c.id = l.conversation_id
     WHERE l.created_at >= ? AND l.created_at < ? ${only ? 'AND l.owner_user_id = ?' : ''}`,
    from, to, ...(only ? [only] : []),
  );
  const wonInPeriod = q.all(
    `SELECT l.*, c.channel_kind FROM leads l LEFT JOIN conversations c ON c.id = l.conversation_id
     JOIN lead_stages s ON s.key = l.stage_key
     WHERE s.kind = 'won' AND l.won_at >= ? AND l.won_at < ? ${only ? 'AND l.owner_user_id = ?' : ''}`,
    from, to, ...(only ? [only] : []),
  );
  const lostInPeriod = q.all(
    `SELECT l.lost_reason_key, l.owner_user_id FROM leads l JOIN lead_stages s ON s.key = l.stage_key
     WHERE s.kind = 'lost' AND l.closed_at >= ? AND l.closed_at < ? ${only ? 'AND l.owner_user_id = ?' : ''}`,
    from, to, ...(only ? [only] : []),
  );
  const breaches = q.all(
    `SELECT * FROM sla_events WHERE kind = 'breach' AND at >= ? AND at < ? ${only ? 'AND user_id = ?' : ''}`,
    from, to, ...(only ? [only] : []),
  );
  const assignments = q.all('SELECT * FROM assignments WHERE at >= ? AND at < ?', from, to);
  const sent = q.all(
    `SELECT user_id, COUNT(*) AS n FROM messages WHERE direction = 'out' AND sender_type = 'agent' AND created_at >= ? AND created_at < ?
     GROUP BY user_id`,
    from, to,
  );
  const inbound = q.all(
    `SELECT m.created_at FROM messages m ${only ? 'JOIN conversations c ON c.id = m.conversation_id' : ''}
     WHERE m.direction = 'in' AND m.created_at >= ? AND m.created_at < ? ${only ? 'AND c.assigned_user_id = ?' : ''}`,
    from, to, ...(only ? [only] : []),
  );
  const followUpsDone = q.all(
    "SELECT assigned_user_id, done_at, due_at FROM follow_ups WHERE status = 'done' AND done_at >= ? AND done_at < ?",
    from, to,
  );

  // ---- now (live operational snapshot)
  const vis = only ? 'AND assigned_user_id = ?' : '';
  const visP = only ? [only] : [];
  const live = q.get(
    `SELECT
       SUM(status <> 'closed') AS open,
       SUM(status = 'needs_reply') AS needs_reply,
       SUM(status = 'needs_reply' AND sla_due_at IS NOT NULL AND sla_due_at <= ?) AS overdue,
       SUM(status = 'needs_reply' AND sla_due_at IS NOT NULL AND sla_due_at > ? AND sla_due_at - ? <= ?) AS at_risk,
       SUM(status = 'needs_reply' AND assigned_user_id IS NULL) AS unassigned,
       SUM(status = 'waiting_customer') AS waiting_customer,
       SUM(status <> 'closed' AND type = 'unknown') AS unclassified
     FROM conversations WHERE 1 = 1 ${vis}`,
    now, now, now, (s.sla_target_min - s.sla_warning_min) * 60000, ...visP,
  );
  const liveFollowUps = q.get(
    `SELECT SUM(due_at <= ?) AS due, SUM(due_at <= ?) AS overdue FROM follow_ups WHERE status = 'open' ${only ? 'AND assigned_user_id = ?' : ''}`,
    now, now - s.follow_up_escalate_min * 60000, ...visP,
  );
  const openComments = q.get("SELECT COUNT(*) AS n, SUM(created_at <= ?) AS overdue FROM comments WHERE status = 'new'", now - s.comment_sla_min * 60000);

  // ---- overview
  const rt = stats(responses.map((r) => r.seconds_sla));
  const first = stats(responses.filter((r) => r.is_first).map((r) => r.seconds_sla));
  const withinSla = responses.filter((r) => r.within_sla).length;
  const qualified = leads.filter((l) => l.qualified_at || stageByKey[l.stage_key]?.kind === 'won');
  const cohortWon = leads.filter((l) => stageByKey[l.stage_key]?.kind === 'won');
  const overview = {
    conversations: conversations.length,
    inbound_messages: inbound.length,
    replies: responses.length,
    response: rt,
    first_response: first,
    sla_compliance: pct(withinSla, responses.length),
    sla_breaches: breaches.length,
    leads: leads.length,
    qualified: qualified.length,
    won_cohort: cohortWon.length,
    lost_cohort: leads.filter((l) => stageByKey[l.stage_key]?.kind === 'lost').length,
    conversion_lead: pct(cohortWon.length, leads.length),
    conversion_qualified: pct(cohortWon.length, qualified.length),
    conversion_conversation: pct(cohortWon.filter((l) => l.conversation_id).length, conversations.length),
    bookings: wonInPeriod.length,
    booking_value: wonInPeriod.reduce((a, l) => a + (l.booking_value || 0), 0),
    sla_target_min: s.sla_target_min,
  };

  // ---- per agent
  const agents = (only ? users.filter((u) => u.id === only) : users.filter((u) => u.active)).map((u) => {
    const mine = responses.filter((r) => r.user_id === u.id);
    const myLeads = leads.filter((l) => l.owner_user_id === u.id);
    const myQualified = myLeads.filter((l) => l.qualified_at || stageByKey[l.stage_key]?.kind === 'won');
    const myWon = myLeads.filter((l) => stageByKey[l.stage_key]?.kind === 'won');
    const myWonPeriod = wonInPeriod.filter((l) => l.owner_user_id === u.id);
    const waiting = q.get(
      "SELECT COUNT(*) AS n, SUM(sla_due_at <= ?) AS overdue FROM conversations WHERE assigned_user_id = ? AND status = 'needs_reply'",
      now, u.id,
    );
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      presence: u.presence,
      chats_assigned: new Set(assignments.filter((a) => a.to_user_id === u.id).map((a) => a.conversation_id)).size,
      messages_sent: sent.find((x) => x.user_id === u.id)?.n || 0,
      replies: mine.length,
      avg_response: stats(mine.map((r) => r.seconds_sla)).avg,
      median_response: stats(mine.map((r) => r.seconds_sla)).median,
      sla_compliance: pct(mine.filter((r) => r.within_sla).length, mine.length),
      breaches: breaches.filter((b) => b.user_id === u.id).length,
      moved_away: assignments.filter((a) => a.from_user_id === u.id && a.reason === 'sla_breach').length,
      leads: myLeads.length,
      qualified: myQualified.length,
      won: myWon.length,
      lost: lostInPeriod.filter((l) => l.owner_user_id === u.id).length,
      conversion: pct(myWon.length, myQualified.length),
      bookings: myWonPeriod.length,
      booking_value: myWonPeriod.reduce((a, l) => a + (l.booking_value || 0), 0),
      follow_ups_done: followUpsDone.filter((f) => f.assigned_user_id === u.id).length,
      waiting_now: waiting.n || 0,
      overdue_now: waiting.overdue || 0,
    };
  }).filter((a) => only || a.role !== 'admin' || a.replies || a.leads);

  // ---- per channel
  const channels = ['messenger', 'instagram', 'whatsapp'].map((kind) => {
    const r = responses.filter((x) => x.channel_kind === kind);
    const l = leads.filter((x) => x.channel_kind === kind);
    const w = l.filter((x) => stageByKey[x.stage_key]?.kind === 'won');
    return {
      kind,
      conversations: conversations.filter((c) => c.channel_kind === kind).length,
      leads: l.length,
      won: w.length,
      conversion: pct(w.length, l.length),
      avg_response: stats(r.map((x) => x.seconds_sla)).avg,
      sla_compliance: pct(r.filter((x) => x.within_sla).length, r.length),
      booking_value: wonInPeriod.filter((x) => x.channel_kind === kind).reduce((a, x) => a + (x.booking_value || 0), 0),
    };
  });

  // ---- funnel: a lead "reached" every open stage up to the furthest one it touched
  const history = leads.length
    ? q.all(`SELECT lead_id, to_stage FROM lead_stage_history WHERE lead_id IN (${leads.map(() => '?').join(',')})`, ...leads.map((l) => l.id))
    : [];
  const openStages = stages.filter((st) => st.kind === 'open' && st.active);
  const wonStage = stages.find((st) => st.kind === 'won' && st.active);
  const furthest = new Map();
  for (const l of leads) furthest.set(l.id, 0);
  for (const h of history) {
    const st = stageByKey[h.to_stage];
    if (!st) continue;
    const rank = st.kind === 'won' ? Infinity : st.kind === 'open' ? st.position : 0;
    if (rank > furthest.get(h.lead_id)) furthest.set(h.lead_id, rank);
  }
  const funnel = openStages.map((st) => ({
    key: st.key, name_en: st.name_en, name_ar: st.name_ar,
    count: [...furthest.values()].filter((r) => r >= st.position).length,
  }));
  if (wonStage) funnel.push({ key: wonStage.key, name_en: wonStage.name_en, name_ar: wonStage.name_ar, count: [...furthest.values()].filter((r) => r === Infinity).length });

  // ---- breakdowns
  const lostReasons = q.all('SELECT * FROM lost_reasons ORDER BY position').map((r) => ({
    key: r.key, name_en: r.name_en, name_ar: r.name_ar, count: lostInPeriod.filter((l) => l.lost_reason_key === r.key).length,
  })).filter((r) => r.count);

  const group = (list, key) => {
    const m = new Map();
    for (const l of list) {
      const k = l[key] || 'unknown';
      const e = m.get(k) || { key: k, leads: 0, won: 0, booking_value: 0 };
      e.leads++;
      if (stageByKey[l.stage_key]?.kind === 'won') { e.won++; e.booking_value += l.booking_value || 0; }
      m.set(k, e);
    }
    return [...m.values()].map((e) => ({ ...e, conversion: pct(e.won, e.leads) })).sort((a, b) => b.leads - a.leads);
  };

  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, messages: 0 }));
  for (const m of inbound) hourly[localHour(m.created_at)].messages++;

  const days = new Map();
  for (let t = from; t < to; t += 86400000) days.set(localDay(t), { day: localDay(t), conversations: 0, leads: 0, bookings: 0 });
  for (const c of conversations) days.get(localDay(c.created_at)) && days.get(localDay(c.created_at)).conversations++;
  for (const l of leads) days.get(localDay(l.created_at)) && days.get(localDay(l.created_at)).leads++;
  for (const l of wonInPeriod) days.get(localDay(l.won_at)) && days.get(localDay(l.won_at)).bookings++;

  const buckets = [
    { label: '< 5m', max: 300 }, { label: '5-15m', max: 900 }, { label: '15-30m', max: 1800 },
    { label: '30-60m', max: 3600 }, { label: '1-4h', max: 14400 }, { label: '> 4h', max: Infinity },
  ].map((b, i, arr) => ({
    label: b.label,
    count: responses.filter((r) => r.seconds_sla < b.max && (i === 0 || r.seconds_sla >= arr[i - 1].max)).length,
  }));

  res.json({
    period: { from, to },
    scope: only ? 'user' : 'team',
    live: { ...live, follow_ups_due: liveFollowUps.due || 0, follow_ups_overdue: liveFollowUps.overdue || 0, comments_open: openComments.n || 0, comments_overdue: openComments.overdue || 0 },
    overview,
    agents,
    channels,
    funnel,
    lostReasons,
    bySource: group(leads, 'source'),
    byProject: group(leads, 'project'),
    hourly,
    daily: [...days.values()],
    responseBuckets: buckets,
  });
});
