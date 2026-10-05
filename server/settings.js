import { q } from './db.js';

// Every tunable business rule lives here so management can change it from the UI.
export const DEFAULTS = {
  company_name: 'Soul Hospitality',

  // Working hours (Cairo time). Inside these hours the SLA clock runs and chats are routed.
  // Outside them the AI (or a fixed message) answers and the clock waits for business_start.
  business_start: '10:00',
  business_end: '24:00',
  night_mode: 'ai', // 'ai' | 'message' | 'off'
  night_message:
    'أهلاً بيك في Soul Hospitality 🌊\nفريق الحجوزات متاح من الساعة 10 الصبح. ابعتلنا المشروع اللي حابب تحجز فيه، تاريخ الوصول والمغادرة، وعدد الأفراد، وأول ما الفريق يبدأ هنرد عليك فوراً.\n\nWelcome to Soul Hospitality! Our reservations team is available from 10 AM. Send us the project, dates and number of guests and we will get back to you first thing.',
  night_ai_max_replies: 4,

  // SLA
  sla_target_min: 15,
  sla_warning_min: 10,
  reassign_on_breach: true,
  reassign_window_min: 10, // how long the next agent gets after an automatic reassignment
  max_auto_reassign: 2,
  escalate_supervisor_min: 30,
  escalate_manager_min: 60,
  comment_sla_min: 60,
  follow_up_escalate_min: 60,

  // Routing
  allow_agent_claim: true,
  presence_timeout_min: 3,

  // Messaging policy
  messenger_human_agent_tag: false, // requires Meta approval of the Human Agent permission

  // AI
  ai_enabled: true,
  ai_auto_classify: true,
  knowledge_base:
    'Soul Hospitality manages furnished holiday homes on behalf of owners in Egypt.\nProjects: Fouka Bay, Gaia, Marassi, Hacienda, D-Bay (North Coast), Sokhna, El Gouna, New Cairo.\nPrices, availability and booking confirmations are ONLY given by the reservations team.\nA deposit is required to confirm a booking.',

  projects: ['Fouka Bay', 'Gaia', 'Marassi', 'Hacienda', 'D-Bay', 'Sokhna', 'El Gouna', 'New Cairo', 'Other'],
  lead_sources: [
    'facebook_ad', 'instagram_ad', 'messenger', 'instagram_dm', 'whatsapp', 'facebook_comment',
    'instagram_comment', 'broker', 'referral', 'repeat_guest', 'website', 'influencer', 'other',
  ],
};

let cache = null;

function load() {
  cache = { ...DEFAULTS };
  for (const row of q.all('SELECT key, value FROM settings')) {
    try {
      cache[row.key] = JSON.parse(row.value);
    } catch {
      cache[row.key] = row.value;
    }
  }
  return cache;
}

export function getSettings() {
  return cache || load();
}

export function setting(key) {
  return getSettings()[key];
}

export function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    q.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key, JSON.stringify(value),
    );
  }
  return load();
}
