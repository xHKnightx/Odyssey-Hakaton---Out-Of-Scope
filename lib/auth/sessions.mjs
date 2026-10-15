import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'pythia_session';

const digest = token => createHash('sha256').update(token).digest('hex');

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { cookies[name] = part.slice(index + 1).trim(); }
  }
  return cookies;
}

export function serializeCookie(name, value, { maxAgeSeconds, path = '/', secure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function createSessions(db, getConfig) {
  const insert = db.prepare('INSERT INTO sessions(id_hash,user_id,method,created_at,expires_at) VALUES(?,?,?,?,?)');
  const find = db.prepare(`SELECT u.*, s.method session_method FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id_hash=? AND s.expires_at>?`);
  const remove = db.prepare('DELETE FROM sessions WHERE id_hash=?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at<=?');
  return {
    create(userId, method) {
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      const ttl = getConfig().sessionTtlMs;
      purge.run(now);
      insert.run(digest(token), userId, method, now, now + ttl);
      return { token, maxAgeSeconds: ttl / 1000 };
    },
    lookup(token) {
      if (!token) return null;
      return find.get(digest(String(token)), Date.now()) || null;
    },
    destroy(token) {
      if (token) remove.run(digest(String(token)));
    }
  };
}
