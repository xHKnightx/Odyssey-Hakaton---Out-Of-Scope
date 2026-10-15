import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// Runs the real server from a throw-away copy, so the SQLite file and tokens never touch the repository.
export async function startApp(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pythia-test-'));
  for (const item of ['server.mjs', 'lib', 'public', 'seed', 'package.json']) cpSync(join(root, item), join(dir, item), { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      AUTH_DEV_LOGIN: '1',
      AUTH_ALLOWED_DOMAINS: 't1a.com',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      LLM_BASE_URL: '',
      LLM_API_KEY: '',
      LLM_MODEL: '',
      EMBEDDING_MODEL: '',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${log}`)), 15_000);
    const onData = chunk => { log += chunk; if (log.includes('PYTHIA running')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', chunk => { log += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited with ${code}:\n${log}`)); });
  });
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    client: () => createClient(url),
    async stop() {
      child.removeAllListeners('exit');
      child.kill();
      await new Promise(resolve => child.once('close', resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

export async function signInAs(app, name) {
  const client = app.client();
  const { personas } = (await client.request('/auth/personas')).json();
  const persona = personas.find(item => item.name === name);
  if (!persona) throw new Error(`No persona named ${name}`);
  const response = await client.request('/auth/dev-login', { method: 'POST', json: { userId: persona.id } });
  if (response.status !== 200) throw new Error(`Dev login failed: ${response.text}`);
  return { client, persona };
}
