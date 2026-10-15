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
2. The user describes preferences conversationally or selects explicit controls: break length, eligible weekdays, working hours and timezone, daily/weekly frequency, preferred placement, minimum gap, break style (for example quiet/off-screen/movement), maximum breaks per day, excluded times, and whether existing busy events may ever be changed (default: never).
3. Oracle asks concise follow-up questions only for missing or conflicting details and summarizes the resulting preferences for the user to review.
4. PYTHIA analyzes availability and produces individual candidate slots plus the user's requested recurrence. The user can change or remove any candidate before scheduling.
5. The user chooses either **Add selected breaks once** or **Schedule these breaks regularly**. Before any Google write, show the dates, timezone, duration, recurrence, event title/description and any invitees. Personal wellness details remain private by default and are not put in event titles or descriptions.
6. A schedule page lists active plans, next occurrences, last run, status and errors, with pause, resume, edit and cancel controls. Cancellation removes only events owned by that plan.

## LLM and privacy design

- Reuse the existing `consultOracle` gateway/configuration, timeout, structured response parsing, validation and fallback patterns. Add a focused calendar-planning operation in `lib/oracle.mjs`; do not create a second LLM client or API key path.
- Use a two-part planning loop: normalize the user's free-text/preferences into a validated preference object, then use deterministic calendar availability rules to generate valid slots. The model may explain or rank available slots and ask for missing preferences; it must not invent times or call Google write APIs.
- If the model is unavailable or returns invalid data, deterministic local scheduling remains usable and the UI clearly indicates local fallback.
- Keep Google API writes behind an explicit user confirmation. Validate model output and all times server-side against the requested work window, timezone, event conflicts, maximum frequency and available slots.
- Do not send Gmail snippets, email bodies, attendee names/emails, raw event descriptions, or sensitive free-text wellbeing disclosures to the LLM. Prefer a minimal availability representation (busy intervals, timezone, and aggregate meeting density) plus the user's scheduling preferences. If calendar titles are needed for a user-visible explanation, process them locally.
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

- Add a `calendar_plans` table for owner, preference JSON, recurrence, status and metadata; add a `calendar_plan_events` or occurrence table for Google event IDs, intended start/end, job run id and creation state. Final schema should use queryable columns for ownership, status and next run, reserving JSON for flexible preference details.
- Proposed session-owned routes: `POST /api/calendar/plan`, `POST /api/calendar/plans`, `GET /api/calendar/plans`, `PATCH /api/calendar/plans/:id`, `DELETE /api/calendar/plans/:id`, and a bounded run endpoint for scheduled evaluation. Client-supplied user IDs are ignored, consistent with current auth.
- Every query and mutation checks `currentUser().id`; Google tokens are read only within the authenticated request context. Add CSRF/origin checks through the existing auth wrapper.
- Add status information for Google connection, Oracle model mode, next planned occurrence and the last successful/failed job run.

## Local configuration

- Create or update the ignored `Out of Scope dev/.env.local` during implementation. Do not put secrets in tracked files or chat.
- Reuse the existing variables from `.env.example`: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER_NAME`, `LLM_TIMEOUT_MS`, and `EMBEDDING_MODEL`; use the already-configured `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` for Google OAuth.
- The LLM key can be left empty only if the configured SecondStack gateway allows local requests without bearer authentication. Ask Alex to enter any required credential directly in `.env.local`; never fabricate a key or print an existing one.
- Verify variable names and non-secret status only. Restart the server after config changes and show Oracle/calendar readiness in the UI. Never commit `.env.local`, `.env`, token files, or `data/`.

## Acceptance criteria

- A signed-in user can explain their preferences, refine them with Oracle, review validated candidate times, edit the plan, and create only the selected events on the Google account linked to that same session.
- User-selected recurring breaks appear with correct recurrence and timezone and can be edited, paused, resumed and canceled without affecting unrelated events.
- The system handles daylight-saving transitions, overlapping meetings, existing break events, retries, duplicate submissions, token expiry and Google API errors without duplicate or unintended calendar writes.
- LLM use is visible, grounded in availability and preference data, validated, and has a useful local fallback. Sensitive calendar/Gmail data is not sent to the LLM.
- If automatic scheduled analysis is included, it runs only under the documented process-liveness guarantees and does not write to Google without explicit bounded opt-in.
- Automated tests pass, setup and architecture docs are updated, and a signed-in local walkthrough verifies one-time and recurring event creation/cancellation against a test calendar.

## Scope boundary

Recurring Google Calendar break events are implemented in this change. Automatic periodic PYTHIA analysis/proposals remain separate and are not included; they need a scheduler reliability design and clear rules for unattended actions.

## Implementation log — 2026-10-16

Implemented in the `alexkorn/calendar-functionality` branch:

- Calendar Breather now opens a preference form for free-text intent, break duration, weekdays, work hours, and suggestions per day.
- `POST /api/calendar/plan-preview` is session-owned, requires the linked Google account, checks the next seven days of timed and all-day events, and stores generated proposals for the signed-in user.
- The SecondStack calendar operation uses existing Oracle gateway configuration and may rank only locally generated candidate keys. Calendar titles, descriptions, attendees, and Gmail are excluded. A local deterministic planner remains available when the model is unavailable.
- Users select one-time or fixed weekly recurrence (2, 4, 8, or 12 occurrences). The write endpoint checks owner, current availability, and conflicts before creating generic events without invitees. Recurring series can be listed and canceled by their owner.
- Focused tests cover preference validation, timezone-aware slot generation, all-day events, and weekly recurrence conflicts across a daylight-saving transition.

Not included: unattended periodic analysis/jobs, automatic event writes, editing/pausing a recurring series, persistence of structured user preferences, and live Google/SecondStack verification. Weekly recurrence is a fixed Google rule and later calendar edits can introduce conflicts. Verify creation and cancellation using a test Google calendar before presenting live integration behavior as confirmed.
