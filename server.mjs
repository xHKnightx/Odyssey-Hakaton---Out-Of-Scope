import { createServer } from 'node:http';
import { readFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { GOOGLE_SCOPES, googleConfigured, googleRedirectUri, googleAuthorizationUrl, exchangeGoogleCode, readGoogleToken, removeGoogleToken, googleApi } from './lib/google.mjs';
import { analyzeCalendar, makeDemoCalendar } from './lib/calendar.mjs';
import { createGamification } from './lib/gamification.mjs';
import { createAuth } from './lib/auth/index.mjs';
import { currentUser } from './lib/auth/context.mjs';
import { saveOwnProfile } from './lib/auth/profile.mjs';
import { consultOracle, oracleStatus } from './lib/oracle.mjs';
import { createRetrieval } from './lib/retrieval.mjs';
import { analyzeProfile, analyzeWisdom, validateWisdomAnalysis } from './lib/wisdom.mjs';
import { expertiseKey, normalizeExpertiseAreas } from './lib/expertise.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
for (const envFile of ['.env', '.env.local']) {
  try {
    const envText = await readFile(join(root, envFile), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(join(root, 'data'), { recursive: true });
const db = new DatabaseSync(join(root, 'data', 'pythia.db'));
const all = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, title TEXT, team TEXT, skills TEXT, honorific TEXT);
CREATE TABLE IF NOT EXISTS solutions(id INTEGER PRIMARY KEY, title TEXT NOT NULL, kind TEXT, summary TEXT, owner_id INTEGER REFERENCES users(id), minutes_saved INTEGER DEFAULT 20, runnable INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, text TEXT NOT NULL, user_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, solution_id INTEGER REFERENCES solutions(id), user_id INTEGER REFERENCES users(id), request_id INTEGER REFERENCES requests(id), result TEXT, feedback TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS contributions(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wisdom_events(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL, points INTEGER NOT NULL, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS calendar_proposals(id INTEGER PRIMARY KEY, run_id INTEGER REFERENCES runs(id), start_at TEXT NOT NULL, end_at TEXT NOT NULL, timezone TEXT NOT NULL, title TEXT NOT NULL, reason TEXT, status TEXT DEFAULT 'proposed', external_event_id TEXT);
CREATE TABLE IF NOT EXISTS pantheon_seed(user_id INTEGER PRIMARY KEY REFERENCES users(id), title TEXT NOT NULL, shared INTEGER NOT NULL, helped INTEGER NOT NULL, hours INTEGER NOT NULL, deed TEXT, rank INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gratitude_seed(id INTEGER PRIMARY KEY, from_user_id INTEGER REFERENCES users(id), to_user_id INTEGER REFERENCES users(id), note TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
for (const [name,type] of [['initials','TEXT'],['color','TEXT'],['location','TEXT'],['availability','TEXT'],['experience','TEXT']]) if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
const wisdomColumns = new Set(db.prepare('PRAGMA table_info(wisdom_events)').all().map(c => c.name));
for (const [name,type] of [['actor_id','INTEGER'],['reference_id','INTEGER'],['impact_minutes','INTEGER NOT NULL DEFAULT 0']]) if (!wisdomColumns.has(name)) db.exec(`ALTER TABLE wisdom_events ADD COLUMN ${name} ${type}`);
const auth = createAuth(db);
const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (!count) {
  const user = db.prepare('INSERT INTO users(name,title,team,skills,honorific) VALUES(?,?,?,?,?)');
  user.run('Anastasia Volkov', 'Transformation Lead', 'Operations', normalizeExpertiseAreas('Change management, facilitation').join(', '), 'Reader of Contracts');
  user.run('Priya Nair', 'Data & Automation Lead', 'Finance', normalizeExpertiseAreas('Analytics, automation, calendar design').join(', '), 'Keeper of the Data');
  user.run('Daniel Ortiz', 'Senior Analyst', 'Finance', normalizeExpertiseAreas('Power BI, SQL, reporting').join(', '), 'Guardian of the Ledger');
  user.run('Mia Novak', 'People Partner', 'People', normalizeExpertiseAreas('Wellbeing, coaching, facilitation').join(', '), '');
  const sol = db.prepare('INSERT INTO solutions(title,kind,summary,owner_id,minutes_saved,runnable) VALUES(?,?,?,?,?,?)');
  sol.run('Calendar Breather', 'agent', 'Finds the most demanding blocks in your week and proposes short recovery breaks between meetings.', 2, 20, 1);
  sol.run('Finance Data Quality Checklist', 'guide', 'A practical checklist for validating monthly finance exports before they reach reporting.', 3, 35, 0);
  sol.run('Contract Review Companion', 'skill', 'A repeatable first-pass review workflow for finding renewal dates, obligations, and unusual clauses.', 1, 45, 0);
  const req = db.prepare('INSERT INTO requests(text,user_id) VALUES(?,?)');
  req.run('My calendar is wall-to-wall client calls and I have no time to think between meetings.', 1);
  req.run('How can I catch errors in monthly finance exports faster?', 4);
  req.run('I need a consistent way to find renewal dates in supplier contracts.', 1);
}

const mockupSeed = JSON.parse(await readFile(join(root, 'seed', 'mockup-seed.json'), 'utf8'));
if (one('SELECT value FROM app_meta WHERE key=?', 'mockup_seed_version')?.value !== mockupSeed.version) {
  const honorifics = new Map(mockupSeed.pantheon.map(p => [p.person, p.title]));
  const personIds = {};
  for (const person of mockupSeed.people) {
    const old = person.key === 'anastasia' ? one('SELECT id FROM users WHERE id=1') : one('SELECT id FROM users WHERE name=?', person.name);
    const values = [person.name, person.role, person.team, normalizeExpertiseAreas(person.skills).join(', '), honorifics.get(person.key) || '', person.initials, person.color, person.location, person.availability, person.experience || ''];
    if (old) {
      db.prepare('UPDATE users SET name=?,title=?,team=?,skills=?,honorific=?,initials=?,color=?,location=?,availability=?,experience=? WHERE id=?').run(...values, old.id);
      personIds[person.key] = old.id;
    } else {
      const result = db.prepare('INSERT INTO users(name,title,team,skills,honorific,initials,color,location,availability,experience) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...values);
      personIds[person.key] = Number(result.lastInsertRowid);
    }
  }
  for (const s of mockupSeed.solutions) {
    const exists = one('SELECT id FROM solutions WHERE title=?', s.title);
    if (exists) db.prepare('UPDATE solutions SET kind=?,summary=?,owner_id=?,minutes_saved=?,runnable=? WHERE id=?').run(s.kind,s.summary,personIds[s.owner],s.minutesSaved,s.runnable,exists.id);
    else db.prepare('INSERT INTO solutions(title,kind,summary,owner_id,minutes_saved,runnable) VALUES(?,?,?,?,?,?)').run(s.title,s.kind,s.summary,personIds[s.owner],s.minutesSaved,s.runnable);
  }
  for (const r of mockupSeed.requests) if (!one('SELECT id FROM requests WHERE text=?',r.text)) db.prepare('INSERT INTO requests(text,user_id) VALUES(?,?)').run(r.text,personIds[r.asker]);
  for (const h of mockupSeed.pantheon) db.prepare('INSERT INTO pantheon_seed(user_id,title,shared,helped,hours,deed,rank) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET title=excluded.title,shared=excluded.shared,helped=excluded.helped,hours=excluded.hours,deed=excluded.deed,rank=excluded.rank').run(personIds[h.person],h.title,h.shared,h.helped,h.hours,h.deed,h.rank);
  if (!one('SELECT id FROM gratitude_seed LIMIT 1')) for (const g of mockupSeed.gratitude) db.prepare('INSERT INTO gratitude_seed(from_user_id,to_user_id,note) VALUES(?,?,?)').run(personIds[g.from],personIds[g.to],g.note);
  db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('mockup_seed_version',mockupSeed.version);
  console.log(`Loaded ${mockupSeed.people.length} mockup people and ${mockupSeed.solutions.length} mockup solutions.`);
}

if (!one('SELECT value FROM app_meta WHERE key=?','expertise_normalization_v1')) {
  const updateExpertise=db.prepare('UPDATE users SET skills=? WHERE id=?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const user of all('SELECT id,skills FROM users'))updateExpertise.run(normalizeExpertiseAreas(user.skills).join(', '),user.id);
    db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run('expertise_normalization_v1','case-and-whitespace');
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

if (!one('SELECT value FROM app_meta WHERE key=?','gamification_history_v1')) {
  const insertHistory=db.prepare('INSERT INTO wisdom_events(user_id,kind,points,note,actor_id,impact_minutes) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const legacy of mockupSeed.pantheon){
      const person=mockupSeed.people.find(p=>p.key===legacy.person),user=one('SELECT id FROM users WHERE name=?',person.name);
      for(let i=0;i<legacy.shared;i++) insertHistory.run(user.id,'shared',10,'Imported mockup demo offering',user.id,0);
      for(let i=0;i<legacy.helped;i++) insertHistory.run(user.id,'helped',20,'Imported mockup demo help history',user.id,0);
      if(legacy.hours) insertHistory.run(user.id,'legacy_impact',0,'Imported mockup demo impact history',user.id,legacy.hours*60);
    }
    db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run('gamification_history_v1','imported');
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
const gamification=createGamification(db);
const retrieval=createRetrieval(db);
if (!one('SELECT value FROM app_meta WHERE key=?','gamification_bootstrap_dedupe_v1')) {
  db.prepare("DELETE FROM wisdom_events WHERE (kind='shared' AND note IN ('Shared Calendar Breather','Shared Finance Data Quality Checklist')) OR (kind='solution_run' AND note='Calendar Breather used by a colleague') OR (kind='helped' AND note='Helped a colleague validate a report')").run();
  db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run('gamification_bootstrap_dedupe_v1','done');
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
const json = (res, code, value) => { res.writeHead(code, { 'content-type':'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req) { let raw=''; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {}; }
const oauthStates = new Map();
const redirect = (res, location) => { res.writeHead(302, { location }); res.end(); };
const resolveUserId = () => currentUser()?.id ?? null; // the actor is the signed-in user; any userId sent by the client is ignored
function roman(value){let number=value,output='';for(const [n,symbol] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(number>=n){output+=symbol;number-=n}return output||'I'}
function pantheonRows(period='q'){
  const periodClause=period==='m'?"date(w.created_at)>=date('now','start of month')":period==='q'?"date(w.created_at)>=date('now','start of year',printf('+%d months',((cast(strftime('%m','now') as integer)-1)/3)*3))":'1=1';
  return all(`SELECT u.id,u.name,u.title role,u.team,u.initials,u.color,u.honorific title,
    COALESCE(SUM(CASE WHEN ${periodClause} THEN w.points ELSE 0 END),0) points,
    COALESCE(SUM(CASE WHEN ${periodClause} AND w.kind='shared' THEN 1 ELSE 0 END),0) shared,
    COALESCE(SUM(CASE WHEN ${periodClause} AND w.kind='helped' THEN 1 ELSE 0 END),0) helped,
    CAST(COALESCE(SUM(CASE WHEN ${periodClause} THEN w.impact_minutes ELSE 0 END),0)/60 AS INTEGER) hours,
    p.deed
    FROM users u LEFT JOIN wisdom_events w ON w.user_id=u.id LEFT JOIN pantheon_seed p ON p.user_id=u.id
    GROUP BY u.id HAVING points>0 ORDER BY points DESC,u.name`).map((row,index)=>({...row,rank:index+1,title:row.title||gamification.progression(row.points).level,deed:row.deed||`${row.shared} offerings shared · ${row.helped} colleagues helped`}));
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/auth/google') {
    if (!googleConfigured()) return redirect(res, '/?connect=missing#connections');
    const state = randomBytes(32).toString('hex');
    oauthStates.set(state, Date.now());
    return redirect(res, googleAuthorizationUrl(state));
  }
  if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
    const state = url.searchParams.get('state');
    const created = oauthStates.get(state);
    oauthStates.delete(state);
    if (!created || Date.now() - created > 10 * 60_000) return redirect(res, '/?google_error=expired_state#connections');
    if (url.searchParams.has('error')) return redirect(res, `/?google_error=${encodeURIComponent(url.searchParams.get('error'))}#connections`);
    try { await exchangeGoogleCode(url.searchParams.get('code')); return redirect(res, '/?google=connected#connections'); }
    catch (error) { console.error('Google OAuth callback failed:', error.message); return redirect(res, `/?google_error=${encodeURIComponent(error.message)}#connections`); }
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/oracle/status') {
      return json(res, 200, {...oracleStatus(),retrieval:{mode:retrieval.configured()?'hybrid':'exact',embeddingModel:retrieval.model()}});
    }
    if (req.method === 'POST' && url.pathname === '/api/oracle/chat') {
      const b=await body(req),userId=resolveUserId(b.userId);
      if(!userId)return json(res,400,{error:'A valid profile is required.'});
      const messages=(Array.isArray(b.messages)?b.messages:[]).slice(-12);
      const text=String([...messages].reverse().find(message=>message?.role==='user')?.content||'').trim();
      if(!text)return json(res,400,{error:'Enter a question first.'});
      if(text.length>4000)return json(res,400,{error:'Keep each Oracle message under 4,000 characters.'});
      const user=one('SELECT id,name,title,team,skills FROM users WHERE id=?',userId);
      const candidates=await retrieval.search(text,{peopleLimit:5,solutionLimit:5,excludeUserId:userId});
      const solutions=candidates.solutions,people=candidates.people;
      const inserted=db.prepare('INSERT INTO requests(text,user_id) VALUES(?,?)').run(text,userId);
      const requestId=Number(inserted.lastInsertRowid),award=gamification.rewardSeek(userId,requestId);
      const result=await consultOracle({messages,solutions,people,user});
      const solution=result.recommendation.solutionId?solutions.find(item=>item.id===result.recommendation.solutionId)||null:null;
      const recommendedPeople=(result.recommendation.peopleIds||[]).map(id=>people.find(item=>item.id===id)).filter(Boolean);
      return json(res,200,{...result,requestId,award,solution,people:recommendedPeople,retrieval:{mode:candidates.mode,fallbackReason:candidates.fallbackReason,solutionCandidates:solutions.length,peopleCandidates:people.length,embeddingModel:retrieval.model()},status:oracleStatus()});
    }
    if (req.method === 'POST' && url.pathname === '/api/share/analyze') {
      const b=await body(req),userId=resolveUserId(b.userId),text=String(b.text||'').trim();
      if(!userId)return json(res,400,{error:'A valid profile is required.'});
      if(!text)return json(res,400,{error:'Describe what you know or what you built first.'});
      if(text.length>4000)return json(res,400,{error:'Keep the contribution under 4,000 characters.'});
      const user=one('SELECT id,title,team,skills FROM users WHERE id=?',userId);
      const catalogue=all('SELECT title,kind,summary FROM solutions ORDER BY id');
      try{return json(res,200,await analyzeWisdom({text,user,catalogue}));}
      catch(error){return json(res,422,{error:error.message});}
    }
    if (req.method === 'POST' && url.pathname === '/api/profile/analyze') {
      const b=await body(req),text=String(b.text||'').trim();
      if(!resolveUserId(b.userId))return json(res,400,{error:'A valid profile is required.'});
      if(!text)return json(res,400,{error:'Tell Pythia what you do and what you know first.'});
      if(text.length>4000)return json(res,400,{error:'Keep the introduction under 4,000 characters.'});
      try{return json(res,200,await analyzeProfile(text));}
      catch(error){return json(res,422,{error:error.message});}
    }
    if (req.method === 'GET' && url.pathname === '/api/google/status') {
      const token = await readGoogleToken();
      return json(res, 200, { configured:googleConfigured(), connected:Boolean(token), email:token?.email||'', name:token?.name||'', redirectUri:googleRedirectUri(), scopes:GOOGLE_SCOPES, grantedScopes:token?.scope||'' });
    }
    if (req.method === 'POST' && url.pathname === '/api/google/disconnect') {
      const token = await readGoogleToken();
      if (token?.refresh_token) fetch(`https://oauth2.googleapis.com/revoke?${new URLSearchParams({token:token.refresh_token})}`, { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'} }).catch(()=>{});
      await removeGoogleToken();
      return json(res, 200, { ok:true });
    }
    if (req.method === 'GET' && url.pathname === '/api/overview') {
      const activeUserId=resolveUserId(url.searchParams.get('userId'));
      if(!activeUserId)return json(res,400,{error:'A valid profile is required.'});
      const period=['m','q','y'].includes(url.searchParams.get('period'))?url.searchParams.get('period'):'q';
      const people=all(`SELECT u.*,COALESCE(SUM(w.points),0) points FROM users u LEFT JOIN wisdom_events w ON w.user_id=u.id GROUP BY u.id ORDER BY points DESC,u.name`).map(person=>({...person,...gamification.progression(person.points)}));
      const pantheon=pantheonRows(period);
      const allTime=pantheonRows('y'),myIndex=allTime.findIndex(person=>person.id===activeUserId),mine=allTime[myIndex]||{points:0,shared:0,helped:0,hours:0};
      const level=gamification.progression(mine.points),active=people.find(person=>person.id===activeUserId);
      const myStanding={rank:roman(myIndex<0?people.length:myIndex+1),position:myIndex<0?people.length:myIndex+1,points:mine.points,level:level.level,nextLevel:level.nextLevel,pointsToNext:level.pointsToNext,progress:level.progress,helped:mine.helped,shared:mine.shared,hours:mine.hours,nudge:activeUserId===1?mockupSeed.myStanding.nudge:(mine.points?'Keep sharing expertise to grow your standing.':'Your profile starts at zero laurels. Ask or share to earn your first points.')};
      const actualGratitude=all(`SELECT w.note,f.name from_name,f.initials from_initials,f.color from_color,t.name to_name,t.initials to_initials,t.color to_color FROM wisdom_events w JOIN users f ON f.id=w.actor_id JOIN users t ON t.id=w.user_id WHERE w.kind='thanked' ORDER BY w.id DESC LIMIT 5`);
      const gratitude=actualGratitude.length?actualGratitude:all('SELECT g.note,f.name from_name,f.initials from_initials,f.color from_color,t.name to_name,t.initials to_initials,t.color to_color FROM gratitude_seed g JOIN users f ON f.id=g.from_user_id JOIN users t ON t.id=g.to_user_id ORDER BY g.id');
      return json(res, 200, { activeUserId,people,pantheon,gratitude,myStanding,mySkills:active?.skills?.split(',').map(s=>s.trim())||[],solutions:all('SELECT s.*,u.name owner FROM solutions s JOIN users u ON u.id=s.owner_id ORDER BY s.id'),requests:all('SELECT r.*,u.name asker FROM requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC'),events:all('SELECT w.*,u.name FROM wisdom_events w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 10'),runs:all('SELECT r.*,s.title solution,u.name FROM runs r JOIN solutions s ON s.id=r.solution_id JOIN users u ON u.id=s.owner_id ORDER BY r.id DESC LIMIT 6') });
    }
    if (req.method === 'POST' && url.pathname === '/api/people') {
      const saved=saveOwnProfile(db,currentUser(),await body(req));
      if(saved.error) return json(res,saved.status,{error:saved.error});
      const searchIndex=await retrieval.indexPerson(saved.person.id).catch(error=>({indexed:0,mode:'exact',error:error.message}));
      return json(res,saved.status,{ok:true,person:saved.person,searchIndex});
    }
    if(req.method==='PATCH'&&url.pathname.startsWith('/api/people/')){
      const id=Number(url.pathname.split('/')[3]),existing=one('SELECT * FROM users WHERE id=?',id);
      if(!existing)return json(res,404,{error:'Colleague profile not found.'});
      if(id!==currentUser()?.id)return json(res,403,{error:'You can only edit your own profile.'});
      const b=await body(req),title=String(b.title??existing.title??'').trim(),team=String(b.team??existing.team??'').trim(),experience=String(b.experience??existing.experience??'').trim();
      const skills=normalizeExpertiseAreas(b.skills==null?existing.skills:b.skills);
      if(!title||!team||!skills.length)return json(res,400,{error:'Role, team, and at least one area of expertise are required.'});
      if(title.length>120||team.length>80||experience.length>1200||skills.length>20||skills.some(skill=>skill.length>60))return json(res,400,{error:'One or more profile fields exceed the allowed length.'});
      db.prepare('UPDATE users SET title=?,team=?,skills=?,experience=?,profile_completed=1 WHERE id=?').run(title,team,skills.join(', '),experience,id);
      const searchIndex=await retrieval.indexPerson(id).catch(error=>({indexed:0,mode:'exact',error:error.message}));
      return json(res,200,{ok:true,person:one('SELECT * FROM users WHERE id=?',id),searchIndex});
    }
    if(req.method==='POST'&&url.pathname==='/api/skills/confirm'){
      const b=await body(req),userId=resolveUserId(b.userId),skill=normalizeExpertiseAreas([b.skill],{limit:1})[0]||'';
      if(!userId)return json(res,400,{error:'A valid profile is required.'});
      if(!skill||skill.length>60)return json(res,400,{error:'Enter an area of expertise under 60 characters.'});
      const user=one('SELECT skills FROM users WHERE id=?',userId),skills=normalizeExpertiseAreas(user.skills);
      if(skills.some(s=>expertiseKey(s)===expertiseKey(skill)))return json(res,200,{ok:true,award:{points:0,reason:'already_on_profile'},skills});
      if(skills.length>=20)return json(res,400,{error:'A profile can contain up to 20 areas of expertise.'});
      const updatedSkills=normalizeExpertiseAreas([...skills,skill]);
      db.exec('BEGIN IMMEDIATE');let award;
      try{db.prepare('UPDATE users SET skills=? WHERE id=?').run(updatedSkills.join(', '),userId);award=gamification.rewardSkillConfirmation(userId,skill);db.exec('COMMIT')}
      catch(error){db.exec('ROLLBACK');throw error}
      const searchIndex=await retrieval.indexPerson(userId).catch(error=>({indexed:0,mode:'exact',error:error.message}));
      return json(res,200,{ok:true,award,skills:updatedSkills,searchIndex});
    }
    if(req.method==='POST'&&url.pathname==='/api/thanks'){
      const b=await body(req),actorId=resolveUserId(b.userId),targetId=Number(b.targetId);
      if(!actorId)return json(res,400,{error:'A valid profile is required.'});
      if(!one('SELECT id FROM users WHERE id=?',targetId))return json(res,404,{error:'Colleague profile not found.'});
      if(actorId===targetId)return json(res,400,{error:'Choose another colleague to thank.'});
      const award=gamification.rewardThanks(actorId,targetId,b.note||'');
      if(award.reason==='pair_weekly_cap'||award.reason==='weekly_cap')return json(res,200,{ok:true,award,message:'This thank-you pair has already earned points this week.'});
      return json(res,200,{ok:true,award});
    }
    if (req.method === 'POST' && url.pathname === '/api/calendar/analysis') {
      try {
        const b=await body(req), days=Math.min(10,Math.max(1,Number(b.days)||5)), lookback=Math.min(90,Math.max(1,Number(b.lookback)||30));
        return json(res,200,await analyzeCalendar({days,lookback,timeZone:String(b.timeZone||'UTC')}));
      } catch(error) { return json(res,502,{error:error.message}); }
    }
    if (req.method === 'POST' && url.pathname === '/api/calendar/invites') {
      try {
        const b=await body(req), runId=Number(b.runId), ids=[...new Set((b.proposalIds||[]).map(Number))].slice(0,10);
        if(one('SELECT user_id FROM runs WHERE id=?',runId)?.user_id!==currentUser()?.id) return json(res,403,{error:'Breaks can only be added from your own run.'});
        if(!ids.length) return json(res,400,{error:'Select at least one proposed break.'});
        const attendees=[...new Set((b.attendees||[]).map(x=>String(x).trim().toLowerCase()).filter(Boolean))];
        if(attendees.length>10||attendees.some(e=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return json(res,400,{error:'Enter up to 10 valid attendee email addresses.'});
        const created=[];
        for(const id of ids){
          const p=one('SELECT * FROM calendar_proposals WHERE id=? AND run_id=?',id,runId);
          if(!p) return json(res,404,{error:'A selected proposal was not found for this run.'});
          if(p.status==='created'){created.push({id:p.id,alreadyCreated:true});continue;}
          const event={summary:p.title,description:`${p.reason||'A recovery break suggested by PYTHIA.'}\n\nCreated from a reviewed Calendar Breather run.`,start:{dateTime:p.start_at,timeZone:p.timezone},end:{dateTime:p.end_at,timeZone:p.timezone},transparency:'opaque',reminders:{useDefault:true}};
          if(attendees.length) event.attendees=attendees.map(email=>({email}));
          const external=await googleApi(`/calendar/v3/calendars/primary/events?sendUpdates=${attendees.length?'all':'none'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)});
          db.prepare('UPDATE calendar_proposals SET status=?,external_event_id=? WHERE id=?').run('created',external.id,p.id);
          created.push({id:p.id,eventId:external.id,htmlLink:external.htmlLink||''});
        }
        return json(res,200,{created,invitees:attendees.length,calendar:'primary'});
      } catch(error) { return json(res,502,{error:error.message}); }
    }
    if (req.method === 'POST' && url.pathname === '/api/seek') {
      const b = await body(req),userId=resolveUserId(b.userId); const text = String(b.text || '').trim(); if(!userId)return json(res,400,{error:'A valid profile is required.'}); if (!text) return json(res,400,{error:'Enter a question first.'});
      const inserted = db.prepare('INSERT INTO requests(text,user_id) VALUES(?,?)').run(text,userId);
      const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>3);
      const candidates = all('SELECT s.*,u.name owner FROM solutions s JOIN users u ON u.id=s.owner_id');
      const scored = candidates.map(s=>({ ...s, score: words.filter(w=>(s.title+' '+s.summary+' '+s.kind).toLowerCase().includes(w)).length })).sort((a,b)=>b.score-a.score);
      const best = scored[0] || candidates[0];
      const award=gamification.rewardSeek(userId,Number(inserted.lastInsertRowid));
      return json(res,200,{requestId:Number(inserted.lastInsertRowid),text,solution:best,match:Math.min(96,Math.max(72,78+best.score*6)),recommendation:best.runnable?'Run a proven solution':'Start with this shared resource',award,peers:all('SELECT name,team,honorific FROM users WHERE id<>? LIMIT 3',userId)});
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const b=await body(req),userId=resolveUserId(b.userId); if(!userId)return json(res,400,{error:'A valid profile is required.'}); const s=one('SELECT * FROM solutions WHERE id=? AND runnable=1',Number(b.solutionId)); if(!s) return json(res,404,{error:'Runnable solution not found.'});
      const connected=Boolean(await readGoogleToken());
      let result;
      try { result=connected?await analyzeCalendar({days:5,lookback:30,timeZone:String(b.timeZone||'UTC')}):makeDemoCalendar(); }
      catch(error) { return json(res,502,{error:error.message}); }
      const summary=JSON.stringify({source:result.source,meetingCount:result.meetingCount,emailCount:result.emailCount,proposalCount:result.proposals.length});
      const ins=db.prepare('INSERT INTO runs(solution_id,user_id,request_id,result) VALUES(?,?,?,?)').run(s.id,userId,b.requestId||null,summary);
      if(connected) for(const p of result.proposals){
        const proposal=db.prepare('INSERT INTO calendar_proposals(run_id,start_at,end_at,timezone,title,reason) VALUES(?,?,?,?,?,?)').run(Number(ins.lastInsertRowid),p.start,p.end,p.timeZone,p.title,p.reason);
        p.id=Number(proposal.lastInsertRowid);
      }
      const award=gamification.rewardSolutionUse(s.id,s.owner_id,userId,s.minutes_saved,Number(ins.lastInsertRowid));
      return json(res,200,{id:Number(ins.lastInsertRowid),solution:s,live:connected,result,award});
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/feedback')) {
      const id=Number(url.pathname.split('/')[3]); const b=await body(req); const run=one('SELECT * FROM runs WHERE id=?',id); if(!run)return json(res,404,{error:'Run not found.'});
      if(Number(run.user_id)!==currentUser()?.id)return json(res,403,{error:'Only the person who ran this solution can rate it.'});
      if(!['helped','somewhat','no'].includes(b.feedback))return json(res,400,{error:'Choose a valid feedback option.'});
      if(run.feedback)return json(res,409,{error:'Feedback was already recorded for this run.'});
      db.prepare('UPDATE runs SET feedback=? WHERE id=?').run(String(b.feedback),id);
      const ownerId=one('SELECT owner_id FROM solutions WHERE id=?',run.solution_id).owner_id,award={};
      if(b.feedback==='helped')award.helped=Number(ownerId)===Number(run.user_id)?{points:0,reason:'own_solution'}:gamification.rewardHelp(ownerId,run.user_id,id);
      if(b.feedback==='helped'&&b.thanks)award.thanks=gamification.rewardThanks(run.user_id,ownerId,String(b.thanks));
      return json(res,200,{ok:true,award});
    }
    if(req.method==='POST'&&url.pathname==='/api/share'){
      const b=await body(req),userId=resolveUserId(b.userId),text=String(b.text||b.body||'').trim();
      if(!userId)return json(res,400,{error:'A valid profile is required.'});
      if(!text||text.length>4000)return json(res,400,{error:'Add a contribution under 4,000 characters.'});
      let analysis;
      try{analysis=validateWisdomAnalysis(b.analysis||b,{sourceText:text});}
      catch(error){return json(res,400,{error:error.message});}
      const user=one('SELECT * FROM users WHERE id=?',userId),existingSkills=normalizeExpertiseAreas(user.skills);
      const skills=normalizeExpertiseAreas([...existingSkills,...analysis.skills],{limit:20});
      const experienceItems=analysis.experience.map(item=>item.details?`${item.title}: ${item.details}`:item.title);
      const existingExperience=String(user.experience||'').trim(),newExperience=experienceItems.filter(item=>!existingExperience.toLowerCase().includes(item.toLowerCase()));
      const experience=[existingExperience,...newExperience].filter(Boolean).join('\n').slice(0,1200);
      const title=analysis.solutions[0]?.title||analysis.skills[0]||analysis.experience[0]?.title||'Shared wisdom';
      const insertedSolutions=[],duplicates=[];let contributionId,award;
      db.exec('BEGIN IMMEDIATE');
      try{
        award=gamification.rewardOffering(userId,title,text);
        contributionId=Number(db.prepare('INSERT INTO contributions(user_id,title,body) VALUES(?,?,?)').run(userId,title,text).lastInsertRowid);
        db.prepare('UPDATE users SET skills=?,experience=? WHERE id=?').run(skills.join(', '),experience,userId);
        const insertSolution=db.prepare('INSERT INTO solutions(title,kind,summary,owner_id,minutes_saved,runnable) VALUES(?,?,?,?,?,?)');
        for(const solution of analysis.solutions){
          const existing=one('SELECT id,title FROM solutions WHERE lower(title)=lower(?)',solution.title);
          if(existing){duplicates.push(existing);continue;}
          // A catalogue record is discoverable immediately, but it is not
          // executable until a real runner/integration is registered for it.
          const result=insertSolution.run(solution.title,solution.kind,solution.summary,userId,solution.minutesSaved,0);
          insertedSolutions.push({...solution,runnable:false,id:Number(result.lastInsertRowid)});
        }
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      const searchIndex={person:await retrieval.indexPerson(userId).catch(error=>({indexed:0,mode:'exact',error:error.message})),solutions:[]};
      for(const solution of insertedSolutions)searchIndex.solutions.push(await retrieval.indexSolution(solution.id).catch(error=>({indexed:0,mode:'exact',error:error.message})));
      return json(res,200,{ok:true,id:contributionId,award,saved:{skills:skills.length-existingSkills.length,experience:newExperience.length,solutions:insertedSolutions.length},skills,experience,solutions:insertedSolutions,duplicates,searchIndex});
    }
    console.warn(`Unmatched API route: ${req.method} ${url.pathname}`);
    return json(res,404,{error:'API route not found.',method:req.method,path:url.pathname});
  }
  const rel=normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '') || 'index.html';
  if(rel.includes('..')) return json(res,403,{error:'Forbidden'});
  const path=join(root,'public',rel);
  if(!existsSync(path)) return json(res,404,{error:'Not found'});
  try { const data=await readFile(path); res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'}); res.end(data); }
  catch { json(res,404,{error:'Not found'}); }
}

if (process.env.PYTHIA_INIT_ONLY === '1') {
  db.close();
  console.log('PYTHIA database initialized from the current seed.');
} else {
  try {
    const indexed=await retrieval.reindexAll();
    console.log(`Search index ready: ${indexed.people.indexed} people and ${indexed.solutions.indexed} solutions embedded; mode=${indexed.people.mode}.`);
  } catch(error) {
    console.error(`Embedding backfill failed; exact local search remains available: ${error.message}`);
  }
  createServer((req,res)=>auth.handle(req,res,()=>route(req,res)).catch(err=>{console.error(err);json(res,500,{error:'Something went wrong.'});})).listen(port,'127.0.0.1',()=>console.log(`PYTHIA running at http://localhost:${port}`));
}
