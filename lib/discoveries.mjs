import { rankOracleContext, tokenize } from './oracle.mjs';
import { expertiseKey } from './expertise.mjs';

export const PERIODS = { '7d': 7, '30d': 30, all: null };
export const DEFAULT_PERIOD = '30d';

const SOLVED = new Set(['solution', 'person']);
const OUTCOME_RANK = { build: 0, person: 1, solution: 2 };
const APP_KINDS = new Set(['agent', 'tool', 'automation']);
const JOIN_SIMILARITY = 0.05;
const MAX_EXAMPLES = 2;
// Free text is quoted only when this many colleagues other than the viewer asked the same thing.
const MIN_OTHER_ASKERS = 3;
const WITHHELD_TITLE = 'Topic withheld for privacy';
const FOLLOW_UP_WINDOW_HOURS = 6;
const BACKFILL_MIN_SCORE = 2;

const sqlTime = date => date.toISOString().slice(0, 19).replace('T', ' ');
const clip = (text, length) => { const value = String(text || '').replace(/\s+/g, ' ').trim(); return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value; };

export function ensureDiscoverySchema(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(requests)').all().map(column => column.name));
  for (const [name, type] of [['outcome', 'TEXT'], ['solution_id', 'INTEGER'], ['turn', 'INTEGER NOT NULL DEFAULT 1']]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE requests ADD COLUMN ${name} ${type}`);
  }
}

// Stores how Oracle answered a request: a catalogue solution, a colleague, or "nothing found, build it".
// A follow-up turn can only improve the outcome of the conversation's first request, never worsen it.
export function recordOutcome(db, { requestId, userId, turn = 1, recommendation, now = new Date() }) {
  const outcome = recommendation?.type in OUTCOME_RANK ? recommendation.type : 'build';
  const solutionId = outcome === 'solution' && Number(recommendation.solutionId) ? Number(recommendation.solutionId) : null;
  const apply = (id, nextOutcome, nextSolutionId) => db.prepare('UPDATE requests SET outcome=?,solution_id=?,resolved=? WHERE id=?')
    .run(nextOutcome, nextSolutionId, SOLVED.has(nextOutcome) ? 1 : 0, id);
  db.prepare('UPDATE requests SET turn=? WHERE id=?').run(Math.max(1, Number(turn) || 1), requestId);
  apply(requestId, outcome, solutionId);
  if (turn <= 1) return;
  const since = sqlTime(new Date(now.getTime() - FOLLOW_UP_WINDOW_HOURS * 3_600_000));
  const first = db.prepare('SELECT id,outcome FROM requests WHERE user_id=? AND turn=1 AND id<? AND created_at>=? ORDER BY id DESC LIMIT 1').get(userId, requestId, since);
  if (first && OUTCOME_RANK[outcome] > OUTCOME_RANK[first.outcome ?? 'build']) apply(first.id, outcome, solutionId);
}

// Requests stored before outcomes existed get an estimate from the same offline keyword matching Oracle falls back to,
// with a stricter bar than "one shared word", which is too noisy to call a request solved.
export function backfillRequestOutcomes(db) {
  const pending = db.prepare('SELECT id,text FROM requests WHERE outcome IS NULL').all();
  if (!pending.length) return 0;
  const solutions = db.prepare('SELECT s.*,u.name owner FROM solutions s JOIN users u ON u.id=s.owner_id').all();
  const people = db.prepare('SELECT * FROM users').all();
  const update = db.prepare('UPDATE requests SET outcome=?,solution_id=?,resolved=? WHERE id=?');
  for (const request of pending) {
    const ranked = rankOracleContext(request.text, solutions, people);
    const solution = ranked.solutions[0]?._score >= BACKFILL_MIN_SCORE ? ranked.solutions[0] : null;
    const person = ranked.people[0]?._score >= BACKFILL_MIN_SCORE;
    const outcome = solution ? 'solution' : person ? 'person' : 'build';
    update.run(outcome, solution?.id ?? null, SOLVED.has(outcome) ? 1 : 0, request.id);
  }
  return pending.length;
}

// Light plural folding so "meetings" and "meeting" count as the same term.
const stem = term => (term.length > 4 && term.endsWith('ies') ? `${term.slice(0, -3)}y` : term.length > 4 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term);
// Question words and filler that tokenize() keeps but that say nothing about a topic ("who can help me ...").
const FILLER = new Set([
  'who', 'what', 'which', 'when', 'where', 'why', 'how', 'anyone', 'someone', 'know', 'help', 'need', 'want', 'make', 'give', 'get', 'any', 'there', 'way', 'new', 'well', 'enough', 'goes', 'before', 'without', 'every', 'each', 'team', 'colleague',
  // Words that appear in requests about unrelated topics ("month end", "design", "experience with") and would otherwise glue them together.
  'experience', 'setup', 'month', 'week', 'day', 'check', 'review', 'looking', 'advice', 'advise', 'built', 'has', 'their', 'running', 'end', 'design', 'project', 'model', 'missing', 'remind', 'structure', 'expert', 'automate', 'automatic', 'automatically', 'основе', 'кто', 'может', 'разбирается', 'нужен', 'нужна', 'нужно', 'можно'
]);
const termSet = text => new Set(tokenize(text).map(stem).filter(term => !FILLER.has(term)));

// Rare terms say more about a topic than words every request uses, so similarity is a tf-idf cosine over the scope's requests.
function weigh(items) {
  const frequency = new Map();
  for (const item of items) for (const term of item.terms) frequency.set(term, (frequency.get(term) || 0) + 1);
  for (const item of items) {
    item.weights = new Map([...item.terms].map(term => [term, Math.log(1 + items.length / frequency.get(term))]));
    item.norm = Math.sqrt([...item.weights.values()].reduce((sum, weight) => sum + weight * weight, 0));
  }
}

function similarity(a, b) {
  if (!a.norm || !b.norm) return 0;
  let dot = 0;
  for (const [term, weight] of a.weights) if (b.weights.has(term)) dot += weight * b.weights.get(term);
  return dot / (a.norm * b.norm);
}

// Average-link grouping: the two clusters whose members are, on average, most alike are merged until none is similar enough.
// Unlike single-link it does not chain unrelated topics through one shared word. The work is cubic, so only the most
// recent requests are clustered; older ones are still counted in the totals.
const MAX_CLUSTERED = 400;
function clusterByTerms(items) {
  const recent = items.slice(-MAX_CLUSTERED);
  const matrix = recent.map((a, i) => recent.map((b, j) => (i === j ? 0 : similarity(a, b))));
  let groups = recent.map((_, index) => [index]);
  for (;;) {
    let best = null;
    let bestScore = JOIN_SIMILARITY;
    for (let x = 0; x < groups.length; x += 1) {
      for (let y = x + 1; y < groups.length; y += 1) {
        let sum = 0;
        for (const i of groups[x]) for (const j of groups[y]) sum += matrix[i][j];
        const score = sum / (groups[x].length * groups[y].length);
        if (score >= bestScore) { best = [x, y]; bestScore = score; }
      }
    }
    if (!best) break;
    groups[best[0]] = groups[best[0]].concat(groups[best[1]]);
    groups = groups.filter((_, index) => index !== best[1]);
  }
  const older = items.slice(0, -MAX_CLUSTERED).map(item => ({ items: [item] }));
  return [...older, ...groups.map(group => ({ items: group.sort((a, b) => a - b).map(index => recent[index]) }))];
}

function topTerms(items, count = 3) {
  const frequency = new Map();
  for (const item of items) for (const term of item.terms) frequency.set(term, (frequency.get(term) || 0) + 1);
  return [...frequency].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0])).slice(0, count).map(([term]) => term);
}

// Titles and examples come from the script most of the group wrote in, so an English page is not headed by a one-off Russian request.
const isCyrillic = text => /\p{Script=Cyrillic}/u.test(text);
const majorityScript = items => {
  const wantCyrillic = items.filter(item => isCyrillic(item.text)).length * 2 > items.length;
  return items.filter(item => isCyrillic(item.text) === wantCyrillic);
};

function representative(items) {
  const score = item => items.reduce((sum, other) => sum + (other === item ? 0 : similarity(item, other)), 0);
  return [...majorityScript(items)].sort((a, b) => score(b) - score(a) || a.text.length - b.text.length)[0];
}

function describeCluster(cluster, { solutionsById, helpedRequestIds, viewerId }) {
  const { items } = cluster;
  const askers = new Set(items.map(item => item.userId)).size;
  const solved = items.filter(item => SOLVED.has(item.outcome)).length;
  const bySolution = items.filter(item => item.outcome === 'solution').length;
  const byPerson = items.filter(item => item.outcome === 'person').length;
  const status = cluster.solutionId ? 'solution' : byPerson > items.length / 2 ? 'person' : 'gap';
  // Free text is echoed back only when several colleagues asked the same thing, and never with a name. The viewer's own
  // requests do not count towards that threshold and are never quoted: otherwise anyone could add one request on a topic
  // and read the other asker's text. Below the threshold only the viewer's own topics keep a keyword label.
  const others = items.filter(item => item.userId !== viewerId);
  const showText = new Set(others.map(item => item.userId)).size >= MIN_OTHER_ASKERS;
  const ownOnly = viewerId != null && !others.length;
  const title = cluster.solutionId ? (solutionsById.get(cluster.solutionId)?.title || 'Catalogue solution')
    : showText ? clip(representative(others).text, 80)
    : ownOnly ? `Topic: ${topTerms(items).join(' · ') || 'new'}`
    : WITHHELD_TITLE;
  const examples = [];
  if (showText) {
    const seen = new Set();
    const preferred = majorityScript(others);
    for (const item of [...preferred, ...others.filter(other => !preferred.includes(other))]) {
      if (examples.length >= MAX_EXAMPLES) break;
      if (seen.has(item.userId)) continue;
      seen.add(item.userId);
      examples.push(clip(item.text, 140));
    }
  }
  return {
    title, status, count: items.length, askers, solved, open: items.length - solved, solutions: bySolution, colleagues: byPerson,
    confirmed: items.filter(item => helpedRequestIds.has(item.id)).length,
    stage: items.length >= 3 ? 'opportunity' : 'emerging',
    solutionId: cluster.solutionId || null, examples
  };
}

export function buildDiscoveries({ requests = [], solutions = [], people = [], runs = [], now = new Date(), period = DEFAULT_PERIOD, viewerId = null } = {}) {
  const key = Object.hasOwn(PERIODS, period) ? period : DEFAULT_PERIOD;
  const days = PERIODS[key];
  const cutoff = days == null ? '' : sqlTime(new Date(now.getTime() - days * 86_400_000));
  const inScope = requests
    .filter(request => (Number(request.turn) || 1) === 1 && (!cutoff || String(request.created_at) >= cutoff))
    .map(request => ({ id: request.id, userId: request.user_id, text: String(request.text || ''), outcome: request.outcome in OUTCOME_RANK ? request.outcome : 'build', solutionId: Number(request.solution_id) || null, terms: termSet(request.text) }));

  weigh(inScope);
  const solutionsById = new Map(solutions.map(solution => [solution.id, solution]));
  const helpedRequestIds = new Set(runs.filter(run => run.feedback === 'helped' && run.request_id).map(run => run.request_id));
  const context = { solutionsById, helpedRequestIds, viewerId };

  const anchored = new Map();
  const loose = [];
  for (const item of inScope) {
    if (item.outcome === 'solution' && item.solutionId) {
      if (!anchored.has(item.solutionId)) anchored.set(item.solutionId, { solutionId: item.solutionId, items: [] });
      anchored.get(item.solutionId).items.push(item);
    } else loose.push(item);
  }
  // Colleague answers and unanswered requests never share a cluster, otherwise a gap could inherit a solved status.
  const clusters = [...anchored.values(), ...['person', 'build'].flatMap(outcome => clusterByTerms(loose.filter(item => item.outcome === outcome)))]
    .map(cluster => describeCluster(cluster, context))
    .sort((a, b) => b.count - a.count || b.askers - a.askers || a.title.localeCompare(b.title));

  const total = inScope.length;
  const solved = inScope.filter(item => SOLVED.has(item.outcome)).length;
  const share = cluster => (total ? Math.round((cluster.count / total) * 100) : 0);
  const topRequests = clusters.slice(0, 8).map(cluster => ({ ...cluster, share: share(cluster) }));
  const gaps = clusters.filter(cluster => cluster.status === 'gap').slice(0, 5).map(cluster => ({ ...cluster, share: share(cluster) }));

  const expertise = new Set();
  for (const person of people) for (const area of String(person.skills || '').split(',')) if (expertiseKey(area)) expertise.add(expertiseKey(area));
  const kinds = solutions.map(solution => String(solution.kind || '').toLowerCase());
  const catalogue = {
    skills: kinds.filter(kind => kind === 'skill').length,
    apps: kinds.filter(kind => APP_KINDS.has(kind)).length,
    knowledge: kinds.filter(kind => kind !== 'skill' && !APP_KINDS.has(kind)).length,
    runnable: solutions.filter(solution => Number(solution.runnable) === 1).length,
    expertiseAreas: expertise.size,
    people: people.length
  };

  return {
    period: key,
    periods: Object.keys(PERIODS),
    totals: { requests: total, solved, open: total - solved, solvedShare: total ? Math.round((solved / total) * 100) : 0, confirmed: inScope.filter(item => helpedRequestIds.has(item.id)).length, askers: new Set(inScope.map(item => item.userId)).size },
    catalogue, topRequests, gaps
  };
}

export function discoveriesFor(db, { period = DEFAULT_PERIOD, now = new Date(), viewerId = null } = {}) {
  return buildDiscoveries({
    requests: db.prepare('SELECT id,text,user_id,created_at,outcome,solution_id,turn FROM requests').all(),
    solutions: db.prepare('SELECT id,title,kind,runnable FROM solutions').all(),
    people: db.prepare('SELECT id,skills FROM users').all(),
    runs: db.prepare('SELECT request_id,feedback FROM runs WHERE request_id IS NOT NULL').all(),
    now, period, viewerId
  });
}
