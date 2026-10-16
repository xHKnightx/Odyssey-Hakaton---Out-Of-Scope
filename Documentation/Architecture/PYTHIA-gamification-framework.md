# PYTHIA: gamification framework (draft)

Goal: people come back to PYTHIA every week. They bring problems (Seek wisdom), share what they know and what they've built (Share wisdom), and close the loop when someone helped them.

Builds on the architecture draft (Oct 14): every number is calculated from `wisdom_events` and the existing tables, nothing is drawn by hand.

## 1. Principles

1. **Reward impact, not volume.** Most points come from what happens *after* a share: someone used it, someone was helped, someone said thanks. Posting 20 shallow tips earns less than one solution that 30 people use.
2. **Reward seekers too.** Every request feeds Discoveries, which shows where the company is losing time. Asking well and closing the loop earn points.
3. **Weekly rhythm, not daily.** A daily streak in a work tool pushes people toward busywork. One meaningful action a week is the target habit.
4. **Make status visible and generous.** Titles, laurels and thank-you notes motivate more than raw points. Celebrate many people, not only the top three.
5. **Safe by default.** People can opt out of the leaderboard, scores are never used in performance reviews, and only positive signals are shown publicly.

## 2. The Greek-oracle vocabulary

| Concept | In PYTHIA | Mechanic |
| --- | --- | --- |
| Points | **Laurels** | Currency, earned from `wisdom_events` |
| Share wisdom | **Offering** | Shared skill, experience or solution |
| Seek wisdom | **Consultation** | Question to the Oracle |
| Weekly streak | **Sacred Flame** | Kept alive by ≥1 qualifying action per week |
| Rank | **Path of the Sage** | Lifetime level from laurels |
| Title | **Honorific** | E.g. "Keeper of the Data", earned per domain |
| Bounty | **Labor** | Open Discovery with no solution, bonus for closing it |
| Season | **Olympiad** | Quarterly leaderboard, reset each quarter |
| Teams | **City-states** | Team leaderboard alongside individual |
| Leaderboard | **Pantheon** | Already in the mockup |

## 3. Points (laurels)

Extends the draft formula (shared 10 / used 5 / helped 20 / thanked 3).

| Action | Laurels | Rules and caps |
| --- | --- | --- |
| **Make an offering** (Share wisdom saved) | 10 | Only after Save & share; 0 if >90% similar to an existing entry; max 3 rewarded per week |
| Offering fills an open request | +5 | Pythia matched it to someone's open request and they were notified |
| **Your solution was used** | 5 | Per unique user per month, not per run |
| First use by someone else | +10 | One-time bonus per solution, the "it works for someone" moment |
| **Helped a colleague** (ask_help → helped) | 20 | Confirmed by the seeker, not self-declared; once per seeker, solution and month; max 5 confirmations per seeker per week |
| **Received thanks** | 5 | Max 1 counted per person pair per week |
| Gave thanks | 1 | Max 5 per week, so thanking is encouraged but can't be farmed |
| **Consultation** (Seek wisdom) | 2 | Max 3 per week |
| Closed the loop (marked request resolved) | 3 | Requires picking what helped: a solution, an expert or "built new" |
| **Completed a Labor** | 50–200 | Scaled by the Discovery's `est_hours_lost`, split between builders |
| Confirmed a suggested skill on your profile | 1 | One-time per skill; keeps Expertise accurate |

**Hours saved** is shown next to laurels but kept separate from them. It is estimated conservatively: uses × minutes saved per use. Minutes per use are stated by the author at Share time, and Pythia caps them at a sensible value.

Why seeking is cheap and helping is expensive: a question costs 30 seconds, while helping someone costs real time. The gap between 2 and 20 laurels keeps the incentive pointed at sharing, while still making asking feel valued.

## 4. Progression

### Path of the Sage (lifetime rank)

| Rank | Laurels | Unlocks |
| --- | --- | --- |
| Pilgrim | 0 | Everyone starts here |
| Acolyte | 25 | Bronze laurel on avatar |
| Scholar | 100 | Can endorse others' skills |
| Sage | 300 | Silver laurel; listed as an expert in Pythia's recommendations by default |
| Elder | 750 | Can propose Labors from Discoveries |
| Oracle | 1,500 | Gold laurel; reviewer for "Build it with Pythia" drafts |

Ranks never go down. They unlock small privileges as well as cosmetics: being trusted means more than a badge.

### Honorifics (domain titles)

Earned automatically when someone becomes the top contributor in a skill category over the last 90 days, measured by laurels from used solutions and help in that category. These are the titles already in the mockup: Keeper of the Data, Guardian of the Ledger, Patron of Sales, Reader of Contracts.

- One holder per category per quarter. The previous holder keeps it as "former Keeper of the Data".
- Pythia names the honorific when it recommends that person in Seek results ("Daniel Ortiz, Keeper of the Data"). This is the strongest reward in the framework because it brings status *and* more chances to help.

### Sacred Flame (weekly streak)

- Any qualifying action keeps the flame alive for the week: an offering, helping someone, closing the loop or giving thanks.
- 4 weeks in a row: "Steady Flame", +10. 12 weeks: "Eternal Flame", +30 and an avatar ember.
- **One free skip per quarter** (vacation, crunch). Missing a week dims the flame instead of resetting it to zero. This avoids the all-or-nothing frustration that makes people quit.

