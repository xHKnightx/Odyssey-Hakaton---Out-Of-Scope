import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
await mkdir(join(root, 'data'), { recursive: true });
const db = new DatabaseSync(join(root, 'data', 'pythia.db'));
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, title TEXT, team TEXT, skills TEXT, honorific TEXT);
CREATE TABLE IF NOT EXISTS solutions(id INTEGER PRIMARY KEY, title TEXT NOT NULL, kind TEXT, summary TEXT, owner_id INTEGER REFERENCES users(id), minutes_saved INTEGER DEFAULT 20, runnable INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, text TEXT NOT NULL, user_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, solution_id INTEGER REFERENCES solutions(id), user_id INTEGER REFERENCES users(id), request_id INTEGER REFERENCES requests(id), result TEXT, feedback TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS contributions(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wisdom_events(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL, points INTEGER NOT NULL, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (!count) {
  const user = db.prepare('INSERT INTO users(name,title,team,skills,honorific) VALUES(?,?,?,?,?)');
  user.run('Anastasia Volkov', 'Transformation Lead', 'Operations', 'Change management, facilitation', 'Reader of Contracts');
  user.run('Priya Nair', 'Data & Automation Lead', 'Finance', 'Analytics, automation, calendar design', 'Keeper of the Data');
  user.run('Daniel Ortiz', 'Senior Analyst', 'Finance', 'Power BI, SQL, reporting', 'Guardian of the Ledger');
  user.run('Mia Novak', 'People Partner', 'People', 'Wellbeing, coaching, facilitation', '');
  const sol = db.prepare('INSERT INTO solutions(title,kind,summary,owner_id,minutes_saved,runnable) VALUES(?,?,?,?,?,?)');
  sol.run('Calendar Breather', 'agent', 'Finds the most demanding blocks in your week and proposes short recovery breaks between meetings.', 2, 20, 1);
  sol.run('Finance Data Quality Checklist', 'guide', 'A practical checklist for validating monthly finance exports before they reach reporting.', 3, 35, 0);
  sol.run('Contract Review Companion', 'skill', 'A repeatable first-pass review workflow for finding renewal dates, obligations, and unusual clauses.', 1, 45, 0);
  const req = db.prepare('INSERT INTO requests(text,user_id) VALUES(?,?)');
  req.run('My calendar is wall-to-wall client calls and I have no time to think between meetings.', 1);
  req.run('How can I catch errors in monthly finance exports faster?', 4);
  req.run('I need a consistent way to find renewal dates in supplier contracts.', 1);
  const event = db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note) VALUES(?,?,?,?)');
  event.run(2, 'shared', 10, 'Shared Calendar Breather'); event.run(3, 'shared', 10, 'Shared Finance Data Quality Checklist');
  event.run(2, 'solution_run', 5, 'Calendar Breather used by a colleague'); event.run(3, 'helped', 20, 'Helped a colleague validate a report');
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const json = (res, code, value) => { res.writeHead(code, { 'content-type':'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req) { let raw=''; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {}; }
const all = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/overview') {
      const people = all(`SELECT u.*, COALESCE(SUM(w.points),0) points FROM users u LEFT JOIN wisdom_events w ON w.user_id=u.id GROUP BY u.id ORDER BY points DESC`);
      return json(res, 200, { people, solutions: all('SELECT s.*,u.name owner FROM solutions s JOIN users u ON u.id=s.owner_id ORDER BY s.id'), requests: all('SELECT r.*,u.name asker FROM requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC'), events: all('SELECT w.*,u.name FROM wisdom_events w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 10'), runs: all('SELECT r.*,s.title solution,u.name FROM runs r JOIN solutions s ON s.id=r.solution_id JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 6') });
    }
    if (req.method === 'POST' && url.pathname === '/api/seek') {
      const b = await body(req); const text = String(b.text || '').trim(); if (!text) return json(res,400,{error:'Enter a question first.'});
      const inserted = db.prepare('INSERT INTO requests(text,user_id) VALUES(?,1)').run(text);
      const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>3);
      const candidates = all('SELECT s.*,u.name owner FROM solutions s JOIN users u ON u.id=s.owner_id');
      const scored = candidates.map(s=>({ ...s, score: words.filter(w=>(s.title+' '+s.summary+' '+s.kind).toLowerCase().includes(w)).length })).sort((a,b)=>b.score-a.score);
      const best = scored[0] || candidates[0];
      db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note) VALUES(1,?,?,?)').run('sought',2,'Asked PYTHIA for help');
      return json(res,200,{requestId:Number(inserted.lastInsertRowid),text,solution:best,match:Math.min(96,Math.max(72,78+best.score*6)),recommendation:best.runnable?'Run a proven solution':'Start with this shared resource',peers:all('SELECT name,team,honorific FROM users WHERE id<>1 LIMIT 3')});
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const b=await body(req); const s=one('SELECT * FROM solutions WHERE id=? AND runnable=1',Number(b.solutionId)); if(!s) return json(res,404,{error:'Runnable solution not found.'});
      const result={source:'Local demo data',steps:[{title:'Read your next five days',detail:'23 meetings found in the seeded calendar.'},{title:'Review recent meeting context',detail:'Found notes from two client meetings.'},{title:'Find recovery time',detail:'Identified four suitable gaps for short breaks.'}],breaks:['Monday · 11:30 · 15 min','Tuesday · 14:00 · 25 min','Wednesday · 10:45 · 15 min','Thursday · 15:15 · 20 min']};
      const ins=db.prepare('INSERT INTO runs(solution_id,user_id,request_id,result) VALUES(?,1,?,?)').run(s.id,b.requestId||null,JSON.stringify(result));
      db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note) VALUES(?,?,?,?)').run(s.owner_id,'solution_run',5,`${s.title} used by a colleague`);
      return json(res,200,{id:Number(ins.lastInsertRowid),solution:s,result});
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/feedback')) {
      const id=Number(url.pathname.split('/')[3]); const b=await body(req); const run=one('SELECT * FROM runs WHERE id=?',id); if(!run)return json(res,404,{error:'Run not found.'});
      db.prepare('UPDATE runs SET feedback=? WHERE id=?').run(String(b.feedback),id);
      if(b.feedback==='helped') db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note) VALUES(?,?,?,?)').run(one('SELECT owner_id FROM solutions WHERE id=?',run.solution_id).owner_id,'helped',10,'A colleague said the run helped');
      if(b.thanks) db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note) VALUES(?,?,?,?)').run(one('SELECT owner_id FROM solutions WHERE id=?',run.solution_id).owner_id,'thanked',5,String(b.thanks).slice(0,180));
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/share'){
      const b=await body(req), title=String(b.title||'').trim(), text=String(b.body||'').trim(); if(!title||!text)return json(res,400,{error:'Add a title and a short description.'});
      const id=db.prepare('INSERT INTO contributions(user_id,title,body) VALUES(1,?,?)').run(title,text).lastInsertRowid;
      db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note) VALUES(1,?,?,?)').run('shared',10,`Shared ${title}`);
      return json(res,200,{ok:true,id});
    }
    return json(res,404,{error:'API route not found.'});
  }
  const rel=normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '') || 'index.html';
  if(rel.includes('..')) return json(res,403,{error:'Forbidden'});
  const path=join(root,'public',rel);
  if(!existsSync(path)) return json(res,404,{error:'Not found'});
  try { const data=await readFile(path); res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'}); res.end(data); }
  catch { json(res,404,{error:'Not found'}); }
}

createServer((req,res)=>route(req,res).catch(err=>{console.error(err);json(res,500,{error:'Something went wrong.'});})).listen(port,'127.0.0.1',()=>console.log(`PYTHIA running at http://localhost:${port}`));
