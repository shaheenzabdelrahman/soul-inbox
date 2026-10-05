import { config } from '../config.js';
import { setting } from '../settings.js';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' });

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Minutes since local midnight in the business timezone. */
export function localMinutes(ts) {
  const parts = fmt.formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

export function localHour(ts) {
  return Number(hourFmt.format(new Date(ts)));
}

function window() {
  return { start: toMinutes(setting('business_start')), end: toMinutes(setting('business_end')) };
}

/** True when the SLA clock is running (agents are expected to reply). */
export function isBusinessTime(ts = Date.now()) {
  const { start, end } = window();
  if (end - start >= 1440 || start === end) return true; // 24/7
  const m = localMinutes(ts);
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** The moment the SLA clock should start for a message received at `ts`. */
export function nextBusinessStart(ts) {
  if (isBusinessTime(ts)) return ts;
  const { start } = window();
  const m = localMinutes(ts);
  const deltaMin = (start - m + 1440) % 1440;
  const startOfMinute = ts - (ts % 60000);
  return startOfMinute + deltaMin * 60000;
}
