# PYTHIA local MVP

Small local-first prototype based on the supplied PYTHIA mockup and plans. It uses Node.js built-ins and SQLite; no account, API key, or external database is needed.

## Run it

Requires Node.js 22.13 or newer.

```sh
npm start
```

Open <http://localhost:3000>. The SQLite database is created at `data/pythia.db` on first launch and seeded with demo people, solutions, requests, and contribution history. Remove `data/pythia.db` to reset the demo.

## Signing in

Every page and API call needs a session. The login page offers two ways in:

- **Sign in with Google** — company accounts only (`AUTH_ALLOWED_DOMAINS`, default `t1a.com`). It asks Google for identity only (`openid email profile`); Calendar and Gmail are connected separately under Connections, and only for the account you signed in with. The first sign-in creates your profile and asks for your role and skills.
- **Demo persona** (development login) — pick any seeded colleague. It is on while the Google credentials in `.env` are empty, or when `AUTH_DEV_LOGIN=1`, and is always off when `NODE_ENV=production`. With it on, the "Acting as" selector in the header switches the whole session to another persona.

The people you see are the people in the database; the identity of the person making a request always comes from the session, never from the request body.

| Variable | Meaning |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google OAuth client, see [GOOGLE-SETUP.md](GOOGLE-SETUP.md) |
| `AUTH_ALLOWED_DOMAINS` | Comma-separated email domains allowed to sign in (default `t1a.com`) |
| `AUTH_DEV_LOGIN` | `1` on, `0` off, empty = on only while Google is not configured |
| `SESSION_TTL_HOURS` | Session lifetime, default 12 |
| `AUTH_COOKIE_SECURE` | `1` to force the `Secure` cookie flag (automatic when the redirect URI is https) |

Run the tests with `npm test` (Node's built-in runner, no dependencies). They start the real server from a temporary copy, so your `data/` folder is never touched.

The MVP includes local keyword search, a deterministic demo agent run for Calendar Breather, persisted run feedback and laurels, a simple share form, and views for Expertise, Discoveries, and Pantheon. AI and live provider connections are intentionally stubbed for local use.
