import { createHash, randomBytes } from 'node:crypto';

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const base64url = value => Buffer.from(value).toString('base64url');

export const randomToken = () => randomBytes(32).toString('base64url');

export function createPkce() {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function buildAuthorizationUrl({ clientId, redirectUri, state, nonce, challenge, domainHint }) {
  const url = new URL(AUTHORIZATION_URL);
  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  };
  if (domainHint) params.hd = domainHint;
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

export function decodeJwtPayload(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new AuthError('token', 'Malformed ID token.');
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { throw new AuthError('token', 'Malformed ID token.'); }
}

// The ID token comes straight from Google's token endpoint over TLS, so its signature
// is not re-verified (OpenID Connect Core 3.1.3.7); every claim that matters is checked.
export function validateIdToken(claims, { clientId, nonce, allowedDomains, now = Date.now() }) {
  if (!claims || typeof claims !== 'object') throw new AuthError('token');
  if (!ISSUERS.includes(claims.iss)) throw new AuthError('token', 'Unexpected token issuer.');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!clientId || !audience.includes(clientId)) throw new AuthError('token', 'Token was issued for another client.');
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now) throw new AuthError('token', 'ID token has expired.');
  if (!nonce || claims.nonce !== nonce) throw new AuthError('token', 'Nonce mismatch.');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthError('token', 'Token has no subject.');
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) throw new AuthError('token', 'Token has no email.');
  if (claims.email_verified !== true) throw new AuthError('email_unverified', 'Google has not verified this email.');
  const email = claims.email.trim().toLowerCase();
  const domain = email.split('@').pop();
  const hostedDomain = String(claims.hd || '').toLowerCase();
  if (!allowedDomains.includes(domain) || hostedDomain !== domain) {
    throw new AuthError('domain', `Only ${allowedDomains.join(', ')} accounts can sign in.`);
  }
  return {
    sub: claims.sub,
    email,
    name: String(claims.name || '').trim() || email.split('@')[0],
    picture: typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture : ''
  };
}

export async function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id_token) {
    throw new AuthError('exchange', payload.error_description || payload.error || `Google token exchange failed (${response.status}).`);
  }
  return decodeJwtPayload(payload.id_token);
}
