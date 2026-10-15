import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from './helpers/client.mjs';

// google.mjs resolves data/ from the working directory when it is imported.
const workdir = mkdtempSync(join(tmpdir(), 'pythia-login-'));
process.chdir(workdir);
process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
process.env.AUTH_ALLOWED_DOMAINS = 't1a.com';
process.env.AUTH_DEV_LOGIN = '0';
const { createAuth } = await import('../lib/auth/index.mjs');
const { currentUser } = await import('../lib/auth/context.mjs');

const idToken = claims => ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');

describe('Google sign-in flow', () => {
  let db, auth, server, url, google;

  before(async () => {
    db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, title TEXT, team TEXT, skills TEXT, initials TEXT, color TEXT, location TEXT, availability TEXT, experience TEXT)`);
    db.prepare("INSERT INTO users(name,title,team,skills) VALUES('Priya Nair','Data Lead','Finance','SQL')").run();
    // Fake Google token endpoint: whatever the test sets in `google.claims` becomes the ID token.
    google = { claims: null, status: 200, calls: [] };
    const fetchImpl = async (_url, init) => {
      google.calls.push(Object.fromEntries(init.body));
      return new Response(JSON.stringify(google.status === 200 ? { id_token: idToken(google.claims) } : { error: 'invalid_grant' }), { status: google.status });
    };
    auth = createAuth(db, { fetchImpl, log: () => {} });
    server = createServer((req, res) => auth.handle(req, res, async () => {
      await new Promise(resolve => setImmediate(resolve));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ seenBy: currentUser()?.email ?? null }));
    }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.close(); rmSync(workdir, { recursive: true, force: true }); });
  beforeEach(() => { google.calls.length = 0; google.status = 200; });

  const claimsFor = (nonce, overrides = {}) => ({
    iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600,
    nonce, sub: 'sub-jane', email: 'jane.doe@t1a.com', email_verified: true, hd: 't1a.com', name: 'Jane Doe', ...overrides
  });

  async function begin(client) {
    const start = await client.request('/auth/login');
    assert.equal(start.status, 302);
    const target = new URL(start.headers.get('location'));
    return { state: target.searchParams.get('state'), nonce: target.searchParams.get('nonce'), challenge: target.searchParams.get('code_challenge'), target, start };
  }

  it('redirects to Google with PKCE, state, nonce and a state cookie', async () => {
    const client = createClient(url);
    const { target, start } = await begin(client);
    assert.equal(target.origin, 'https://accounts.google.com');
    assert.equal(target.searchParams.get('scope'), 'openid email profile');
    assert.equal(target.searchParams.get('hd'), 't1a.com');
    assert.match(start.setCookie[0], /^pythia_oauth=.*HttpOnly.*SameSite=Lax/);
    assert.match(start.setCookie[0], /Path=\/auth/);
  });

  it('signs a new colleague in, creates an incomplete profile and sends the verifier to Google', async () => {
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce);
    const done = await client.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('location'), '/');
    assert.equal(google.calls[0].grant_type, 'authorization_code');
    assert.ok(google.calls[0].code_verifier.length >= 43);
    const session = done.setCookie.find(line => line.startsWith('pythia_session='));
    assert.match(session, /HttpOnly/);
    const me = (await client.request('/api/auth/me')).json();
    assert.equal(me.user.email, 'jane.doe@t1a.com');
    assert.equal(me.user.name, 'Jane Doe');
    assert.equal(me.profileComplete, false);
    assert.equal(me.method, 'google');
    assert.equal((await client.request('/anything')).json().seenBy, 'jane.doe@t1a.com');
  });

  it('recognises a returning colleague by Google subject', async () => {
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce, { name: 'Jane D. Renamed', email: 'jane.doe@t1a.com' });
    await client.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email='jane.doe@t1a.com'").get().n, 1);
  });

  it('claims an unclaimed seed profile with the same name', async () => {
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce, { sub: 'sub-priya', email: 'priya.nair@t1a.com', name: 'priya  NAIR' });
    await client.request(`/auth/google/callback?code=abc&state=${state}`);
    const me = (await client.request('/api/auth/me')).json();
    assert.equal(me.user.name, 'Priya Nair');
    assert.equal(me.user.email, 'priya.nair@t1a.com');
    assert.equal(me.profileComplete, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE name LIKE 'priya%'").get().n, 1);
  });

  it('does not let a second account claim an already claimed profile', async () => {
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce, { sub: 'sub-other', email: 'other.priya@t1a.com', name: 'Priya Nair' });
    await client.request(`/auth/google/callback?code=abc&state=${state}`);
    const me = (await client.request('/api/auth/me')).json();
    assert.equal(me.user.email, 'other.priya@t1a.com');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE name='Priya Nair'").get().n, 2);
  });

  it('refuses accounts outside the allowed domain', async () => {
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce, { sub: 'sub-x', email: 'someone@gmail.com', hd: undefined });
    const done = await client.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal(done.headers.get('location'), '/login.html?error=domain');
    assert.equal(done.setCookie.some(line => line.startsWith('pythia_session=')), false);
    assert.equal((await client.request('/api/auth/me')).status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE email='someone@gmail.com'").get().n, 0);
  });

  it('refuses a token whose nonce was not issued for this login', async () => {
    const client = createClient(url);
    const { state } = await begin(client);
    google.claims = claimsFor('attacker-nonce');
    const done = await client.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal(done.headers.get('location'), '/login.html?error=token');
  });

  it('refuses a callback that did not start in this browser (login CSRF)', async () => {
    const victim = createClient(url);
    const attacker = createClient(url);
    const { state, nonce } = await begin(attacker);
    google.claims = claimsFor(nonce);
    const done = await victim.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal(done.headers.get('location'), '/login.html?error=state');
    assert.equal(google.calls.length, 0);
  });

  it('refuses unknown, replayed and denied callbacks', async () => {
    const client = createClient(url);
    assert.equal((await client.request('/auth/google/callback?code=abc&state=forged')).headers.get('location'), '/login.html');
    const first = await begin(client);
    google.claims = claimsFor(first.nonce);
    await client.request(`/auth/google/callback?code=abc&state=${first.state}`);
    const replay = createClient(url);
    replay.jar.set('pythia_oauth', first.state);
    assert.equal((await replay.request(`/auth/google/callback?code=abc&state=${first.state}`)).headers.get('location'), '/login.html');

    const denied = createClient(url);
    const second = await begin(denied);
    const done = await denied.request(`/auth/google/callback?error=access_denied&state=${second.state}`);
    assert.equal(done.headers.get('location'), '/login.html?error=denied');
  });

  it('reports a failed code exchange without leaking details', async () => {
    const client = createClient(url);
    const { state } = await begin(client);
    google.status = 400;
    const done = await client.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal(done.headers.get('location'), '/login.html?error=exchange');
  });

  it('hands the pre-auth Google token to its owner at sign-in', async () => {
    mkdirSync(join(workdir, 'data'), { recursive: true });
    const legacy = join(workdir, 'data', 'google-token.json');
    writeFileSync(legacy, JSON.stringify({ email: 'Alex.Korn@t1a.com', refresh_token: 'r' }));
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce, { sub: 'sub-alex', email: 'alex.korn@t1a.com', name: 'Alex Korn' });
    await client.request(`/auth/google/callback?code=abc&state=${state}`);
    const alex = db.prepare("SELECT id FROM users WHERE email='alex.korn@t1a.com'").get();
    const moved = join(workdir, 'data', 'google-tokens', `${alex.id}.json`);
    assert.equal(existsSync(legacy), false);
    assert.equal(JSON.parse(readFileSync(moved, 'utf8')).refresh_token, 'r');
  });

  it('leaves the pre-auth token alone when the emails differ', async () => {
    const legacy = join(workdir, 'data', 'google-token.json');
    writeFileSync(legacy, JSON.stringify({ email: 'someone.else@t1a.com', refresh_token: 'r2' }));
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce, { sub: 'sub-bob', email: 'bob@t1a.com', name: 'Bob Builder' });
    await client.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal(existsSync(legacy), true);
    rmSync(legacy);
  });

  it('signs out', async () => {
    const client = createClient(url);
    const { state, nonce } = await begin(client);
    google.claims = claimsFor(nonce);
    await client.request(`/auth/google/callback?code=abc&state=${state}`);
    assert.equal((await client.request('/auth/logout', { method: 'POST', json: {} })).status, 200);
    assert.equal((await client.request('/api/auth/me')).status, 401);
  });
});
