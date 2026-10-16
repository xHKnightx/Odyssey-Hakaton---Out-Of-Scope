import { authConfig } from './config.mjs';
import { runWithUser } from './context.mjs';
import { AuthError, buildAuthorizationUrl, createPkce, exchangeCode, randomToken, validateIdToken } from './oidc.mjs';
import { profileView } from './profile.mjs';
import { ensureAuthSchema } from './schema.mjs';
import { SESSION_COOKIE, createSessions, parseCookies, serializeCookie } from './sessions.mjs';
import { createUserDirectory } from './users.mjs';
import { adoptLegacyGoogleToken, googleConfigured, googleRedirectUri } from '../google.mjs';

const STATE_COOKIE = 'pythia_oauth';
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 500;
// Everything the login page needs; the rest of public/ requires a session.
const PUBLIC_ASSETS = new Set(['/login.html', '/login.js', '/style.css', '/favicon.ico']);

const json = (res, code, value, cookies = []) => {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(code, headers);
  res.end(JSON.stringify(value));
};
const redirect = (res, location, cookies = []) => {
  const headers = { location, 'cache-control': 'no-store' };
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(302, headers);
  res.end();
};

async function readJson(req, limit = 16_384) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new AuthError('too_large', 'Request body is too large.');
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new AuthError('bad_json', 'Request body must be JSON.'); }
}

function isCrossSite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.host; }
  catch { return true; }
}

export function createAuth(db, { fetchImpl = fetch, log = console.log } = {}) {
  ensureAuthSchema(db);
  const startup = authConfig();
  log(`Auth: Google sign-in ${googleConfigured() ? `on (${startup.allowedDomains.map(domain => `@${domain}`).join(', ')})` : 'off, no Google credentials'}; persona login ${startup.devLogin ? 'ON' : 'off'}`);
  const sessions = createSessions(db, authConfig);
  const directory = createUserDirectory(db);
  const pending = new Map();

  const sessionCookie = (session, cfg) => serializeCookie(SESSION_COOKIE, session.token, { maxAgeSeconds: session.maxAgeSeconds, secure: cfg.cookieSecure });
  const clearSessionCookie = cfg => serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: cfg.cookieSecure });
  const clearStateCookie = cfg => serializeCookie(STATE_COOKIE, '', { maxAgeSeconds: 0, path: '/auth', secure: cfg.cookieSecure });

  function prunePending() {
    const cutoff = Date.now() - STATE_TTL_MS;
    for (const [state, entry] of pending) if (entry.createdAt < cutoff) pending.delete(state);
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
  }

  function startLogin(res) {
    const cfg = authConfig();
    if (!googleConfigured()) return redirect(res, '/login.html?error=config');
    prunePending();
    const state = randomToken(), nonce = randomToken(), pkce = createPkce();
    pending.set(state, { nonce, verifier: pkce.verifier, createdAt: Date.now() });
    const url = buildAuthorizationUrl({
      clientId: process.env.GOOGLE_CLIENT_ID,
      redirectUri: googleRedirectUri(),
      state, nonce, challenge: pkce.challenge,
      domainHint: cfg.allowedDomains.length === 1 ? cfg.allowedDomains[0] : undefined
    });
    redirect(res, url, [serializeCookie(STATE_COOKIE, state, { maxAgeSeconds: STATE_TTL_MS / 1000, path: '/auth', secure: cfg.cookieSecure })]);
  }

  async function finishLogin(req, res, url) {
    const cfg = authConfig();
    const state = url.searchParams.get('state');
    const entry = pending.get(state);
    pending.delete(state);
    const fail = code => redirect(res, `/login.html?error=${code}`, [clearStateCookie(cfg)]);
    if (!entry || Date.now() - entry.createdAt > STATE_TTL_MS) return fail('state');
    // The state must also come back in the cookie of the browser that started the login (blocks login CSRF).
    if (parseCookies(req.headers.cookie)[STATE_COOKIE] !== state) return fail('state');
    if (url.searchParams.has('error')) return fail('denied');
    const code = url.searchParams.get('code');
    if (!code) return fail('state');
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const claims = await exchangeCode({ code, verifier: entry.verifier, clientId, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: googleRedirectUri(), fetchImpl });
      const profile = validateIdToken(claims, { clientId, nonce: entry.nonce, allowedDomains: cfg.allowedDomains });
      const { user } = directory.findOrCreateForGoogle(profile);
      await adoptLegacyGoogleToken(user.id, user.email);
      sessions.destroy(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      const session = sessions.create(user.id, 'google');
      return redirect(res, '/', [clearStateCookie(cfg), sessionCookie(session, cfg)]);
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'exchange';
      console.error('Google sign-in failed:', code, error.message);
      return fail(code);
    }
  }

  async function devLogin(req, res, cfg, existingToken) {
    let body;
    try { body = await readJson(req); }
    catch (error) { return json(res, 400, { error: error.message }); }
    const user = directory.byId(Number(body.userId));
    if (!user) return json(res, 404, { error: 'Profile not found.' });
    sessions.destroy(existingToken);
    const session = sessions.create(user.id, 'dev');
    return json(res, 200, { ok: true, userId: user.id }, [sessionCookie(session, cfg)]);
  }

  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const cfg = authConfig();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = sessions.lookup(token);

    if (isCrossSite(req)) return json(res, 403, { error: 'Cross-site request blocked.' });

    if (req.method === 'GET' && path === '/auth/config') {
      return json(res, 200, { googleConfigured: googleConfigured(), devLogin: cfg.devLogin, allowedDomains: cfg.allowedDomains });
    }
    if (req.method === 'GET' && path === '/auth/login') return startLogin(res);
    if (req.method === 'GET' && path === '/auth/google/callback' && pending.has(url.searchParams.get('state'))) return finishLogin(req, res, url);
    if (path === '/auth/dev-login' || path === '/auth/personas') {
      if (!cfg.devLogin) return json(res, 404, { error: 'Not found' });
      if (req.method === 'POST' && path === '/auth/dev-login') return devLogin(req, res, cfg, token);
      if (req.method === 'GET' && path === '/auth/personas') {
        return json(res, 200, { personas: db.prepare('SELECT id,name,title,team,initials,color FROM users ORDER BY name').all() });
      }
    }
    if (req.method === 'POST' && path === '/auth/logout') {
      sessions.destroy(token);
      return json(res, 200, { ok: true }, [clearSessionCookie(cfg)]);
    }

    if (!user) {
      if (path.startsWith('/api/')) return json(res, 401, { error: 'Sign in required.', code: 'auth_required' });
      if (req.method === 'GET' && PUBLIC_ASSETS.has(path)) return next();
      if (req.method === 'GET' && (path === '/' || path.endsWith('.html') || path.startsWith('/auth/'))) return redirect(res, '/login.html');
      return json(res, 401, { error: 'Sign in required.', code: 'auth_required' });
    }

    if (req.method === 'GET' && path === '/api/auth/me') {
      return json(res, 200, {
        user: profileView(user),
        profileComplete: Boolean(user.profile_completed),
        method: user.session_method,
        devLogin: cfg.devLogin,
        googleConfigured: googleConfigured()
      });
    }
    return runWithUser(user, next);
  }

  return { handle, sessions, directory };
}
