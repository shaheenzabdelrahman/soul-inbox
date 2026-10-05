export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');

export function int(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`Invalid ${name}`);
  return n;
}

export function preview(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Normalise Egyptian / international phone numbers to digits with country code (e.g. 201001234567). */
export function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = `2${d}`; // local Egyptian mobile 01xxxxxxxxx
  return d.length >= 8 ? d : null;
}
