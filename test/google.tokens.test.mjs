import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const workdir = mkdtempSync(join(tmpdir(), 'pythia-tokens-'));
process.chdir(workdir);
process.env.GOOGLE_CLIENT_ID = 'client';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
const google = await import('../lib/google.mjs');
const { runWithUser } = await import('../lib/auth/context.mjs');

const realFetch = globalThis.fetch;
const stubGoogle = email => {
  globalThis.fetch = async url => {
    const target = String(url);
    if (target.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: `at-${email}`, refresh_token: `rt-${email}`, expires_in: 3600 });
    if (target.includes('userinfo')) return Response.json({ email, name: email });
    if (target.includes('revoke')) return Response.json({});
    throw new Error(`Unexpected request ${target}`);
  };
};

describe('per-user Google connection', () => {
  after(() => { globalThis.fetch = realFetch; rmSync(workdir, { recursive: true, force: true }); });

  const priya = { id: 2, email: 'priya@t1a.com' };
  const mia = { id: 3, email: 'mia@t1a.com' };

  it('keeps one token file per signed-in user, readable only by the owner', async () => {
    stubGoogle('priya@t1a.com');
    await runWithUser(priya, () => google.exchangeGoogleCode('code'));
    const file = join(workdir, 'data', 'google-tokens', '2.json');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).refresh_token, 'rt-priya@t1a.com');
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal((await runWithUser(priya, () => google.readGoogleToken())).email, 'priya@t1a.com');
    assert.equal(await runWithUser(mia, () => google.readGoogleToken()), null);
  });

  it('disconnecting removes only the caller’s token', async () => {
    stubGoogle('mia@t1a.com');
    await runWithUser(mia, () => google.exchangeGoogleCode('code'));
    await runWithUser(priya, () => google.removeGoogleToken());
    assert.equal(await runWithUser(priya, () => google.readGoogleToken()), null);
    assert.equal((await runWithUser(mia, () => google.readGoogleToken())).email, 'mia@t1a.com');
  });

  it('refuses to attach a different Google account to a signed-in profile', async () => {
    stubGoogle('mia@t1a.com');
    await assert.rejects(runWithUser(priya, () => google.exchangeGoogleCode('code')), /Connect the Google account you signed in with \(priya@t1a.com\)/);
    assert.equal(existsSync(join(workdir, 'data', 'google-tokens', '2.json')), false);
  });

  it('does not check the account for profiles without an email (dev personas)', async () => {
    stubGoogle('demo@t1a.com');
    await runWithUser({ id: 9 }, () => google.exchangeGoogleCode('code'));
    assert.equal(existsSync(join(workdir, 'data', 'google-tokens', '9.json')), true);
  });

  it('does not overwrite a token the user already has when adopting the legacy file', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(workdir, 'data', 'google-token.json'), JSON.stringify({ email: 'mia@t1a.com', refresh_token: 'legacy' }));
    assert.equal(await google.adoptLegacyGoogleToken(3, 'mia@t1a.com'), false);
    assert.equal(JSON.parse(readFileSync(join(workdir, 'data', 'google-tokens', '3.json'), 'utf8')).refresh_token, 'rt-mia@t1a.com');
    assert.equal(existsSync(join(workdir, 'data', 'google-token.json')), true);
  });
});
