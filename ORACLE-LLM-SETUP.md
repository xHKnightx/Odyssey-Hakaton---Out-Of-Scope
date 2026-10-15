# Oracle LLM setup

Oracle can use any gateway that implements the OpenAI-compatible `POST /chat/completions` API. Without these settings it remains usable in local matching mode.

## Configure

Copy `.env.example` to `.env` and set:

```dotenv
LLM_BASE_URL=https://your-gateway.example/v1
LLM_API_KEY=replace-with-a-local-secret
LLM_MODEL=replace-with-a-chat-model
LLM_PROVIDER_NAME=SecondGate
LLM_TIMEOUT_MS=45000
```

`LLM_BASE_URL` may also be the full `/chat/completions` URL. `LLM_API_KEY` may be left empty for a trusted gateway that does not require bearer authentication. Never commit `.env`.

Restart the app after changing `.env`:

```sh
npm start
```

The Seek Wisdom composer displays `Live LLM` and the configured model when the connection is enabled. If a gateway call times out, fails, or returns malformed structured output, Oracle automatically uses local catalogue matching and shows that it fell back.

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

