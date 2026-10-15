import { readFile, writeFile, chmod, unlink, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { currentUser } from './auth/context.mjs';

const dataDir = join(process.cwd(), 'data');
const legacyTokenFile = join(dataDir, 'google-token.json');
const tokenDir = join(dataDir, 'google-tokens');
// One token file per signed-in user; the old single-user file is only a fallback outside a request.
const tokenFile = () => { const user = currentUser(); return user ? join(tokenDir, `${Number(user.id)}.json`) : legacyTokenFile; };
export const GOOGLE_SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly'
];

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
}

export function googleAuthorizationUrl(state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return url.toString();
}

export async function readGoogleToken() {
  let token;
  try { token = JSON.parse(await readFile(tokenFile(), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  // Files are keyed by user id, which a database reset can hand to someone else: only release a token to the account it was issued for.
  const email = currentUser()?.email;
  if (email && token.email && String(token.email).toLowerCase() !== email.toLowerCase()) return null;
  return token;
}

export async function saveGoogleToken(token) {
  const file = tokenFile();
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(token, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
}

// Hands the pre-auth single-user token to the person it belongs to, matched by Google account email.
export async function adoptLegacyGoogleToken(userId, email) {
  let legacy;
  try { legacy = JSON.parse(await readFile(legacyTokenFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!email || String(legacy.email || '').toLowerCase() !== String(email).toLowerCase()) return false;
  const target = join(tokenDir, `${Number(userId)}.json`);
  try { await readFile(target); return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(tokenDir, { recursive: true });
  await rename(legacyTokenFile, target);
  await chmod(target, 0o600);
  return true;
}

export async function removeGoogleToken() {
  try { await unlink(tokenFile()); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function exchangeGoogleCode(code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code'
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google token exchange failed.');
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${payload.access_token}` } });
  const profile = profileResponse.ok ? await profileResponse.json() : {};
  const signedIn = currentUser();
  if (signedIn?.email && profile.email && signedIn.email.toLowerCase() !== String(profile.email).toLowerCase()) {
    fetch(`https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token: payload.refresh_token || payload.access_token })}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }).catch(() => {});
    throw new Error(`Connect the Google account you signed in with (${signedIn.email}), not ${profile.email}.`);
  }
  const token = { ...payload, email: profile.email || '', name: profile.name || '', saved_at: Date.now() };
  await saveGoogleToken(token);
  return token;
}

export async function googleAccessToken() {
  let token = await readGoogleToken();
  if (!token) throw new Error('Connect a Google account first.');
  if (token.expires_at && token.expires_at > Date.now() + 60_000) return token.access_token;
  if (token.expires_in && token.saved_at && token.saved_at + token.expires_in * 1000 > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) throw new Error('Google authorization expired. Reconnect your account.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: token.refresh_token, grant_type: 'refresh_token' })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Could not refresh Google authorization. Reconnect your account.');
  token = { ...token, ...payload, refresh_token: token.refresh_token, saved_at: Date.now() };
  await saveGoogleToken(token);
  return token.access_token;
}

export async function googleApi(path, options = {}) {
  const accessToken = await googleAccessToken();
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...options,
    headers: { authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `Google API request failed (${response.status}).`;
    if ([401, 403].includes(response.status)) throw new Error(`${message} Check that Calendar API and Gmail API are enabled and the OAuth scopes were granted.`);
    throw new Error(message);
  }
  return payload;
}
