# PYTHIA local MVP

Small local-first prototype based on the supplied PYTHIA mockup and plans. It uses Node.js built-ins and SQLite; no account, API key, or external database is needed.

## Run it

Requires Node.js 22.13 or newer.

```sh
npm start
```

Open <http://localhost:3000>. The SQLite database is created at `data/pythia.db` on first launch and seeded with demo people, solutions, requests, and contribution history. Remove `data/pythia.db` to reset the demo.

The MVP includes local keyword search, a deterministic demo agent run for Calendar Breather, persisted run feedback and laurels, a simple share form, and views for Expertise, Discoveries, and Pantheon. AI and live provider connections are intentionally stubbed for local use.
