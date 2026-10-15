const list = value => String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
const flag = value => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());

// Read lazily: server.mjs loads .env after its imports have been evaluated.
export function authConfig() {
  const googleReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const explicit = process.env.AUTH_DEV_LOGIN;
  // Without Google credentials nobody could sign in, so the persona login is on unless it is switched off explicitly.
  const devLogin = explicit === undefined || explicit === '' ? !googleReady : flag(explicit);
  return {
    allowedDomains: list(process.env.AUTH_ALLOWED_DOMAINS || 't1a.com'),
    devLogin: devLogin && process.env.NODE_ENV !== 'production',
    sessionTtlMs: Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 12) * 3_600_000,
    cookieSecure: flag(process.env.AUTH_COOKIE_SECURE) || /^https:/i.test(process.env.GOOGLE_REDIRECT_URI || '')
  };
}
