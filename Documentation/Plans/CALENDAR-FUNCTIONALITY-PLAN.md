# Calendar recovery breaks and scheduling plan

## Goal

Let a signed-in colleague describe what helps them recover during a demanding workday, get calendar-aware break suggestions through the existing PYTHIA Oracle/SecondStack LLM flow, and review and schedule those breaks in their own Google Calendar. Support both a one-time plan and recurring calendar breaks. Treat recurring automatic calendar checks as a distinct capability, because they need a reliable scheduler and clear rules for when PYTHIA may write events without a person reviewing each run.

## Baseline before this feature

- Google sign-in and server sessions identify the current user. Google Calendar/Gmail OAuth tokens are stored per user, and Google connection is separate from sign-in.
- `lib/calendar.mjs` reads the primary calendar for a fixed five-day window, fetches recent Gmail snippets for meeting participants, computes strain locally, and proposes a fixed 20-minute break in an available weekday gap.
- The browser can run Calendar Breather, inspect the analysis and select suggested gaps. `/api/calendar/invites` creates selected one-off events after the user confirms. Run ownership is checked against the signed-in session.
- `lib/oracle.mjs` already owns the OpenAI-compatible SecondStack chat request, timeouts, JSON extraction/validation, status, and local fallback. It currently plans knowledge recommendations, not recovery breaks.
- There is no calendar preference input, variable duration, recurring event rule, persisted schedule/job, background scheduler, pause/resume or edit/cancel flow for a recurring plan.
- The `dev` checkout has no `.env.local` or `.env`. The server loads `.env` first and `.env.local` second, so `.env.local` takes precedence. `.env.local` is ignored by Git.

## Proposed user flow

1. A signed-in user opens Calendar Breather. The UI confirms which Google account owns the connected calendar and offers **Connect Google** if needed.
2. The user chooses 5, 10, or 15 minutes, a reset style (breathing, quiet, coffee/tea, gentle stretch, fresh air, or surprise), weekdays, work hours, and a weekly limit.
3. Oracle may explain and rank the locally generated candidate slots. Calendar contents remain local. If the model is unavailable, deterministic suggestions still work.
4. On submit, PYTHIA adds up to the user's weekly limit of private tentative holds to the primary calendar. The browser and Connections inbox show each hold with **Accept** and **Decline** actions; accept confirms the event and decline deletes it.
5. Titles and copy are warm and lightly playful, while the user controls the break style. Calendar load is not used to assess burnout, diagnose health, or score employees.
6. This first autonomous step runs when the user submits Calendar Breather preferences. It does not run as a background job, and these are tentative holds on the user's calendar rather than invitations from a separate organizer with Google-native RSVP.

## LLM and privacy design

- Reuse the existing `consultOracle` gateway/configuration, timeout, structured response parsing, validation and fallback patterns. Add a focused calendar-planning operation in `lib/oracle.mjs`; do not create a second LLM client or API key path.
- Use a two-part planning loop: normalize the user's free-text/preferences into a validated preference object, then use deterministic calendar availability rules to generate valid slots. The model may explain or rank available slots and ask for missing preferences; it must not invent times or call Google write APIs.
- If the model is unavailable or returns invalid data, deterministic local scheduling remains usable and the UI clearly indicates local fallback.
- Create only bounded tentative holds after the user submits explicit automation preferences. Require a separate accept/decline action to confirm or delete each one. Validate all times server-side against the requested work window, timezone, conflicts, weekly limit and available slots.
- Do not send Gmail snippets, email bodies, attendee names/emails, raw event descriptions, or health data to the LLM. The UI warns users not to include medical or sensitive details in the scheduling note; send only the user-entered scheduling/activity note, normalized preferences, and minimal safe slot metadata.
- Do not add clinical claims, diagnoses, or employee wellness scoring. This is a user-directed scheduling aid; the user controls the preference data and can delete a plan.

## Implementation phases

### Phase 1 — User-directed one-time planning

- Build a preferences form and conversational refinement in Calendar Breather, authenticated to the current session.
- Add a calendar-specific structured Oracle operation, validated response schema, model/fallback status and deterministic slot generation for variable-length breaks.
- Make the calendar analysis endpoint use the current user's Google token explicitly and reject missing connections with a clear actionable response rather than silently treating a signed-in user's live action as demo data.
- Return proposals with timezone-aware labels, editable duration/times, conflict checks and useful reasons. Keep confirmation as the only path that creates Google events.
- Add unit and HTTP tests for preference validation, timezone boundaries/DST, overlapping events, model malformed output/fallback, session ownership, and write confirmation/idempotency.

### Phase 2 — Recurring calendar breaks

