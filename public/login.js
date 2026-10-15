const $ = selector => document.querySelector(selector);

const MESSAGES = {
  domain: 'This Google account is not allowed. Sign in with your company account.',
  email_unverified: 'Google has not verified the email of this account.',
  denied: 'Sign-in was cancelled.',
  state: 'The sign-in request expired. Please try again.',
  token: 'Google returned a response PYTHIA could not trust. Please try again.',
  exchange: 'Google sign-in failed. Please try again.',
  config: 'Google sign-in is not configured on this server.'
};

function showError(message) {
  const box = $('#login-error');
  box.textContent = message;
  box.classList.add('show');
}

async function init() {
  const code = new URLSearchParams(location.search).get('error');
  if (code) showError(MESSAGES[code] || MESSAGES.exchange);

  const config = await fetch('/auth/config').then(response => response.json());
  const google = $('#login-google');
  if (!config.googleConfigured) {
    google.setAttribute('aria-disabled', 'true');
    $('#login-note').textContent = 'Google sign-in is not configured: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.';
  } else {
    $('#login-note').textContent = 'Exclusively for T1Aers.';
  }

  if (!config.devLogin) return;
  const { personas } = await fetch('/auth/personas').then(response => response.json());
  for (const person of personas) $('#login-persona').append(new Option(`${person.name} · ${person.title || ''}`, person.id));
  $('#login-dev').classList.add('show');
  $('#login-dev').addEventListener('submit', async event => {
    event.preventDefault();
    const response = await fetch('/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: Number($('#login-persona').value) })
    });
    if (response.ok) location.href = '/';
    else showError((await response.json().catch(() => ({}))).error || 'Sign-in failed.');
  });
}

init().catch(() => showError('Could not reach the PYTHIA server.'));
