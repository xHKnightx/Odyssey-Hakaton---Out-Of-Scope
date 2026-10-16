import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { backfillRequestOutcomes, buildDiscoveries, discoveriesFor, ensureDiscoverySchema, recordOutcome } from '../lib/discoveries.mjs';
import { signInAs, startApp } from './helpers/app.mjs';

const NOW = new Date('2026-10-16T12:00:00Z');
const ago = days => new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

const solutions = [
  { id: 1, title: 'Calendar Breather', kind: 'agent', runnable: 1 },
  { id: 2, title: 'Contract Clause Extractor', kind: 'skill', runnable: 0 },
  { id: 3, title: 'Access Request Helper', kind: 'tool', runnable: 0 },
  { id: 4, title: 'SAP Export Cleaner', kind: 'automation', runnable: 0 },
  { id: 5, title: 'Data Platform Runbooks', kind: 'knowledge', runnable: 0 }
];
const people = [{ id: 1, skills: 'SQL, Power BI' }, { id: 2, skills: 'sql,  Facilitation' }, { id: 3, skills: '' }];

let nextId = 1;
const request = (text, userId, extra = {}) => ({ id: nextId++, text, user_id: userId, created_at: ago(1), outcome: 'build', solution_id: null, turn: 1, ...extra });
const solved = (text, userId, solutionId, extra = {}) => request(text, userId, { outcome: 'solution', solution_id: solutionId, ...extra });

describe('buildDiscoveries', () => {
  it('counts solved and unsolved requests and ignores follow-up turns', () => {
    const requests = [
      solved('Back-to-back meetings all day', 1, 1),
      request('Onboarding plan for a new analyst', 2),
      request('Who can review my Power BI model?', 3, { outcome: 'person' }),
      request('thanks, and what about Friday?', 1, { turn: 2, outcome: 'build' })
    ];
    const { totals } = buildDiscoveries({ requests, solutions, people, now: NOW });
    assert.deepEqual({ requests: totals.requests, solved: totals.solved, open: totals.open, solvedShare: totals.solvedShare, askers: totals.askers }, { requests: 3, solved: 2, open: 1, solvedShare: 67, askers: 3 });
  });

  it('filters by period and falls back to 30 days for an unknown one', () => {
    const requests = [request('Fresh question about calendars', 1, { created_at: ago(2) }), request('Month old question about onboarding', 2, { created_at: ago(20) }), request('Ancient question about expenses', 3, { created_at: ago(90) })];
    const count = period => buildDiscoveries({ requests, solutions, people, now: NOW, period }).totals.requests;
    assert.equal(count('7d'), 1);
    assert.equal(count('30d'), 2);
    assert.equal(count('all'), 3);
    assert.equal(count('whenever'), 2);
    assert.equal(buildDiscoveries({ requests, solutions, people, now: NOW, period: 'whenever' }).period, '30d');
  });

  it('groups requests answered by the same solution, whatever their wording', () => {
    const requests = [
      solved('My calendar is wall-to-wall client calls', 1, 1),
      solved('Можно ли находить окна для коротких перерывов?', 2, 1),
      solved('Need small gaps between meetings', 3, 1),
      solved('Extract payment terms from contracts', 1, 2)
    ];
    const { topRequests } = buildDiscoveries({ requests, solutions, people, now: NOW });
    assert.equal(topRequests[0].title, 'Calendar Breather');
    assert.equal(topRequests[0].count, 3);
    assert.equal(topRequests[0].status, 'solution');
    assert.equal(topRequests[0].stage, 'opportunity');
    assert.equal(topRequests[0].share, 75);
    assert.equal(topRequests[1].stage, 'emerging');
  });

  it('clusters unanswered requests by shared terms and never mixes them with colleague answers', () => {
    const requests = [
      request('Turn weekly team meeting notes into a Confluence page with action items', 1),
      request('Write up action items automatically after every project sync', 2),
      request('Meeting notes and action items from the Teams call', 3),
      request('Who knows meeting notes tooling and action items?', 1, { outcome: 'person' }),
      request('Compare vendor proposals against evaluation criteria', 2)
    ];
    const { topRequests, gaps } = buildDiscoveries({ requests, solutions, people, now: NOW });
    const gap = gaps[0];
    assert.equal(gap.count, 3);
    assert.equal(gap.status, 'gap');
    assert.equal(gap.open, 3);
    assert.equal(topRequests.filter(cluster => cluster.status === 'person').length, 1);
    assert.ok(gaps.every(cluster => cluster.status === 'gap'));
  });

  it('only quotes free text when several colleagues asked, and never exposes who asked', () => {
    const requests = [
      request('Reuse earlier RFP answers for a new questionnaire', 1),
      request('Answer security questionnaires from earlier RFP responses', 2),
      request('Totally unique question about forklift certification', 3)
    ];
    const result = buildDiscoveries({ requests, solutions, people, now: NOW });
    const shared = result.topRequests.find(cluster => cluster.askers === 2);
    const lone = result.topRequests.find(cluster => cluster.askers === 1);
    assert.equal(shared.examples.length, 2);
    assert.deepEqual(lone.examples, []);
    assert.match(lone.title, /^Topic: /);
    assert.doesNotMatch(lone.title, /forklift certification/);
    assert.doesNotMatch(JSON.stringify(result), /user_?id|userId/);
  });

  it('reports confirmed help from runs rated "helped"', () => {
    const requests = [solved('Calendar help please', 1, 1, { id: 100 }), solved('More calendar help', 2, 1, { id: 101 })];
    const runs = [{ request_id: 100, feedback: 'helped' }, { request_id: 101, feedback: 'no' }, { request_id: null, feedback: 'helped' }];
    const result = buildDiscoveries({ requests, solutions, people, runs, now: NOW });
    assert.equal(result.totals.confirmed, 1);
    assert.equal(result.topRequests[0].confirmed, 1);
  });

  it('summarises the catalogue: skills, apps and expertise areas', () => {
    const { catalogue } = buildDiscoveries({ solutions, people, now: NOW });
    assert.deepEqual(catalogue, { skills: 1, apps: 3, knowledge: 1, runnable: 1, expertiseAreas: 3, people: 3 });
  });

  it('copes with an empty database', () => {
    const result = buildDiscoveries({ now: NOW });
    assert.deepEqual(result.totals, { requests: 0, solved: 0, open: 0, solvedShare: 0, confirmed: 0, askers: 0 });
    assert.deepEqual(result.topRequests, []);
    assert.deepEqual(result.gaps, []);
  });
});

