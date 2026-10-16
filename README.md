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

The MVP includes Oracle search/chat, a recurring Calendar Breather analysis loop with automatic tentative calendar holds and Accept/Decline responses, persisted run feedback and laurels, a simple share form, and views for Expertise, Discoveries (most common requests, solved and unsolved counts, skills and apps in the catalogue, filterable by period), and Pantheon. Oracle planning uses the configured OpenAI-compatible gateway with a local fallback. The Oracle analyzes the next seven days on a once-daily or once-weekly schedule. Users choose a Gentle, Balanced, or Extra room mode; PYTHIA chooses break count, placement, and 5/7/8/9/10/15-minute duration. Meeting sentiment analysis uses related calendar and email context, enabled by default in the planning form and easy to turn off. A previous-week replay is preview-only and never writes to Google Calendar. The scheduler runs while the local server is running.

Project documentation is collected in the [Documentation index](./Documentation/README.md). The implemented system design and search/data flow are documented in [the current architecture](./Documentation/Architecture/ARCHITECTURE.md); the [target architecture](./Documentation/Architecture/PYTHIA-architecture-and-logic.md) describes broader planned components.

## Oracle LLM

Seek Wisdom supports a conversational OpenAI-compatible LLM gateway, grounded in the local solution catalogue and expertise directory. It recommends an existing solution, relevant colleagues, or a new skill/agent plan. Without LLM settings it falls back to local Unicode-aware matching. See the [Oracle LLM setup guide](./Documentation/Setup/ORACLE-LLM-SETUP.md).

Share Wisdom uses the same configured chat model to extract **areas of expertise**, experience, and reusable assets from a free-text contribution. An area of expertise is a human capability and never becomes a catalogue asset unless the message explicitly describes a created or used artifact/workflow and supplies supporting source evidence. Catalogue `skill` records are labelled **Playbook / Agent skill** in the UI. The contributor reviews and edits the draft before confirmation; confirmed profile data and catalogue assets are stored locally and indexed for Seek Wisdom. Shared catalogue agents are not executable until a runner integration is added.

On first sign-in, a colleague can optionally describe their work in free text and use **Extract with Pythia** to draft role, team, areas of expertise, and experience. The draft is review-only until the profile form is submitted and never publishes catalogue solutions.

## Signing in

Every page and API call needs a session. The login page offers two ways in:

- **Sign in with Google** — company accounts only (`AUTH_ALLOWED_DOMAINS`, default `t1a.com`). It requests identity only (`openid email profile`); Calendar and Gmail are connected separately under Connections, and only for the account you signed in with. The first sign-in creates your profile and asks for your role and areas of expertise.
- **Demo persona** (development login) — pick any seeded colleague. It is on while the Google credentials in `.env` are empty or when `AUTH_DEV_LOGIN=1`, and it is always off when `NODE_ENV=production`.

The identity of the person making a request always comes from the session, never from the request body. Setup steps are in the [Google setup guide](./Documentation/Setup/GOOGLE-SETUP.md); the session model and API gating are described in the [current architecture](./Documentation/Architecture/ARCHITECTURE.md#authentication-and-sessions).

## Tests

```sh
npm test
```

Node's built-in runner, no dependencies. The HTTP tests start the real server from a temporary copy of the sources, so the `data/` folder is never touched.
