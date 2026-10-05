import { config } from './config.js';
import { q, audit } from './db.js';
import { HttpError, forbidden } from './http.js';
import { can } from './permissions.js';
import { randomToken, sha256, verifyPassword } from './security.js';

const COOKIE = 'soul_sid';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(maxAgeSeconds) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

// Brute-force protection: 5 failed attempts per email+IP per 15 minutes.
const failures = new Map();
function tooManyFailures(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > 15 * 60000) {
    failures.delete(key);
    return false;
  }
  return f.count >= 5;
}

export function login(req, res, { email, password }) {
  const key = `${String(email).toLowerCase()}|${req.ip}`;
  if (tooManyFailures(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const user = q.get('SELECT * FROM users WHERE email = ? AND active = 1', String(email || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    const f = failures.get(key) || { count: 0, first: Date.now() };
    f.count++;
    failures.set(key, f);
    audit({ userId: user?.id ?? null, type: 'login_failed', data: { email, ip: req.ip } });
    throw new HttpError(401, 'Wrong email or password');
  }
  failures.delete(key);
  const token = randomToken();
  const now = Date.now();
  q.run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
    sha256(token), user.id, now, now + config.sessionDays * 86400000, req.ip, String(req.get('user-agent') || '').slice(0, 200),
  );
  audit({ userId: user.id, type: 'login', data: { ip: req.ip } });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs(config.sessionDays * 86400)}`);
  return user;
}

export function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`);
}

export function revokeSessions(userId) {
  q.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next(new HttpError(401, 'Please sign in'));
  const session = q.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
  if (!session || session.expires_at < Date.now()) return next(new HttpError(401, 'Session expired'));
  const user = q.get('SELECT id, name, email, role, active, in_rotation, max_open, presence FROM users WHERE id = ?', session.user_id);
  if (!user || !user.active) return next(new HttpError(401, 'Account disabled'));
  req.user = user;
  next();
}

export function requirePerm(permission) {
  return (req, res, next) => (can(req.user, permission) ? next() : next(forbidden()));
}

// Mutating API calls must be JSON: browsers cannot send that cross-site without CORS,
// which (with SameSite=Lax cookies) closes the CSRF hole.
export function requireJson(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return next(new HttpError(415, 'Content-Type must be application/json'));
  }
  next();
}
