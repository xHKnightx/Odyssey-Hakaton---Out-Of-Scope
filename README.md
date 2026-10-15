# PYTHIA local MVP

Small local-first prototype based on the supplied PYTHIA mockup and plans. It uses Node.js built-ins and SQLite; no account, API key, or external database is needed.

## Run it

Requires Node.js 22.13 or newer.

```sh
npm start
```

Open <http://localhost:3000>. The SQLite database is created at `data/pythia.db` on first launch and seeded with demo people, solutions, requests, and contribution history. Remove `data/pythia.db` to reset the demo.

The MVP includes Oracle search/chat, a Calendar Breather run, persisted run feedback and laurels, a simple share form, and views for Expertise, Discoveries, and Pantheon. Oracle can use an OpenAI-compatible LLM gateway, Calendar/Gmail can use Google OAuth, and both retain local demo fallbacks.

The implemented system design and search/data flow are documented in [ARCHITECTURE.md](./ARCHITECTURE.md). The older [PYTHIA-architecture-and-logic.md](./PYTHIA-architecture-and-logic.md) is the broader target design and includes planned components.

## Oracle LLM

Seek Wisdom supports a conversational OpenAI-compatible LLM gateway, grounded in the local solution catalogue and expertise directory. It recommends an existing solution, relevant colleagues, or a new skill/agent plan. Without LLM settings it falls back to local Unicode-aware matching. See [ORACLE-LLM-SETUP.md](./ORACLE-LLM-SETUP.md).
