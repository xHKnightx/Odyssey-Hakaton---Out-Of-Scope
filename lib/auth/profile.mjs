const COLORS = ['#d9b6e8', '#f7a072', '#8fd3c1', '#9cc4ff', '#ffd27a', '#c9a7ff', '#e9a1c7', '#9fe0d0'];

function clean(input) {
  const text = key => String(input[key] ?? '').trim();
  const skills = [...new Set((Array.isArray(input.skills) ? input.skills : String(input.skills || '').split(/[\n,]/)).map(skill => String(skill).trim()).filter(Boolean))];
  return { name: text('name'), title: text('title'), team: text('team'), location: text('location'), availability: text('availability'), experience: text('experience'), skills };
}

export function validateProfile(input) {
  const v = clean(input || {});
  if (!v.name || !v.title || !v.team || !v.skills.length) return { error: 'Name, role, team, and at least one skill are required.' };
  if (v.name.length > 100 || v.title.length > 120 || v.team.length > 80 || v.location.length > 100 || v.availability.length > 180 || v.experience.length > 1200 || v.skills.length > 20 || v.skills.some(skill => skill.length > 60)) {
    return { error: 'One or more profile fields exceed the allowed length.' };
  }
  return { values: v };
}

// The signed-in user can only complete or edit their own profile.
export function saveOwnProfile(db, user, input) {
  const { error, values } = validateProfile(input);
  if (error) return { status: 400, error };
  const clash = db.prepare('SELECT id FROM users WHERE lower(name)=lower(?) AND id<>?').get(values.name, user.id);
  if (clash) return { status: 409, error: 'A profile with this name already exists.' };
  const initials = values.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  db.prepare('UPDATE users SET name=?,title=?,team=?,skills=?,initials=?,color=COALESCE(color,?),location=?,availability=?,experience=?,profile_completed=1 WHERE id=?')
    .run(values.name, values.title, values.team, values.skills.join(', '), initials, COLORS[values.name.length % COLORS.length], values.location, values.availability, values.experience, user.id);
  return { status: 200, person: db.prepare('SELECT * FROM users WHERE id=?').get(user.id) };
}

export function profileView(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email || '',
    title: user.title || '',
    team: user.team || '',
    skills: user.skills || '',
    location: user.location || '',
    availability: user.availability || '',
    experience: user.experience || '',
    initials: user.initials || '',
    color: user.color || '',
    avatarUrl: user.avatar_url || ''
  };
}
