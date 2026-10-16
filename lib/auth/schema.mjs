const USER_COLUMNS = [
  ['email', 'TEXT'],
  ['google_sub', 'TEXT'],
  ['avatar_url', 'TEXT'],
  ['last_login_at', 'TEXT'],
  ['profile_completed', 'INTEGER NOT NULL DEFAULT 1']
];

export function ensureAuthSchema(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
  for (const [name, type] of USER_COLUMNS) if (!existing.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions(
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);`);
}
