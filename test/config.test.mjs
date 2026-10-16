import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { authConfig } from '../lib/auth/config.mjs';

const KEYS = ['AUTH_ALLOWED_DOMAINS', 'AUTH_DEV_LOGIN', 'SESSION_TTL_HOURS', 'AUTH_COOKIE_SECURE', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'NODE_ENV'];
const saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
const setEnv = values => {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
};

describe('authConfig', () => {
  afterEach(() => {
    for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  });

  it('defaults to the company domain only', () => {
    setEnv({});
    assert.deepEqual(authConfig().allowedDomains, ['t1a.com']);
  });
  it('parses a domain list case-insensitively', () => {
    setEnv({ AUTH_ALLOWED_DOMAINS: ' T1A.com, t1b.com ,' });
    assert.deepEqual(authConfig().allowedDomains, ['t1a.com', 't1b.com']);
  });
  it('turns persona login on by default only while Google is not configured', () => {
    setEnv({});
    assert.equal(authConfig().devLogin, true);
    setEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    assert.equal(authConfig().devLogin, false);
    setEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', AUTH_DEV_LOGIN: '' });
    assert.equal(authConfig().devLogin, false);
  });
  it('lets the flag decide when it is set', () => {
    setEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', AUTH_DEV_LOGIN: '1' });
    assert.equal(authConfig().devLogin, true);
    setEnv({ AUTH_DEV_LOGIN: '0' });
    assert.equal(authConfig().devLogin, false);
  });
  it('never allows persona login in production', () => {
    setEnv({ NODE_ENV: 'production' });
    assert.equal(authConfig().devLogin, false);
    setEnv({ NODE_ENV: 'production', AUTH_DEV_LOGIN: '1' });
    assert.equal(authConfig().devLogin, false);
  });
  it('bounds the session lifetime and marks cookies Secure behind https', () => {
    setEnv({});
    assert.equal(authConfig().sessionTtlMs, 12 * 3_600_000);
    setEnv({ SESSION_TTL_HOURS: '0' });
    assert.equal(authConfig().sessionTtlMs, 12 * 3_600_000);
    setEnv({ SESSION_TTL_HOURS: '2' });
    assert.equal(authConfig().sessionTtlMs, 2 * 3_600_000);
    assert.equal(authConfig().cookieSecure, false);
    setEnv({ GOOGLE_REDIRECT_URI: 'https://pythia.example/auth/google/callback' });
    assert.equal(authConfig().cookieSecure, true);
    setEnv({ AUTH_COOKIE_SECURE: '1' });
    assert.equal(authConfig().cookieSecure, true);
  });
});
