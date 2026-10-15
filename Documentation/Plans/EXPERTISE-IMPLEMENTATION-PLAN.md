# Expertise: mockup gap audit and implementation log

This document tracks the Expertise directory against the supplied [`PYTHIA for SecondStack (1).html`](<../Reference/PYTHIA for SecondStack (1).html>) mockup. The audit captures the starting state; the status column reflects the current implementation. Each implementation step is recorded here before moving on to the next step.

## Mockup gap audit

### Data and persistence

| Capability | Mockup / seed data | Current implementation | Remaining gap |
|---|---|---|---|
| Colleague directory | Name, role, team, skills, avatar initials/color, and some availability | Seeded SQLite contains 38 profiles (Anastasia plus 37 directory colleagues), including varied IT consulting examples and a labeled synthetic test profile | None for create and browse; editing or deleting profiles is not implemented |
| User profile | Anastasia profile with skills and suggested skills that can be confirmed | Anastasia's profile card remains a static mockup; Confirm buttons only show a toast | Editing the current user's profile and persisting confirmed suggestions remain unimplemented |
| Experience evidence | Mockup includes project evidence in expert recommendations and in the sharing flow | Colleague records have a persisted experience field, and profile details display it | Skill provenance and multiple structured project records are not modeled separately |
| Profile creation | Mockup's Share flow asks what the person knows, experience, and what they built; it can update Expertise | Expertise has a create form backed by `POST /api/people`, with validation and SQLite persistence | The existing Share offering form remains separate and does not create a profile |
| Test person | Mockup has realistic colleagues to explore | Seed includes the clearly labeled `Alex Example (Test Profile)` with five skills and synthetic project experience | None for local testing |

### Front-end behavior

| Capability | Already present | Missing / incomplete |
|---|---|---|
| Search | Live text search across name, role, team, location, and skills | Implemented; selecting a skill in profile details puts it in search | One free-text query; comma-separated AND search and multi-select skill facets are not implemented |
| Team filters | Team/category chips in the directory | Team/category chips are generated from current profiles, including user-created teams | Heuristic categories can be broad (for example, CRM is grouped under Sales) |
| Profile details | Clicking a directory row opens a dialog with role, team, location, skills, and availability | Implemented with project example when available | Skill provenance and profile editing are not implemented |
| Skill navigation | Selecting a skill in profile details searches the directory | Implemented; result can also be narrowed by category/team | Directory row tags are not individual click targets because rows themselves open profiles |
| Ask a colleague | Opens an editable, prefilled local message draft | It does not send a message; this local-only behavior is labeled in the UI |
| Add profile | No UI | Create form, API validation, SQLite save, and refreshed search results are implemented; browser-level interaction remains unverified here |

## What has already been added on top of the mockup

- Expanded the original mockup's small directory into a broader IT consulting demo directory (38 seeded profiles total, including Anastasia and one test profile).
- Added persistent SQLite startup seeding and a searchable directory with team filters.
- Added a profile detail dialog, skill-to-search interaction, result count, and a drafted ask flow. These were added during the current work and should be verified in the running app.
- Added a Google Calendar/Gmail local OAuth setup and Calendar Breather live/demo analysis path. These are separate from Expertise and will be tracked in their own work log if changed.

## Implementation steps

1. **Gap audit (complete):** compare mockup data and interactions with current persistence and UI; record what's present and missing here.
2. **Profile data model and API (complete):** support user-created colleague profiles with structured profile and experience fields, validation, and stable SQLite persistence. Keep seeded demo profiles intact.
3. **Mockup-style test profile (complete):** add an unmistakably labeled test profile with realistic IT consulting skills and a clearly synthetic project example, so the user can test search, details, and filtering immediately.
4. **Create profile UI (complete):** add a guided form for name, role, team, location, availability, skills, and experience; save through the API and refresh the directory.
5. **Complete profile-to-search flow (complete):** show experience in details, make skill chips searchable, and confirm a newly created test profile is discoverable by skill and team.
6. **End-to-end review (in progress):** document a manual walkthrough and any known limits. Do not claim a messaging send or external directory sync unless implemented.
7. **Broaden seeded expertise (complete):** add ten more synthetic consultants across varied practices and bump the seed version for existing local databases.

## Step-by-step implementation log

### Step 1 — Gap audit

- Compared the mockup Expertise directory and profile/share flow to the seed JSON, SQLite schema, API, and MVP UI.
- Recorded current behavior, missing data/API capabilities, and already-added enhancements above.
- Status: complete.

