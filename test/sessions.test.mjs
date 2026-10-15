import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ensureAuthSchema } from '../lib/auth/schema.mjs';
import { createSessions, parseCookies, serializeCookie } from '../lib/auth/sessions.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  db.exec("INSERT INTO users(name) VALUES('Ada'),('Grace')");
  ensureAuthSchema(db);
  return db;
}

describe('sessions', () => {
  it('stores only a hash of the token', () => {
    const db = database();
    const sessions = createSessions(db, () => ({ sessionTtlMs: 60_000 }));
    const { token } = sessions.create(1, 'google');
    const rows = db.prepare('SELECT id_hash FROM sessions').all();
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].id_hash, token);
    assert.equal(sessions.lookup(token).name, 'Ada');
    assert.equal(sessions.lookup(token).session_method, 'google');
  });
  it('returns nothing for unknown, destroyed and expired tokens', () => {
    const db = database();
    const live = createSessions(db, () => ({ sessionTtlMs: 60_000 }));
    const { token } = live.create(2, 'dev');
    assert.equal(live.lookup('guess'), null);
    assert.equal(live.lookup(''), null);
    live.destroy(token);
    assert.equal(live.lookup(token), null);
    const expired = createSessions(db, () => ({ sessionTtlMs: -1000 })).create(1, 'dev');
    assert.equal(live.lookup(expired.token), null);
  });
  it('purges expired rows when a new session starts', () => {
    const db = database();
    createSessions(db, () => ({ sessionTtlMs: -1000 })).create(1, 'dev');
    createSessions(db, () => ({ sessionTtlMs: 60_000 })).create(2, 'dev');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
  });
  it('issues unguessable, distinct tokens', () => {
    const sessions = createSessions(database(), () => ({ sessionTtlMs: 60_000 }));
    const tokens = new Set(Array.from({ length: 50 }, () => sessions.create(1, 'dev').token));
    assert.equal(tokens.size, 50);
    for (const token of tokens) assert.ok(token.length >= 43);
  });
});

describe('cookies', () => {
  it('parses a cookie header and keeps the first value of a repeated name', () => {
    assert.deepEqual(parseCookies('a=1; b=hello%20world; a=2; broken'), { a: '1', b: 'hello world' });
    assert.deepEqual(parseCookies(undefined), {});
  });
  it('serializes hardened cookies', () => {
    const cookie = serializeCookie('s', 'v', { maxAgeSeconds: 60.9, secure: true });
    assert.equal(cookie, 's=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
    assert.ok(!serializeCookie('s', 'v').includes('Secure'));
  });
});

describe('schema', () => {
  it('is idempotent and keeps existing profiles complete', () => {
    const db = database();
    ensureAuthSchema(db);
    const user = db.prepare('SELECT * FROM users WHERE id=1').get();
    assert.equal(user.profile_completed, 1);
    assert.equal(user.email, null);
  });
  it('rejects two profiles with the same email regardless of case', () => {
    const db = database();
    db.prepare("UPDATE users SET email='a@t1a.com' WHERE id=1").run();
    assert.throws(() => db.prepare("UPDATE users SET email='A@T1A.COM' WHERE id=2").run());
  });
});
