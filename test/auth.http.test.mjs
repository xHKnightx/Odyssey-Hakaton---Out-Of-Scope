import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signInAs, startApp } from './helpers/app.mjs';

describe('authentication gate (dev login enabled)', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app.stop(); });

  it('rejects anonymous API calls and redirects anonymous page loads', async () => {
    const client = app.client();
    assert.equal((await client.request('/api/overview')).status, 401);
    assert.equal((await client.request('/api/seek', { method: 'POST', json: { text: 'calendar' } })).status, 401);
    const page = await client.request('/');
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login.html');
    assert.equal((await client.request('/app.js')).status, 401);
    assert.equal((await client.request('/login.html')).status, 200);
    assert.equal((await client.request('/login.js')).status, 200);
    assert.equal((await client.request('/style.css')).status, 200);
  });

  it('publishes only what the login page needs', async () => {
    const config = (await app.client().request('/auth/config')).json();
    assert.deepEqual(config, { googleConfigured: false, devLogin: true, allowedDomains: ['t1a.com'] });
  });

  it('starts a session with a hardened cookie and serves the app', async () => {
    const { client, persona } = await signInAs(app, 'Priya Nair');
    const login = await client.request('/auth/dev-login', { method: 'POST', json: { userId: persona.id } });
    const cookie = login.setCookie.find(line => line.startsWith('pythia_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    const me = (await client.request('/api/auth/me')).json();
    assert.equal(me.user.name, 'Priya Nair');
    assert.equal(me.method, 'dev');
    assert.equal((await client.request('/')).status, 200);
    assert.equal((await client.request('/app.js')).status, 200);
  });

  it('ignores a userId sent by the client', async () => {
    const { client, persona } = await signInAs(app, 'Mia Novak');
    const { people } = (await client.request('/api/overview')).json();
    const other = people.find(person => person.id !== persona.id);
    const overview = (await client.request(`/api/overview?userId=${other.id}`)).json();
    assert.equal(overview.activeUserId, persona.id);

    const seek = await client.request('/api/seek', { method: 'POST', json: { text: 'my calendar is full of meetings', userId: other.id } });
    assert.equal(seek.status, 200);
    const asked = (await client.request('/api/overview')).json().requests.find(request => request.id === seek.json().requestId);
    assert.equal(asked.user_id, persona.id);
  });

  it('lets only the person who ran a solution rate it', async () => {
    const author = (await signInAs(app, 'Priya Nair')).client;
    const runner = (await signInAs(app, 'Mia Novak')).client;
    const stranger = (await signInAs(app, 'Daniel Ortiz')).client;
    const { solutions } = (await runner.request('/api/overview')).json();
    const solution = solutions.find(item => item.runnable);
    const run = await runner.request('/api/run', { method: 'POST', json: { solutionId: solution.id, timeZone: 'UTC' } });
    assert.equal(run.status, 200);
    const runId = run.json().id;
    for (const outsider of [stranger, author]) {
      const denied = await outsider.request(`/api/runs/${runId}/feedback`, { method: 'POST', json: { feedback: 'helped' } });
      assert.equal(denied.status, 403);
    }
    const accepted = await runner.request(`/api/runs/${runId}/feedback`, { method: 'POST', json: { feedback: 'helped' } });
    assert.equal(accepted.status, 200);
    assert.equal((await stranger.request('/api/calendar/invites', { method: 'POST', json: { runId, proposalIds: [1] } })).status, 403);
  });

  it('blocks cross-site state changes', async () => {
    const { client } = await signInAs(app, 'Mia Novak');
    const body = { text: 'calendar' };
    assert.equal((await client.request('/api/seek', { method: 'POST', json: body, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await client.request('/api/seek', { method: 'POST', json: body, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await client.request('/api/seek', { method: 'POST', json: body, headers: { origin: app.url } })).status, 200);
  });

  it('edits only the signed-in profile', async () => {
    const { client, persona } = await signInAs(app, 'Daniel Ortiz');
    const profile = { name: 'Daniel Ortiz', title: 'Lead Analyst', team: 'Finance', skills: 'SQL, Power BI', location: 'Prague' };
    const saved = await client.request('/api/people', { method: 'POST', json: profile });
    assert.equal(saved.status, 200);
    assert.equal(saved.json().person.id, persona.id);
    assert.equal(saved.json().person.title, 'Lead Analyst');
    assert.equal((await client.request('/api/people', { method: 'POST', json: { ...profile, name: 'Mia Novak' } })).status, 409);
    assert.equal((await client.request('/api/people', { method: 'POST', json: { name: 'Daniel Ortiz' } })).status, 400);
  });

  it('ends the session on logout', async () => {
    const { client } = await signInAs(app, 'Mia Novak');
    assert.equal((await client.request('/api/auth/me')).status, 200);
    assert.equal((await client.request('/auth/logout', { method: 'POST', json: {} })).status, 200);
    assert.equal((await client.request('/api/auth/me')).status, 401);
  });

  it('sends the Google connection flow through sign-in first', async () => {
    const response = await app.client().request('/auth/google');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login.html');
  });
});

describe('dev login defaults', () => {
  it('is on when neither the flag nor Google credentials are set', async () => {
    const app = await startApp({ AUTH_DEV_LOGIN: undefined });
    try {
      assert.equal((await app.client().request('/auth/personas')).status, 200);
    } finally { await app.stop(); }
  });
  it('is off when Google credentials are set and the flag is not', async () => {
    const app = await startApp({ AUTH_DEV_LOGIN: undefined, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    try {
      assert.equal((await app.client().request('/auth/personas')).status, 404);
      const config = (await app.client().request('/auth/config')).json();
      assert.equal(config.googleConfigured, true);
      const login = await app.client().request('/auth/login');
      assert.equal(login.status, 302);
      assert.match(login.headers.get('location'), /^https:\/\/accounts\.google\.com\//);
    } finally { await app.stop(); }
  });
});

describe('dev login switched off', () => {
  let app;
  before(async () => { app = await startApp({ AUTH_DEV_LOGIN: '0' }); });
  after(async () => { await app.stop(); });

  it('does not expose personas or accept dev logins', async () => {
    const client = app.client();
    assert.equal((await client.request('/auth/personas')).status, 404);
    assert.equal((await client.request('/auth/dev-login', { method: 'POST', json: { userId: 1 } })).status, 404);
    assert.equal((await client.request('/api/overview')).status, 401);
  });

  it('is also off when NODE_ENV is production, whatever the flag says', async () => {
    const production = await startApp({ AUTH_DEV_LOGIN: '1', NODE_ENV: 'production' });
    try {
      assert.equal((await production.client().request('/auth/personas')).status, 404);
    } finally { await production.stop(); }
  });
});
