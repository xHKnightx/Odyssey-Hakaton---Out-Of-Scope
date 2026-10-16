// Session shell for the signed-in app: user chip, sign out, and own-profile onboarding.
// Loaded before app.js; it never touches app.js internals.
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const target = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (response.status === 401 && target.pathname.startsWith('/api/')) location.href = '/login.html';
    return response;
  };

  const $ = selector => document.querySelector(selector);
  const jsonHeaders = { 'content-type': 'application/json' };
  const getMe = () => nativeFetch('/api/auth/me').then(response => {
    if (!response.ok) { location.href = '/login.html'; throw new Error('Sign in required.'); }
    return response.json();
  });

  const style = document.createElement('style');
  style.textContent = `
.profile{flex:none;white-space:nowrap}
.profile .demo-badge{display:none}
.user-chip{display:flex;align-items:center;gap:9px}
.user-chip .user-name{font:600 12px var(--sans);color:var(--fg)}
.user-chip.compact .user-name{display:none}
.user-chip button{padding:5px 9px;border:1px solid var(--line2);border-radius:3px;background:none;color:var(--fg2);font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase}
.user-chip button:hover{border-color:var(--gold);color:var(--fg)}
@media(max-width:1100px){.topbar{flex-wrap:wrap;gap:0 14px;padding:8px 20px 0}.brand small{display:none}nav{order:3;width:100%;height:44px;overflow-x:auto}.profile{margin-left:auto;padding-bottom:8px}}`;
  document.head.append(style);

  function mountUserChip(me) {
    const user = me.user;
    const chip = document.createElement('span');
    chip.className = me.devLogin ? 'user-chip compact' : 'user-chip';
    const avatar = document.createElement('span');
    avatar.className = 'av';
    avatar.style.background = user.color || '#d4a855';
    avatar.textContent = user.initials || user.name.slice(0, 2).toUpperCase();
    avatar.title = user.email || user.name;
    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = user.name;
    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', async () => {
      await nativeFetch('/auth/logout', { method: 'POST', headers: jsonHeaders, body: '{}' });
      location.href = '/login.html';
    });
    chip.append(avatar, name, signOut);
    $('.profile').append(chip);
  }

  function fillProfileForm(me) {
    const form = $('#create-profile-form');
    const user = me.user;
    const own = field => (me.profileComplete ? user[field] : '');
    const set = (name, value) => { form.elements[name].value = value || ''; };
    set('name', user.name);
    set('title', own('title'));
    set('team', own('team'));
    set('location', user.location);
    set('availability', user.availability);
    set('skills', own('skills'));
    set('experience', user.experience);
    $('#create-profile-dialog h2').textContent = me.profileComplete ? 'Your profile' : 'Welcome to PYTHIA';
  }

  async function boot() {
    const me = await getMe();
    mountUserChip(me);
    const button = $('#create-profile');
    button.textContent = 'Edit my profile';
    button.addEventListener('click', async () => fillProfileForm(await getMe()));
    if (!me.profileComplete) {
      fillProfileForm(me);
      $('#create-profile-dialog').showModal();
    }
  }

  boot().catch(() => {});
})();
