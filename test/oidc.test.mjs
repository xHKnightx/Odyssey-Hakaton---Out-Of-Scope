import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { AuthError, buildAuthorizationUrl, createPkce, decodeJwtPayload, validateIdToken } from '../lib/auth/oidc.mjs';

const CLIENT = 'client-123.apps.googleusercontent.com';
const base = (overrides = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  exp: Math.floor(Date.now() / 1000) + 600,
  nonce: 'n-1',
  sub: '1099',
  email: 'Jane.Doe@T1A.com',
  email_verified: true,
  hd: 't1a.com',
  name: 'Jane Doe',
  picture: 'https://lh3.googleusercontent.com/a/x',
  ...overrides
});
const check = claims => validateIdToken(claims, { clientId: CLIENT, nonce: 'n-1', allowedDomains: ['t1a.com'] });
const rejects = (claims, code) => assert.throws(() => check(claims), error => error instanceof AuthError && error.code === code);

describe('validateIdToken', () => {
  it('accepts a verified company account and normalizes it', () => {
    assert.deepEqual(check(base()), { sub: '1099', email: 'jane.doe@t1a.com', name: 'Jane Doe', picture: 'https://lh3.googleusercontent.com/a/x' });
  });
  it('accepts an audience list that contains the client', () => {
    assert.equal(check(base({ aud: ['other', CLIENT] })).sub, '1099');
  });
  it('falls back to the mailbox name and drops non-https pictures', () => {
    const result = check(base({ name: '  ', picture: 'http://tracker.example/p.png' }));
    assert.equal(result.name, 'jane.doe');
    assert.equal(result.picture, '');
  });
  it('rejects other issuers, audiences, expired tokens and wrong nonces', () => {
    rejects(base({ iss: 'https://evil.example' }), 'token');
    rejects(base({ aud: 'another-client' }), 'token');
    rejects(base({ exp: Math.floor(Date.now() / 1000) - 5 }), 'token');
    rejects(base({ nonce: 'replayed' }), 'token');
    rejects(base({ nonce: undefined }), 'token');
    rejects(base({ sub: '' }), 'token');
  });
  it('rejects unverified emails', () => {
    rejects(base({ email_verified: false }), 'email_unverified');
    rejects(base({ email_verified: 'true' }), 'email_unverified');
  });
  it('rejects every account that is not on the allowed domain', () => {
    rejects(base({ email: 'jane@gmail.com', hd: undefined }), 'domain');
    rejects(base({ email: 'jane@t1a.com', hd: undefined }), 'domain');
    rejects(base({ email: 'jane@t1a.com', hd: 'other.com' }), 'domain');
    rejects(base({ email: 'jane@t1a.com.evil.example', hd: 't1a.com.evil.example' }), 'domain');
    rejects(base({ email: 'jane@other.com', hd: 'other.com' }), 'domain');
  });
  it('supports several allowed domains', () => {
    const result = validateIdToken(base({ email: 'jane@t1b.com', hd: 't1b.com' }), { clientId: CLIENT, nonce: 'n-1', allowedDomains: ['t1a.com', 't1b.com'] });
    assert.equal(result.email, 'jane@t1b.com');
  });
});

describe('PKCE and authorization URL', () => {
  it('derives the S256 challenge from the verifier', () => {
    const { verifier, challenge } = createPkce();
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
    assert.ok(verifier.length >= 43);
    assert.notEqual(createPkce().verifier, verifier);
  });
  it('asks for identity scopes only, with state, nonce and PKCE', () => {
    const url = new URL(buildAuthorizationUrl({ clientId: CLIENT, redirectUri: 'http://localhost:3000/auth/google/callback', state: 's', nonce: 'n', challenge: 'c', domainHint: 't1a.com' }));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('state'), 's');
    assert.equal(url.searchParams.get('nonce'), 'n');
    assert.equal(url.searchParams.get('hd'), 't1a.com');
    assert.equal(url.searchParams.get('response_type'), 'code');
  });
  it('omits the hosted-domain hint when no single domain applies', () => {
    const url = new URL(buildAuthorizationUrl({ clientId: CLIENT, redirectUri: 'x', state: 's', nonce: 'n', challenge: 'c' }));
    assert.equal(url.searchParams.has('hd'), false);
  });
});

describe('decodeJwtPayload', () => {
  it('reads the payload and refuses malformed tokens', () => {
    const jwt = ['h', Buffer.from(JSON.stringify({ a: 1 })).toString('base64url'), 's'].join('.');
    assert.deepEqual(decodeJwtPayload(jwt), { a: 1 });
    assert.throws(() => decodeJwtPayload('nope'), AuthError);
    assert.throws(() => decodeJwtPayload('a.!!!.c'), AuthError);
  });
});