const database = () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, title TEXT, team TEXT, skills TEXT, experience TEXT);
    CREATE TABLE solutions(id INTEGER PRIMARY KEY, title TEXT, kind TEXT, summary TEXT, owner_id INTEGER, runnable INTEGER DEFAULT 0);
    CREATE TABLE requests(id INTEGER PRIMARY KEY, text TEXT NOT NULL, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved INTEGER DEFAULT 0);
    CREATE TABLE runs(id INTEGER PRIMARY KEY, solution_id INTEGER, user_id INTEGER, request_id INTEGER, feedback TEXT);
    INSERT INTO users(id,name,title,team,skills,experience) VALUES (1,'Priya','Data Lead','Finance','Analytics, calendar design',''),(2,'Daniel','Analyst','Finance','Power BI, SQL','');
    INSERT INTO solutions(id,title,kind,summary,owner_id,runnable) VALUES (1,'Calendar Breather','agent','Finds demanding calendar blocks and proposes recovery breaks between meetings.',1,1);`);
  return db;
};

describe('outcome storage', () => {
  it('adds the columns once and keeps existing rows', () => {
    const db = database();
    db.prepare("INSERT INTO requests(text,user_id) VALUES('old',1)").run();
    ensureDiscoverySchema(db);
    ensureDiscoverySchema(db);
    const row = db.prepare('SELECT * FROM requests').get();
    assert.equal(row.text, 'old');
    assert.equal(row.turn, 1);
    assert.equal(row.outcome, null);
  });

  it('records what Oracle answered and flags solved requests', () => {
    const db = database();
    ensureDiscoverySchema(db);
    const add = text => Number(db.prepare('INSERT INTO requests(text,user_id) VALUES(?,1)').run(text).lastInsertRowid);
    const [a, b, c] = [add('a'), add('b'), add('c')];
    recordOutcome(db, { requestId: a, userId: 1, recommendation: { type: 'solution', solutionId: 1 } });
    recordOutcome(db, { requestId: b, userId: 1, recommendation: { type: 'person' } });
    recordOutcome(db, { requestId: c, userId: 1, recommendation: { type: 'build' } });
    const rows = Object.fromEntries(db.prepare('SELECT id,outcome,solution_id,resolved FROM requests').all().map(row => [row.id, row]));
    assert.deepEqual([rows[a].outcome, rows[a].solution_id, rows[a].resolved], ['solution', 1, 1]);
    assert.deepEqual([rows[b].outcome, rows[b].solution_id, rows[b].resolved], ['person', null, 1]);
    assert.deepEqual([rows[c].outcome, rows[c].solution_id, rows[c].resolved], ['build', null, 0]);
  });

  it('lets a follow-up improve the first request of the conversation, never worsen it', () => {
    const db = database();
    ensureDiscoverySchema(db);
    const add = () => Number(db.prepare("INSERT INTO requests(text,user_id,created_at) VALUES('q',1,datetime('now'))").run().lastInsertRowid);
    const first = add();
    recordOutcome(db, { requestId: first, userId: 1, recommendation: { type: 'build' } });
    const second = add();
    recordOutcome(db, { requestId: second, userId: 1, turn: 2, recommendation: { type: 'solution', solutionId: 1 } });
    assert.deepEqual({ ...db.prepare('SELECT outcome,solution_id,resolved FROM requests WHERE id=?').get(first) }, { outcome: 'solution', solution_id: 1, resolved: 1 });
    assert.equal(db.prepare('SELECT turn FROM requests WHERE id=?').get(second).turn, 2);
    const third = add();
    recordOutcome(db, { requestId: third, userId: 1, turn: 3, recommendation: { type: 'build' } });
    assert.equal(db.prepare('SELECT outcome FROM requests WHERE id=?').get(first).outcome, 'solution');
  });

  it('does not touch another person’s conversation', () => {
    const db = database();
    ensureDiscoverySchema(db);
    const first = Number(db.prepare("INSERT INTO requests(text,user_id,created_at) VALUES('q',2,datetime('now'))").run().lastInsertRowid);
    recordOutcome(db, { requestId: first, userId: 2, recommendation: { type: 'build' } });
    const followUp = Number(db.prepare("INSERT INTO requests(text,user_id,created_at) VALUES('q2',1,datetime('now'))").run().lastInsertRowid);
    recordOutcome(db, { requestId: followUp, userId: 1, turn: 2, recommendation: { type: 'solution', solutionId: 1 } });
    assert.equal(db.prepare('SELECT outcome FROM requests WHERE id=?').get(first).outcome, 'build');
  });

  it('estimates outcomes for requests stored before this feature, with a stricter bar than one shared word', () => {
    const db = database();
    ensureDiscoverySchema(db);
    const add = text => Number(db.prepare('INSERT INTO requests(text,user_id) VALUES(?,2)').run(text).lastInsertRowid);
    const strong = add('Recovery breaks between meetings in my calendar');
    const weak = add('Something about breaks');
    const person = add('Who has Power BI and SQL experience?');
    const nothing = add('Forklift certification renewal');
    assert.equal(backfillRequestOutcomes(db), 4);
    const outcome = id => ({ ...db.prepare('SELECT outcome,solution_id,resolved FROM requests WHERE id=?').get(id) });
    assert.deepEqual(outcome(strong), { outcome: 'solution', solution_id: 1, resolved: 1 });
    assert.equal(outcome(weak).outcome, 'build');
    assert.equal(outcome(person).outcome, 'person');
    assert.equal(outcome(nothing).outcome, 'build');
    assert.equal(backfillRequestOutcomes(db), 0);
  });

  it('reads everything it needs from SQLite', () => {
    const db = database();
    ensureDiscoverySchema(db);
    const id = Number(db.prepare("INSERT INTO requests(text,user_id) VALUES('Recovery breaks between meetings in my calendar',2)").run().lastInsertRowid);
    recordOutcome(db, { requestId: id, userId: 2, recommendation: { type: 'solution', solutionId: 1 } });
    db.prepare("INSERT INTO runs(solution_id,user_id,request_id,feedback) VALUES(1,2,?, 'helped')").run(id);
    const result = discoveriesFor(db, { period: 'all' });
    assert.equal(result.totals.requests, 1);
    assert.equal(result.totals.confirmed, 1);
    assert.equal(result.topRequests[0].title, 'Calendar Breather');
  });
});

describe('GET /api/discoveries', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app.stop(); });

  it('requires a session', async () => {
    assert.equal((await app.client().request('/api/discoveries')).status, 401);
  });

  it('returns the seeded demo statistics for each period', async () => {
    const { client } = await signInAs(app, 'Priya Nair');
    const get = async period => (await client.request(`/api/discoveries${period ? `?period=${period}` : ''}`)).json();
    const [week, month, all, fallback] = [await get('7d'), await get('30d'), await get('all'), await get('forever')];
    assert.ok(week.totals.requests > 0 && week.totals.requests < month.totals.requests);
    assert.ok(month.totals.requests < all.totals.requests);
    assert.equal(fallback.period, '30d');
    assert.equal((await get()).period, '30d');
    assert.equal(all.totals.solved + all.totals.open, all.totals.requests);
    assert.equal(all.topRequests[0].title, 'Calendar Breather');
    assert.ok(all.gaps.length > 0 && all.gaps.every(cluster => cluster.status === 'gap'));
    assert.ok(all.catalogue.skills >= 2 && all.catalogue.apps >= 4);
    assert.doesNotMatch(JSON.stringify(all), /user_?id|userId|Priya|Daniel Ortiz/);
  });

  it('counts a new Oracle question with the outcome Oracle gave it', async () => {
    const { client } = await signInAs(app, 'Daniel Ortiz');
    const before = (await client.request('/api/discoveries?period=all')).json().totals;
    const chat = await client.request('/api/oracle/chat', { method: 'POST', json: { messages: [{ role: 'user', content: 'Forklift certification renewal reminders' }] } });
    assert.equal(chat.status, 200);
    const after = (await client.request('/api/discoveries?period=all')).json().totals;
    assert.equal(after.requests, before.requests + 1);
    assert.equal(after.solved + after.open, after.requests);
    const followUp = await client.request('/api/oracle/chat', { method: 'POST', json: { messages: [{ role: 'user', content: 'Forklift certification renewal reminders' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'and for next year?' }] } });
    assert.equal(followUp.status, 200);
    assert.equal((await client.request('/api/discoveries?period=all')).json().totals.requests, after.requests);
  });
});