## 5. Labors (bounties from Discoveries)

Discoveries already find repeated problems with `coverage = none`. Each gap becomes a **Labor**:

> **Labor: Invoice ↔ contract checks.** 38 requests · 5 teams · ~112 hours lost per month. **Reward: 150 laurels.**

- Bounty = clamp(est_hours_lost, 50, 200).
- Anyone can claim it with "Build it with Pythia" or by sharing an existing solution.
- It is complete when the solution is published **and** at least 3 of the original requesters use it or mark it helpful.
- Everyone who asked about that problem is notified automatically. The seekers of today become the first users of the solution tomorrow.

This links the two sides of PYTHIA: Seek creates demand, Discoveries make it visible, Share and Build meet it.

## 6. Social layer

- **Thank button everywhere**: on solutions, on expert replies, in the Pantheon. A short note is optional and shows in "Recent gratitude".
- **City-states**: team leaderboard by laurels *per person*, so small teams can win. Shown next to the individual Pantheon so teams cooperate as well as compete.
- **"Waiting for you" nudges**: Pythia shows matching open requests ("Mia Novak and 6 others are waiting for your Jira digest", as in the mockup). This is the best motivator for sharing: real people with a real need.
- **Gratitude, not rank, in notifications**: "Your SAP Export Cleaner saved Finance 9 hours this week" works better than "You moved up to #11".

## 7. Rituals that bring people back

| Cadence | Ritual | Channel |
| --- | --- | --- |
| Weekly (Monday) | **The Oracle's Digest**: your impact last week, 3 open requests you could answer, the state of your flame | Email or SecondStack chat via the MCP server |
| Monthly | **Monthly heroes**: top 3 and one "rising star" (biggest jump), announced in a company channel | Pantheon "This month" + post |
| Quarterly | **Olympiad**: season leaderboard resets, honorifics are re-awarded, Labors completed in the quarter are celebrated | Pantheon "This quarter" |
| Ongoing | **First offering welcome**: a newcomer's first share gets a personal thank-you from Pythia and a review from a Sage | In app |

## 8. Anti-gaming and fairness

- **Duplicate offerings** earn nothing (embedding similarity > 0.9 to an existing entry).
- **Usage** counts unique users per month, so running your own tool 100 times earns nothing. The author's own use never counts.
- **Help** must be confirmed by the person who was helped.
- **Thanks rings** (A↔B thanking each other every week) count once per pair per week and are flagged after a threshold.
- **Weekly caps** on low-effort actions (seek, give thanks, share).
- **Quarterly reset** of the season board, so newcomers have a real chance. Lifetime rank keeps long-term contributors visible.
- **Opt-out**: anyone can hide themselves from the public Pantheon and still see their own standing.
- **Never used in performance management**: say so explicitly in the app and the rollout email. It is the single biggest factor in whether people trust the system.

## 9. Mapping to the data model

Almost everything fits the existing schema.

| Need | Implementation |
| --- | --- |
| Laurels | `wisdom_events.points`; add `kind` values `sought`, `resolved`, `first_use`, `labor_completed`, `flame_bonus`, `thanks_given`, `skill_confirmed` |
| Caps and dedupe | Checked in the server action before inserting a `wisdom_event` |
| Rank | Computed: `SUM(points)` all time → threshold table in code |
| Flame | Computed: distinct ISO weeks with a qualifying event; free skip stored as `users.flame_skips_used` |
| Honorifics | Recomputed on Discoveries refresh: top laurels per `skills.category` over 90 days → `users.honorific` (field already exists) |
| Labors | Add `discoveries.bounty_points` and `discoveries.claimed_by_solution_id` |
| City-states | `GROUP BY users.team_id`, divided by active members |
| Opt-out | `users.pantheon_visible boolean default true` |

## 10. Hackathon scope (Oct 15–16)

Must-have for the demo:
1. Points from the extended table written to `wisdom_events` (Share, Used, Helped, Thanked, Seek, Resolved).
2. Pantheon on real data with rank and honorific: the mockup screen, now computed.
3. "Your standing" with progress to the next rank and the "waiting for you" nudge.
4. One Labor badge on a Discovery card, with its bounty.

Nice-to-have: Sacred Flame indicator, City-states tab, Oracle's Digest as an MCP tool ("what did I earn this week?").

**Demo storyline with gamification**: person A asks, Pythia finds nothing, so it's a Labor worth 150 laurels. A builds the skill with Pythia. B uses it from SecondStack chat (first use, +10) and thanks A (+5). After the Labor completes, A jumps from XII to V in the Pantheon and earns the title "Guardian of the Ledger". The whole cycle takes about 2 minutes and every step is real data.

## Open questions

- Should laurels be convertible into anything real (e.g. a quarterly prize, a learning budget)? Recommendation: no money. Use recognition (an all-hands shout-out, lunch with leadership) to keep motivation intrinsic.
- Who validates "hours saved" claims for large Labors? Proposed: the Discovery estimate, with a Sage or Oracle reviewer.
- Is a team leaderboard welcome in all cultures and regions of the company? Check with HR before launch.