### Step 2 — Profile data model and API

- Added a persistent `experience` field to colleague profiles, including a startup migration for existing local SQLite databases.
- Added `POST /api/people` to create profiles with name, role, team, optional location/availability/experience, and one or more skills.
- Added required-field, length, skill-count, and duplicate-name validation. New profiles receive generated initials and an avatar color and are returned in the standard overview query.
- Existing seeded profiles are preserved and updated by the existing versioned seed mechanism.
- Status: complete; end-to-end browser exercise is part of Step 6.

### Step 3 — Mockup-style test profile

- Added `Alex Example (Test Profile)` to the versioned mockup seed: CRM/Data consulting role, Prague location, availability, five searchable skills, and a clearly labeled synthetic Salesforce/Data Cloud project example.
- Bumped the seed version so an existing local database receives this profile at next app startup without deleting user data.
- The profile is test data and does not claim to represent a real colleague or client delivery.
- Status: complete; it becomes visible after restarting the local server.

### Step 4 — Create profile UI

- Added a Create profile action in Expertise and a form for role/team, location, availability, comma- or newline-separated skills, and a project example.
- Connected form submission to `POST /api/people`; successful saves persist to SQLite, reload the directory, and filter to the newly created person. Duplicate names and validation errors are shown to the user.
- Status: complete; the form is usable after the updated app is running.

### Step 5 — Profile-to-search flow

- Profile details now show the project/experience example, or an explicit empty state when none is provided.
- Existing profile skill chips are interactive and populate the directory search. Newly created profiles use the same list and search path immediately after saving.
- Team filters now include actual team names from the current directory, so a newly created profile is discoverable by its exact team as well as its skills.
- Fixed an initialization-order bug in the dynamic team filter list: the directory people list is now created before deriving filter labels. This bug caused the profile card to render while leaving the search results and filters blank, as shown in the user's screenshot.
- Status: complete; end-to-end runtime verification is part of Step 6.

### Step 6 — End-to-end review (in progress)

- `node --check` passed for `server.mjs` and `public/app.js`; the seed JSON parses; `git diff --check` reports no whitespace errors.
- First app startup exposed a helper initialization order bug in the pre-existing seed migration; moved the SQLite query helpers before migration execution. A subsequent startup initialized the database and reported 28 mockup profiles / 9 solutions.
- Queried the initialized SQLite database and confirmed the labeled test profile, skills, and synthetic experience were stored.
- A separate read-only QA agent reviewed the latest UI/API/seed wiring and found no static blockers. It confirmed the create, persistence, reload, experience display, and skill-search paths by code inspection.
- The user's screenshot exposed a runtime-only bug missed by static QA: `renderDirectory()` referenced `people` before initialization while building dynamic filters. Moved `people` initialization above filter construction.
- A second separate QA review checked the corrected directory render and its search/filter/create callers; it found no further static runtime issue. `node --check` passes for both JavaScript files.
- The sandbox denied binding to `127.0.0.1:3000` (`listen EPERM`), so I could not exercise the form submission through a browser or HTTP request here. The app must be restarted in the user's Terminal to verify the UI/API flow.
- Remaining gaps: profile edit/delete, editing Anastasia's own mockup profile, persisting suggested-skill confirmations, sending Ask messages, multi-skill filtering, and structured multiple-project/skill-evidence records.
- Status: implementation complete; browser-level end-to-end verification remains pending because this environment cannot bind localhost.

### Step 7 — Broaden seeded expertise

- Added ten synthetic consultant profiles: Noah Fischer (M365/Copilot), Camila Torres (cybersecurity/GRC), Mateusz Kowalski (SAP S/4HANA), Priyanka Desai (Marketing Cloud), Ravi Menon (AI/ML), Elise Dubois (ServiceNow), Chen Wei (data platforms), Ana Petrova (service design/accessibility), George Papadopoulos (FinOps/cloud), and Nadia Rahman (APIs/integration architecture).
- Each profile has distinct skills, team, location, and a clearly marked synthetic project example; several also have demo availability hours.
- Bumped the versioned seed to v3. On restart, existing SQLite installs receive the ten records through the normal upsert migration without resetting contributions or user-created profiles.
- Directory now contains 38 seeded profiles total, including the Anastasia mockup profile and Alex Example test profile.
- Status: complete; data will appear after restarting the local app.
