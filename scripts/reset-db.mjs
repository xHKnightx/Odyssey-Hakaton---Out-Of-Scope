import { spawn } from 'node:child_process';
import { access, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
const databaseFiles = ['pythia.db', 'pythia.db-wal', 'pythia.db-shm'];
const port = Number(process.env.PORT || 3000);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function applicationIsRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/oracle/status`, {
      signal: AbortSignal.timeout(750)
    });
    return response.ok || response.status === 401; // 401: the running app answers, but sign-in is required
  } catch {
    return false;
  }
}

if (await applicationIsRunning()) {
  console.error(`PYTHIA is running on http://127.0.0.1:${port}. Stop it before resetting the database.`);
  process.exit(1);
}

await mkdir(dataDir, { recursive: true });
const presentFiles = [];
for (const name of databaseFiles) {
  const path = join(dataDir, name);
  if (await exists(path)) presentFiles.push(name);
}

let backupDir = '';
if (presentFiles.length) {
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  backupDir = join(dataDir, 'backups', `reset-${timestamp}`);
  await mkdir(backupDir, { recursive: true });
  for (const name of presentFiles) await rename(join(dataDir, name), join(backupDir, name));
  console.log(`Previous database archived at ${backupDir}`);
}

const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  cwd: root,
  env: { ...process.env, PYTHIA_INIT_ONLY: '1' },
  stdio: 'inherit'
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});

if (exitCode !== 0) {
  console.error(`Database initialization failed with exit code ${exitCode}. The previous database remains in ${backupDir || 'place'}.`);
  process.exit(exitCode);
}

console.log('Clean database is ready. Run npm start to launch PYTHIA.');
