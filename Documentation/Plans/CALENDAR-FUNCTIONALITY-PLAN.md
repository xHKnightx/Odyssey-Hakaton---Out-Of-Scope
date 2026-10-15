# Calendar recovery breaks and scheduling plan

## Goal

Let a signed-in colleague describe what helps them recover during a demanding workday, get calendar-aware break suggestions through the existing PYTHIA Oracle/SecondStack LLM flow, and review and schedule those breaks in their own Google Calendar. Support both a one-time plan and recurring calendar breaks. Treat recurring automatic calendar checks as a distinct capability, because they need a reliable scheduler and clear rules for when PYTHIA may write events without a person reviewing each run.

## Baseline before this feature

- Google sign-in and server sessions identify the current user. Google Calendar/Gmail OAuth tokens are stored per user, and Google connection is separate from sign-in.
- `lib/calendar.mjs` reads calendar events, fetches bounded Gmail snippets when context is enabled, builds weekday-only conflict-free recovery slots, and supports both upcoming and retrospective seven-day windows.
- The browser can run Calendar Breather, inspect the analysis and select suggested gaps. `/api/calendar/invites` creates selected one-off events after the user confirms. Run ownership is checked against the signed-in session.
- `lib/oracle.mjs` already owns the OpenAI-compatible SecondStack chat request, timeouts, JSON extraction/validation, status, and local fallback. It currently plans knowledge recommendations, not recovery breaks.
- The current build stores a local automation job and supports pause/resume; it runs on the selected cadence while the server process is running.
- The `dev` checkout has no `.env.local` or `.env`. The server loads `.env` first and `.env.local` second, so `.env.local` takes precedence. `.env.local` is ignored by Git.

## Proposed user flow

1. A signed-in user opens Calendar Breather. The UI confirms which Google account owns the connected calendar and offers **Connect Google** if needed.
2. The user chooses Gentle, Balanced, or Extra room mode and whether the loop runs once daily or once weekly. PYTHIA chooses the count and 5/7/8/9/10/15-minute durations.
3. Each pass analyzes the next seven days and, when the user opts in, related emails and prior meetings. The Oracle decides the total number of breaks that suit the rolling seven-day window, counting existing holds, and picks only conflict-free slots. If the model is unavailable, a local workload/context fallback remains available.
4. On submit, PYTHIA starts the recurring local job and runs its first analysis immediately. The browser shows a seven-day calendar preview and the browser and Connections inbox show holds with **Accept** and **Decline** actions; accept confirms the event and decline deletes it. Planning errors appear in the preferences dialog. The loop continues while the local app server is running and resumes overdue work once after restart.
5. Titles and copy are warm and lightly playful, while the user controls the break style. Calendar load is not used to assess burnout, diagnose health, or score employees.
6. The first analysis runs when preferences are submitted. The saved job then repeats once daily or once weekly while the local server is running. These are tentative holds on the user's calendar rather than invitations from a separate organizer with Google-native RSVP.

## LLM and privacy design

- Reuse the existing `consultOracle` gateway/configuration, timeout, structured response parsing, validation and fallback patterns. Add a focused calendar-planning operation in `lib/oracle.mjs`; do not create a second LLM client or API key path.
- On each scheduled pass, normalize preferences, analyze the current calendar/context, generate valid slots deterministically, and ask the Oracle to choose a total target for the rolling seven-day window and slot keys. The model must not invent times or call Google write APIs.
- If the model is unavailable or returns invalid data, deterministic local scheduling remains usable and the UI clearly indicates local fallback.
- Create only Oracle-selected tentative holds after the user enables the automation. Require a separate accept/decline action to confirm or delete each one. Validate all times server-side against the fixed planning window, timezone, conflicts, existing daily holds and available slots.
- With meeting context enabled (checked by default), send only bounded email subjects/snippets, sanitized meeting titles, prior meeting titles, and pseudonymous company keys; never send attendee addresses or full email bodies. The user can turn context analysis off. Without it, the LLM sees only calendar load and generated candidate slots.
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

