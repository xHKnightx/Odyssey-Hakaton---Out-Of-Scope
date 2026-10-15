const COLORS = ['#d9b6e8', '#f7a072', '#8fd3c1', '#9cc4ff', '#ffd27a', '#c9a7ff', '#e9a1c7', '#9fe0d0'];
const normalizeName = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const initialsOf = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';

export function createUserDirectory(db) {
  const bySub = db.prepare('SELECT * FROM users WHERE google_sub=?');
  const byEmail = db.prepare('SELECT * FROM users WHERE lower(email)=?');
  const unclaimed = db.prepare('SELECT * FROM users WHERE email IS NULL AND google_sub IS NULL');
  const byId = db.prepare('SELECT * FROM users WHERE id=?');
  const touch = db.prepare(`UPDATE users SET google_sub=?, email=?, avatar_url=?, last_login_at=datetime('now') WHERE id=?`);
  const create = db.prepare(`INSERT INTO users(name,title,team,skills,initials,color,location,availability,experience,email,google_sub,avatar_url,last_login_at,profile_completed)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),0)`);

  return {
    byId: id => byId.get(id) || null,
    // Match order: Google subject, then email, then an unclaimed seed profile with exactly the same name.
    findOrCreateForGoogle({ sub, email, name, picture }) {
      let user = bySub.get(sub) || byEmail.get(email);
      let outcome = 'existing';
      if (!user) {
        const wanted = normalizeName(name);
        user = unclaimed.all().find(candidate => normalizeName(candidate.name) === wanted);
        if (user) outcome = 'claimed';
      }
      if (user) {
        touch.run(sub, email, picture || user.avatar_url || null, user.id);
        return { user: byId.get(user.id), outcome };
      }
      const result = create.run(name, 'New colleague', 'T1A', 'Getting started', initialsOf(name), COLORS[name.length % COLORS.length], '', '', '', email, sub, picture || null);
      return { user: byId.get(Number(result.lastInsertRowid)), outcome: 'created' };
    }
  };
}
