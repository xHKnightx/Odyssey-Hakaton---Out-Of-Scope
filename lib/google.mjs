import { readFile, writeFile, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const tokenFile = join(process.cwd(), 'data', 'google-token.json');
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
  try { return JSON.parse(await readFile(tokenFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function saveGoogleToken(token) {
  await writeFile(tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
  await chmod(tokenFile, 0o600);
}

export async function removeGoogleToken() {
  try { await unlink(tokenFile); }
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
