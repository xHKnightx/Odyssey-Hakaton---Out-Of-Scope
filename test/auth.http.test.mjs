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
    const profile = { name: 'Daniel Ortiz', title: 'Lead Analyst', team: 'Finance', skills: 'SQL, sql,  SQL  , Power   BI', location: 'Prague' };
    const saved = await client.request('/api/people', { method: 'POST', json: profile });
    assert.equal(saved.status, 200);
    assert.equal(saved.json().person.id, persona.id);
    assert.equal(saved.json().person.title, 'Lead Analyst');
    assert.equal(saved.json().person.skills, 'SQL, Power BI');
    const duplicate = await client.request('/api/skills/confirm', { method: 'POST', json: { skill: '  sql  ' } });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json().award.reason, 'already_on_profile');
    assert.deepEqual(duplicate.json().skills, ['SQL','Power BI']);
    assert.equal((await client.request('/api/people', { method: 'POST', json: { ...profile, name: 'Mia Novak' } })).status, 409);
    assert.equal((await client.request('/api/people', { method: 'POST', json: { name: 'Daniel Ortiz' } })).status, 400);
  });

  it('lets people patch only their own profile', async () => {
    const { client, persona } = await signInAs(app, 'Mia Novak');
    const { people } = (await client.request('/api/overview')).json();
    const other = people.find(person => person.id !== persona.id);
    const denied = await client.request(`/api/people/${other.id}`, { method: 'PATCH', json: { title: 'Hijacked' } });
    assert.equal(denied.status, 403);
    assert.notEqual((await client.request('/api/overview')).json().people.find(person => person.id === other.id).title, 'Hijacked');
    const own = await client.request(`/api/people/${persona.id}`, { method: 'PATCH', json: { title: 'Principal Designer', skills: ['Figma',' figma ','Service   design'] } });
    assert.equal(own.status, 200);
    assert.equal(own.json().person.title, 'Principal Designer');
    assert.equal(own.json().person.skills, 'Figma, Service design');
  });

  it('drafts first-login profile fields without saving or publishing solutions', async () => {
    const { client, persona } = await signInAs(app, 'Mia Novak');
    const before=(await client.request('/api/overview')).json();
    const response=await client.request('/api/profile/analyze',{method:'POST',json:{text:'I lead Salesforce CRM migrations and improve data quality.'}});
    assert.equal(response.status,200);
    assert.equal(response.json().mode,'local');
    assert.ok(response.json().skills.includes('Salesforce'));
    assert.equal(response.json().team,'CRM');
    const after=(await client.request('/api/overview')).json();
    assert.equal(after.people.find(person=>person.id===persona.id).skills,before.people.find(person=>person.id===persona.id).skills);
    assert.equal(after.solutions.length,before.solutions.length);
  });

  it('puts the Oracle behind sign-in and answers as the signed-in person', async () => {
    const anonymous = app.client();
    assert.equal((await anonymous.request('/api/oracle/status')).status, 401);
    assert.equal((await anonymous.request('/api/oracle/chat', { method: 'POST', json: { messages: [{ role: 'user', content: 'calendar' }] } })).status, 401);

    const { client, persona } = await signInAs(app, 'Priya Nair');
    assert.equal((await client.request('/api/oracle/status')).status, 200);
    const { people } = (await client.request('/api/overview')).json();
    const other = people.find(person => person.id !== persona.id);
    const chat = await client.request('/api/oracle/chat', { method: 'POST', json: { userId: other.id, messages: [{ role: 'user', content: 'my calendar is full of meetings' }] } });
    assert.equal(chat.status, 200);
    const asked = (await client.request('/api/overview')).json().requests.find(request => request.id === chat.json().requestId);
    assert.equal(asked.user_id, persona.id);
  });

  it('analyzes shared wisdom and saves confirmed skills and solutions for the signed-in person', async () => {
    const { client, persona } = await signInAs(app, 'Mia Novak');
    const analyzed = await client.request('/api/share/analyze', { method:'POST', json:{ text:'I built a Salesforce agent that finds duplicate customer accounts.' } });
    assert.equal(analyzed.status,200);
    assert.equal(analyzed.json().mode,'local');
    assert.ok(analyzed.json().skills.includes('Salesforce'));
    assert.equal(analyzed.json().solutions.length,1);

    const saved = await client.request('/api/share', { method:'POST', json:{
      text:'I built a Salesforce agent that finds duplicate customer accounts.',
      analysis:{headline:'A reusable agent',summary:'Review it',skills:['Salesforce data quality'],experience:[],solutions:[{title:'HTTP Test Duplicate Finder',kind:'agent',summary:'Finds likely duplicate customer accounts.',evidence:'I built a Salesforce agent',runnable:true,minutesSaved:30}]}
    }});
    assert.equal(saved.status,200);
    assert.deepEqual(saved.json().saved,{skills:1,experience:0,solutions:1});
    const duplicate=await client.request('/api/share',{method:'POST',json:{
      text:'I have experience with Salesforce data quality.',
      analysis:{headline:'Existing expertise',summary:'Review it',skills:[' salesforce   DATA quality '],experience:[],solutions:[]}
    }});
    assert.equal(duplicate.status,200);
    assert.equal(duplicate.json().saved.skills,0);
    const overview=(await client.request('/api/overview')).json();
    assert.match(overview.people.find(person=>person.id===persona.id).skills,/Salesforce data quality/);
    assert.equal(overview.solutions.find(solution=>solution.title==='HTTP Test Duplicate Finder').owner,'Mia Novak');
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
