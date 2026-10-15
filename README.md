# PYTHIA local MVP

Small local-first prototype based on the supplied PYTHIA mockup and plans. It uses Node.js built-ins and SQLite; no account, API key, or external database is needed.

## Run it

Requires Node.js 22.13 or newer.

```sh
npm start
```

Open <http://localhost:3000>. The SQLite database is created at `data/pythia.db` on first launch and seeded with demo people, solutions, requests, and contribution history.

For a clean demo database, stop the application and run:

```sh
npm run db:reset
```

The command archives the previous SQLite files under `data/backups/`, then creates a fresh database from the current versioned seed. Start the application normally afterward.

The MVP includes Oracle search/chat, a Calendar Breather run, persisted run feedback and laurels, a simple share form, and views for Expertise, Discoveries, and Pantheon. Oracle can use an OpenAI-compatible LLM gateway, Calendar/Gmail can use Google OAuth, and both retain local demo fallbacks.

Project documentation is collected in the [Documentation index](./Documentation/README.md). The implemented system design and search/data flow are documented in [the current architecture](./Documentation/Architecture/ARCHITECTURE.md); the [target architecture](./Documentation/Architecture/PYTHIA-architecture-and-logic.md) describes broader planned components.

## Oracle LLM

Seek Wisdom supports a conversational OpenAI-compatible LLM gateway, grounded in the local solution catalogue and expertise directory. It recommends an existing solution, relevant colleagues, or a new skill/agent plan. Without LLM settings it falls back to local Unicode-aware matching. See the [Oracle LLM setup guide](./Documentation/Setup/ORACLE-LLM-SETUP.md).
