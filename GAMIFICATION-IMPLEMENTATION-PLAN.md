# Gamification rules: gap audit and implementation log

This work implements the earning rules in `PYTHIA-gamification-framework.md` on the local SQLite data and makes it possible to try actions as different demo profiles.

## Starting point

### Already present

- `wisdom_events` stores point deltas, but most actions write hard-coded records directly in route handlers.
- Overview calculates a lifetime point sum, but the Pantheon itself reads fixed `pantheon_seed` ranks and impact numbers.
- Seek awards 2 points, Share 10, a solution run awards its author 5 on every run, feedback awards 10 for helped and 5 for an optional thank-you note.
- The current person is effectively hard-coded to user ID 1 for Seek, Share, Run, and feedback. New profiles cannot earn points by using those actions.
- New profiles are inserted without initial laurels, which is the correct starting balance, but the UI does not show their level or score.

### Framework rules to wire

- Offering: 10 laurels, exact duplicate guard, max 3 per ISO week.
- Seek: 2 laurels, max 3 per week.
- Solution use: 5 per unique user per solution per month; exclude the author; first external use adds 10 once.
- Confirmed help: 20 laurels, credited to the solution/expert author after seeker feedback.
- Thanks received: 5, once per person pair per week. Giving thanks: 1, max 5 per week.
- Suggested skill confirmation: 1 once per skill.
- Path of the Sage levels: Pilgrim 0, Acolyte 25, Scholar 100, Sage 300, Elder 750, Oracle 1,500.
- Pantheon score and ranks should be computed from events; legacy mockup activity needs a one-time event import so the demo starts populated.

## Implementation steps

1. Centralize award rules, caps, deduplication, and progression in `lib/gamification.mjs`.
2. Migrate event metadata and import mockup Pantheon counts into one-time demo history, preserving seed scores without resetting local data.
3. Route existing Seek, Share, Run, and feedback actions through the rules; make Thanks and skill confirmation persistent actions.
4. Add a local demo-user selector so newly created profiles can earn points; display each profile's laurels and rank.
5. Replace fixed Pantheon totals with event-derived scores, ranks, help/share counts, and saved time; verify database/event behavior and document remaining framework items.

## Step-by-step implementation log

### Step 0 — Audit

- Compared the draft framework with the current schema, route handlers, profile creation, and Pantheon data flow.
- Status: complete.

### Steps 1–5 — Event-based scoring and profile flow

- Added `lib/gamification.mjs` as the single place for event insertion, award caps, duplicate checks, and Path of the Sage thresholds.
- Added event metadata columns (`actor_id`, `reference_id`, `impact_minutes`) with startup migrations for existing local databases.
- Added a one-time import of mockup Pantheon counts into event history. It is marked in `app_meta` so restarts do not duplicate the imported awards.
- Routed Share, Seek, Run, confirmed-help feedback, thanks, and skill confirmation through the award rules. Repeated solution runs by the same colleague in a month do not earn repeated use points; the author’s own runs are excluded. The first external use adds its one-time bonus.
- Weekly caps use the UTC Monday week boundary. Similar offerings are compared with cosine similarity over normalized word counts and earn no points above the framework’s 90% threshold.
- Pantheon totals/ranks and profile levels come from `wisdom_events`. New profiles start at zero, are selected as the active demo identity after creation, and can earn points through the same actions.
- The header’s **Acting as** selector is a local demo identity switch, not authentication. It is useful for exercising multiple profiles on one machine.
- Added feedback messages for awarded and capped/duplicate Share actions; profile and Pantheon scores refresh after awarded actions.
- Added guards against malformed profile IDs, repeated feedback submissions, and thank-you rewards submitted with negative feedback. Skill confirmation updates and its award now commit together.
- Removed the duplicate starter event rows from new database initialization and added a one-time cleanup for those exact legacy bootstrap notes in existing databases, preventing them from being counted again alongside the imported mockup history.
- Pantheon thanks-route troubleshooting now includes method/path details in unmatched-route errors, logs them in the server terminal, and serves app assets with `no-store` to rule out stale browser JavaScript.
- Pantheon podium and hero rows display laurel totals for the selected period; thanking someone refreshes the totals and re-sorts the board.

### Current behavior and limits

- Implemented award rules: offering (10; >90% similarity duplicate guard; 3 per week), consultation (2; 3 per week), solution use (5 per distinct colleague/solution/month; author excluded; first external use +10), confirmed help (20, once per run), thanks received (5 per person pair/week), thanks given (1; 5 per week), and skill confirmation (1 once per skill).
- Progression thresholds are Pilgrim (0), Acolyte (25), Scholar (100), Sage (300), Elder (750), and Oracle (1,500). Points are lifetime totals.
- Legacy Pantheon aggregates are necessarily imported as synthetic event rows at migration time because the mockup contains totals rather than dated event records. Period filters therefore include those imported rows at their import date. Existing starter demo events also remain in the database.
- A new profile itself earns no points. Creating it selects it; using an action as that profile is what changes its laurels.
- Framework items still not implemented: +5 offering-to-open-request match, resolved-request (+3) flow, Labor bounties, Sacred Flame and bonuses, honorific recomputation, City-state rankings, quarterly Olympiad reset, Pantheon opt-out, and the weekly/monthly notification rituals. Duplicate detection is lexical cosine similarity rather than embedding similarity. Rank unlock permissions are not enforced yet.
- This local demo has no sign-in or authorization; the selector is not safe for shared/public deployment.

### Verification status

- JavaScript syntax checks passed for `server.mjs`, `public/app.js`, and `lib/gamification.mjs` before the final duplicate/week-boundary adjustment; rerun them after this update.
- Earlier isolated SQLite checks covered award caps, duplicate guards, monthly unique use and first-use bonus, self-use exclusion, help idempotency, thank-you pair caps, skill confirmation idempotency, and progression thresholds.
- A live browser walkthrough has not been completed in this environment. The app server could not bind to localhost here (`EPERM`); run it from the user’s Terminal to check the UI.