- A signed-in user can choose a recovery mode and a daily or weekly analysis cadence; PYTHIA chooses a supported break count and length, and the live preview covers weekdays in the next seven days.
- Each scheduled pass analyzes calendar/context and lets the Oracle choose the total break target for the next seven days; repeated passes count existing holds to avoid over-scheduling. Accept confirms and decline deletes each event.
- Candidate slots are locally generated and conflict-free at proposal time. The LLM can rank only existing candidates; local fallback remains usable.
- The app does not infer burnout. When context analysis is disabled, calendar titles, attendee data, and Gmail content are not sent to the LLM.
- Context analysis is enabled by default and can be turned off. It reviews up to 90 days of prior meetings plus recent bounded Gmail subjects/snippets, grouped locally by external attendee company domain; sanitized titles and snippets are sent to SecondStack for tone analysis. Full email bodies and attendee addresses stay local.
- When enabled, the Oracle may recommend a warm, lightly funny 15-minute hold immediately before a meeting when the context sounds tense. The slot must fit the configured workday and avoid existing events; the invitation remains private and tentative with PYTHIA Accept/Decline controls.
- Automated tests pass; live Google event creation, accept, and decline still need a signed-in walkthrough with a test calendar.

## Scope boundary

This iteration runs a persisted local scheduler while the server process is active. It does not run while the Mac/app is stopped. Genuine organizer-sent Google invitation emails/native RSVP remain out of scope and need a separate organizer identity.

## Implementation log — 2026-10-16

Implemented in the `alexkorn/calendar-functionality` branch:

- Calendar Breather opens a preference form for Gentle, Balanced, or Extra room mode and an analysis cadence of once daily or once weekly; PYTHIA selects 5/7/8/9/10/15-minute breaks. The Oracle determines how many breaks suit the next seven days. A persistent local job is started and analyzed immediately, then continues at the chosen cadence while the server is running.
- `POST /api/calendar/plan-preview` is session-owned, requires the linked Google account, checks the next seven days of timed and all-day events, and stores candidate proposals.
- The SecondStack calendar operation uses existing Oracle gateway configuration and may rank only locally generated candidate keys. By default, calendar titles, descriptions, attendees, and Gmail are excluded. The separate opt-in context analysis shares bounded email snippets and sanitized meeting titles. A local deterministic planner remains available when the model is unavailable.
- Submission errors now appear inside the modal rather than behind it, including a clear prompt to connect Google Calendar when required.
- The run result previews weekdays in the analyzed week with existing calendar events and proposed PYTHIA breaks, and can replay the previous calendar week in read-only preview mode. Accept/Decline controls are bound in both the run result and Connections inbox, with API errors shown beside the invitation. Both views provide an Accept all action. The Connections view reports the automation cadence, next pass and latest error, and lets the user pause or resume the job. Google has a reauthorization link for newly requested Calendar/Gmail scopes.
- Submitting preferences starts the analysis loop. The Oracle decides break count, duration, and spacing from the selected mode, calendar load, and enabled sentiment context; it counts existing holds and adds only justified tentative events within the rolling seven-day window. The owner can accept or decline them from the result screen or Connections inbox.
- Seek search expands common calendar-overload wording (such as “wall-to-wall client calls” and “no time to think”) to find Calendar Breather even when the user does not use the word “calendar.” Its recommendation card explains the agent's workflow. The Oracle reply identifies whether the live LLM or local fallback produced the answer and shows the fallback reason when applicable.
- Warm activity themes remain part of the Oracle's context-aware suggestions; the planning form asks for a recovery mode and daily or weekly analysis cadence. PYTHIA chooses the break count and allowed duration. There is no burnout inference.
- The previous-week selector replays last week's weekday calendar with simulated break suggestions. It is strictly read-only: the route does not create runs, proposals, rewards, or Google events, and the server allows past slot times only for that dry run.
- The planner now sends daily meeting-load summaries and same-company meeting ordinals/history to the Oracle. A third long meeting with the same client is treated as accumulated pressure. It prioritizes one break on each weekday with a usable candidate, spreads extra breaks across the week, and enforces a per-day ceiling based on recovery mode; fallback planning follows the same distribution rules.
- PYTHIA breaks must have at least 30 minutes of open time between them. The planner checks both existing PYTHIA holds and newly proposed breaks, and the server repeats that check before returning or creating a proposal.
- Focused tests cover preference validation, timezone-aware slot generation, all-day events, and weekly recurrence conflicts across a daylight-saving transition.

Not included: scheduler execution while the local server is stopped, native Google invitation emails/RSVP from a separate organizer, and live Google/SecondStack verification. Later calendar edits may conflict with existing holds. Verify recurring execution, event creation, accept, and decline against a test calendar before presenting live integration behavior as confirmed.
