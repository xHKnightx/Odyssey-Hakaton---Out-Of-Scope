# Oracle LLM setup

Oracle can use any gateway that implements the OpenAI-compatible `POST /chat/completions` API. Without these settings it remains usable in local matching mode.

## Configure

Copy `.env.example` to `.env.local` and set:

```dotenv
LLM_BASE_URL=https://secondstack.t1a.io/gateway/api/v1
LLM_API_KEY=replace-with-a-local-secret
LLM_MODEL=replace-with-a-chat-model
LLM_PROVIDER_NAME=SecondStack
LLM_TIMEOUT_MS=45000
EMBEDDING_MODEL=text-embedding-3-small
```

`LLM_BASE_URL` may also be the full `/chat/completions` URL. `LLM_API_KEY` may be left empty for a trusted gateway that does not require bearer authentication. Never commit `.env.local`. When both files exist, `.env.local` overrides `.env`.

Restart the app after changing `.env.local`:

```sh
npm start
```

The Seek Wisdom composer displays `Live LLM` and the configured model when the connection is enabled. If a gateway call times out, fails, or returns malformed structured output, Oracle automatically uses local catalogue matching and shows that it fell back.

Calendar Breather uses the same gateway settings and timeout in a calendar-specific planning request. It sends the user's break preference note and safe candidate slot metadata (date/time and duration), never event titles, descriptions, attendees, or Gmail. The model can rank only server-generated slot keys; deterministic local suggestions remain available if the gateway fails. The Calendar Breather result shows whether the live model or local fallback produced the plan.

## Hybrid retrieval

PYTHIA stores employee and solution embeddings in local SQLite. Employee embedding documents contain only role, team, skills, and professional experience; names, location, availability, and contact details are excluded. The default embedding model is SecondStack `text-embedding-3-small` (1,536 dimensions).

On startup, FTS5 records are refreshed and only records whose content hash changed are re-embedded. A profile is also re-indexed immediately after creation, a skill confirmation, or a `PATCH /api/people/:id` update. Seek Wisdom embeds the user's latest message, combines cosine similarity with local FTS5 exact matching, and sends at most five solutions and five anonymized colleague candidates to the chat model. Names are resolved locally only after the model returns validated IDs.

Changing `EMBEDDING_MODEL` creates a separate embedding set and causes all records to be embedded with the new model on the next start.

## How recommendations work

The server gives the model the current conversation, the published local solution catalogue, and the local expertise directory. The model must choose one of three paths:

1. `solution`: recommend one existing solution and optionally up to three colleagues;
2. `person`: recommend up to three colleagues with relevant skills;
3. `build`: propose a new skill or agent and provide concrete implementation instructions.

The model can return only database IDs included in its context. The server validates every returned solution and person ID before sending the response to the browser, so invented records are discarded. Catalogue and profile text is explicitly treated as untrusted reference data, not model instructions.

## Local endpoints

- `GET /api/oracle/status` reports whether a live model is configured.
- `POST /api/oracle/chat` accepts `{ userId, messages }`, where messages use `{ role, content }`.
- The last 12 messages are sent to the model, with a maximum of 4,000 characters per message.
