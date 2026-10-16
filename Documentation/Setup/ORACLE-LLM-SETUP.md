# Oracle LLM setup

Oracle can use any gateway that implements the OpenAI-compatible `POST /chat/completions` API. Without these settings it remains usable in local matching mode.

## Configure

Put these settings in `.env` in the project root. If you do not have one yet, copy `.env.example` to `.env`; if you already have one (for example with the Google credentials), append the lines below to it instead of replacing it:

```dotenv
LLM_BASE_URL=https://secondstack.t1a.io/gateway/api/v1
LLM_API_KEY=replace-with-a-local-secret
LLM_MODEL=replace-with-a-chat-model
LLM_PROVIDER_NAME=SecondStack
LLM_TIMEOUT_MS=45000
EMBEDDING_MODEL=text-embedding-3-small
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

`LLM_BASE_URL` may also be the full `/chat/completions` URL. `LLM_API_KEY` may be left empty for a trusted gateway that does not require bearer authentication. Never commit `.env` or `.env.local`.

`.env.local` is optional and is read after `.env`, so its values win. A line with an empty value (`GOOGLE_CLIENT_ID=`) also counts and overrides a filled value from `.env`, so do not copy `.env.example` to `.env.local` as a whole; put only the variables you want to override there.

Restart the app after changing `.env` or `.env.local`:

```sh
npm start
```

To check that the settings were picked up:

- The server log prints `Search index ready: ... mode=hybrid` at start. `mode=exact` or `Embedding backfill failed` means embeddings are unavailable and search is keyword-only.
- While signed in, open `http://localhost:3000/api/oracle/status`. `"configured":true` with the model name means chat is enabled; `retrieval.mode` is `hybrid` when embeddings work; `transcription.configured` covers voice input. `"configured":false` means `LLM_BASE_URL` or `LLM_MODEL` is missing.
- After a Seek Wisdom question the app shows a notice only when something is wrong: `Oracle is using local matching` when the LLM is not configured, or `LLM unavailable · using local matching: <reason>` when a gateway call times out, fails, or returns malformed structured output. Oracle then falls back to local catalogue matching.

The interface does not display a provider or "live" badge.

Calendar Breather uses the same gateway settings and timeout on every scheduled pass. Users choose a Gentle, Balanced, or Extra room mode and an automatic cadence of once daily or once weekly; they do not set a weekly break count. PYTHIA chooses a justified number of breaks, spaces them through demanding weekdays, and selects durations from 5, 7, 8, 9, 10, or 15 minutes. It counts existing holds in the rolling seven-day window to avoid duplicates. The planning dialog enables sentiment context by default, and users can turn it off. When enabled, the model receives bounded recent email subjects/snippets, sanitized upcoming meeting titles and prior meeting titles, and pseudonymous company keys; it analyzes sentiment and uses that signal with calendar load to choose timing. Attendee addresses and full email bodies are never sent. It can recommend only server-generated conflict-free slots. The previous-week view reruns the analysis as a preview only and never creates past events. A deterministic local planner remains when the gateway fails; it cannot provide LLM sentiment analysis. The scheduler runs while the local server process stays up; overdue work is analyzed once after restart.

## Hybrid retrieval

PYTHIA stores employee and solution embeddings in local SQLite. Employee embedding documents contain only role, team, skills, and professional experience; names, location, availability, and contact details are excluded. The default embedding model is SecondStack `text-embedding-3-small` (1,536 dimensions).

On startup, FTS5 records are refreshed when SQLite supports FTS5; only records whose content hash changed are re-embedded. A profile is also re-indexed immediately after creation, an area-of-expertise confirmation, or a `PATCH /api/people/:id` update. Seek Wisdom embeds the user's latest message, combines cosine similarity with local lexical matching, applies a relevance gate, and sends up to five relevant solutions and five relevant anonymized colleague candidates to the chat model. Either candidate list may be empty. If SQLite cannot load FTS5, a built-in token matcher ranks the same local fields. Names are resolved locally only after the model returns validated IDs.

Changing `EMBEDDING_MODEL` creates a separate embedding set and causes all records to be embedded with the new model on the next start.

## Voice transcription

Seek Wisdom and Share Wisdom record microphone audio in the browser and send it to the signed-in-only `POST /api/transcribe` endpoint. The server forwards the recording to the gateway's OpenAI-compatible `/audio/transcriptions` endpoint using `TRANSCRIPTION_MODEL`; the default is `gpt-4o-mini-transcribe`. The transcript is placed in the existing text area for review and is never submitted automatically. Browsers without `MediaRecorder` fall back to the Web Speech API when it is available.

## How recommendations work

The server gives the model the current conversation, the published local solution catalogue, and the local expertise directory. The model must choose one of three paths:

1. `solution`: recommend one existing solution and optionally up to three colleagues;
2. `person`: recommend up to three colleagues with relevant skills;
3. `build`: propose a new skill or agent and provide concrete implementation instructions.

The model can return only database IDs included in its context. The server validates every returned solution and person ID before sending the response to the browser, so invented records are discarded. Catalogue and profile text is explicitly treated as untrusted reference data, not model instructions.

## Local endpoints

- `GET /api/oracle/status` reports whether a live model is configured.
- `POST /api/oracle/chat` accepts `{ userId, messages }`, where messages use `{ role, content }`.
- `POST /api/transcribe` accepts an `audio/*` request body up to 12 MB and returns `{ text, model }`.
- The last 12 messages are sent to the model, with a maximum of 4,000 characters per message.