- Persist each user's plan and normalized preferences in SQLite, with owner id, timezone, recurrence, status and timestamps. Store Google event IDs for cancellation/update. Add additive startup migrations and preserve existing data.
- Create recurring Google Calendar events using validated Google-supported recurrence rules (for example weekly days and end date/count). Preview the recurrence and timezone before writing.
- Provide list, edit, pause/resume and cancel endpoints scoped to the signed-in owner. Make create/update/cancel idempotent and handle partial Google failures without losing the plan state.
- Decide whether a plan uses a single recurring event or individually generated instances. Prefer a Google recurring event for fixed weekly slots; use individual confirmed events when availability is re-evaluated each week.

### Phase 3 — Scheduled automatic jobs (separate from recurring events)

- If the user means automatic periodic analysis, implement this as a separate persisted job that checks availability at a user-selected cadence and creates candidate proposals. Do not equate this with a recurring event rule.
- Default scheduled jobs to **propose and notify, never write**, until the user explicitly enables a narrowly scoped auto-add policy. Auto-add must define maximum events, allowed windows, conflict re-checking, advance notice and an immediate pause control.
- For the local demo, document that an in-process scheduler runs only while the local server is awake. For dependable production scheduling, use an external durable scheduler/worker; do not imply a laptop-local process can run while stopped or asleep.
- Prevent duplicate runs and calendar events with stable job/occurrence keys, leases or equivalent single-process locking, retry limits, and audit records.

## Data and API outline

- Store each user's normalized choices in `calendar_preferences`; use `calendar_proposals` for owner-linked pending, accepted, and declined calendar holds, including Google event IDs and activity themes.
- Session-owned routes include `GET /api/calendar/preferences`, `POST /api/calendar/plan-preview`, `GET /api/calendar/pending`, and `POST /api/calendar/invitations/:id/respond`. Client-supplied user IDs are ignored, consistent with current auth.
- Every query and mutation checks `currentUser().id`; Google tokens are read only within the authenticated request context. Add CSRF/origin checks through the existing auth wrapper.
- Add status information for Google connection, Oracle model mode, next planned occurrence and the last successful/failed job run.

## Local configuration

- Create or update the ignored `Out of Scope dev/.env.local` during implementation. Do not put secrets in tracked files or chat.
- Reuse the existing variables from `.env.example`: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER_NAME`, `LLM_TIMEOUT_MS`, and `EMBEDDING_MODEL`; use the already-configured `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for Google OAuth.
- The LLM key can be left empty only if the configured SecondStack gateway allows local requests without bearer authentication. Ask Alex to enter any required credential directly in `.env.local`; never fabricate a key or print an existing one.
- Verify variable names and non-secret status only. Restart the server after config changes and show Oracle/calendar readiness in the UI. Never commit `.env.local`, `.env`, token files, or `data/`.

## Acceptance criteria

- A signed-in user can save 5/10/15-minute preferences and select a reset activity, work hours, weekdays, and weekly cap.
- Submitting preferences creates no more than the chosen cap of tentative private events on that user's connected calendar; accept confirms and decline deletes the event.
- Candidate slots are locally generated and conflict-free at proposal time. The LLM can rank only existing candidates; local fallback remains usable.
- The app does not infer burnout or send calendar titles, descriptions, attendee data, or Gmail content to the LLM.
- Automated tests pass; live Google event creation, accept, and decline still need a signed-in walkthrough with a test calendar.

## Scope boundary

This iteration automatically creates a capped set of tentative holds when the user submits preferences. A persistent background scheduler and genuine organizer-sent Google invitation emails/native RSVP remain out of scope; those need a durable scheduler and a separate organizer identity.

## Implementation log — 2026-10-16

Implemented in the `alexkorn/calendar-functionality` branch:

- Calendar Breather now opens a preference form for free-text intent, 5/10/15-minute duration, activity style, work hours, weekdays, and weekly invitation limit. Preferences are saved per signed-in user.
- `POST /api/calendar/plan-preview` is session-owned, requires the linked Google account, checks the next seven days of timed and all-day events, and stores candidate proposals.
- The SecondStack calendar operation uses existing Oracle gateway configuration and may rank only locally generated candidate keys. Calendar titles, descriptions, attendees, and Gmail are excluded. A local deterministic planner remains available when the model is unavailable.
- Submitting preferences automatically creates up to the weekly limit of private tentative events. The owner can accept (confirm) or decline (delete) each from the result screen or Connections inbox. These are calendar holds, not native Google invitation emails; no separate organizer is configured.
- Activity choices include breathing, quiet, coffee/tea, gentle stretch, fresh air, and surprise. Copy is lightly playful and there is no burnout inference.
- Focused tests cover preference validation, timezone-aware slot generation, all-day events, and weekly recurrence conflicts across a daylight-saving transition.

Not included: future batches sent by a background scheduler, native Google invitation emails/RSVP from a separate organizer, and live Google/SecondStack verification. A new batch is prepared when the user submits Calendar Breather preferences; later calendar edits may conflict with holds. Verify creation, accept, and decline against a test calendar before presenting live integration behavior as confirmed.
