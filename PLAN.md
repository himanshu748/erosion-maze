# Erosion Maze: Plan

Status: **approved by the owner on 2026-11-19**, including the four requirement deviations below. The app `erosion-maze` is registered to u/jhahimanshu653 and scaffolded from the Devvit 0.15.4 React template; implementation follows tasks.md (the step list next to the spec).

Erosion Maze is a daily grid maze for Reddit's Game of the Day Hackathon, built as a Devvit Web Interactive Post. Each UTC day the scheduler posts one maze. A player moves a token from the Start_Cell to the Exit_Cell within a Move_Budget; entering a Normal or Worn Cell costs 1, an Overgrown_Cell costs 2, a blocked Move costs 0, and the lowest Route_Cost wins. Every finished run erodes the board: at rollover the cells the crowd walked lose Walls and the cells nobody touched grow over, so the board remembers the crowd. Mondays are fresh Seed_Days; Tuesday to Sunday evolve from yesterday's maze plus yesterday's counters, and the Move_Budget tightens across the week.

Content is generated procedurally and deterministically from the Puzzle_Day and Variant with a seeded integer PRNG. No AI-generated image or text ships (every shipped string is owner-written or owner-approved, Q10), and no paid or LLM API is called at build time, at runtime or in a scheduled job (Req 28.5, 30.12).

- Target prize: [OWNER INPUT NEEDED] (Q5; the Devpost page blocked automated checks, so the category list is unverified).
- Deadline: [OWNER INPUT NEEDED] (unverified; other plans in this workspace say 8 Dec 2026, 6:00 PM PT).

## How to read and approve this plan

- This file is the summary for review. The full specification is in the Kiro spec folder: [requirements.md](../.kiro/specs/daily-erosion-maze/requirements.md) (30 requirements, Q1 to Q9, D1 to D22) and [design.md](../.kiro/specs/daily-erosion-maze/design.md) (architecture, Redis schema, write plans, 39 correctness properties, error handling, test plan, risks, API ledger). Where this plan and design.md differ, design.md is the source and the difference is a mistake to fix.
- "Req N.M" means Requirement N, acceptance criterion M. "Property N" is a numbered property in design.md's Correctness Properties section.
- To approve: say "approved", or name the sections or decisions to change. The four proposed requirement deviations and the open questions Q1 to Q10 each need an answer or a default confirmation.
- Glossary terms (Puzzle_Day, Variant, Puzzle_Key, Maze, Cell, Cell_State, Wall, Move, Route, Route_Cost, Par, Move_Budget, Scored_Attempt, Practice_Run, Erosion_Counter, Counter_Snapshot, Day_Record, Seed_Day, Evolved_Day, Community_Route, Canonical_Route, Trailblazer, Heatmap, Field, Results_Thread, Share_Comment, Streak_Flair, Erosion_Cutoff, Week_Cycle, Hook) are used exactly as defined in requirements.md.

## What the Devvit docs changed

Every Devvit API in this plan was verified against developers.reddit.com/docs and the installed 0.15.3 packages on 2026-11-15 and 2026-11-16; the per-item ledger is design.md's "Platform API Ledger" section (sources in `.agents/tasks/task-erosion-maze-design/api-ledger.md`). These facts changed what the request asked for:

| Fact | Effect on the plan |
|---|---|
| `createTelemetryRouter()` is an `express.Router` (package typings; express is a peer dependency). | The Game_Server is Express, not Hono. If the scaffold-day template ships Hono (two 0.15.3 projects in this workspace do), the server entry is rewritten (Req 22.8). |
| The telemetry router answers errors with HTTP 500/400, and browsers log failed requests at error level. | A status shim rewrites `/api/telemetry` codes of 400 and above to 200; every `/api/*` route also answers HTTP 200 with a `status` field (Req 26.8). |
| The docs say `interaction()` auto-starts a journey; the 0.15.3 client does not. | Journeys start only on a new attempt claim; interaction events with no active journey are dropped (deviation 4, Req 22.3). |
| `localStorage` resets on each new app version and is not shared across browsers. | The hint flag and sound choice are best-effort cache only; persistence is promised within one app version (deviation 3, Req 26.6, 18.5). |
| `TxClient` has no `bitfield`; plain sets, lists, pipelining and `hMGet` are unavailable. | Erosion_Counters are a hash updated with `hIncrBy` inside the finish transaction. |
| Redis transactions: 20 concurrent blocks and a 5 s timeout (the docs also say 30 elsewhere; D11 picked 20). | The finish write plan holds one slot per finish, retries aborts up to 3 times, and the client retry resends the same Moves (Req 11.12). |
| The cron time zone is not documented. | Cron at 00:01 plus an hourly catch-up at minute 17; the UTC date is always computed in code (Req 8.1, 8.2, D10). |
| Journeys records nothing until Reddit allowlists the app in review, which this project does not request. | The code ships fully instrumented and keeps its own funnel counters in Redis (`em:funnel:<day>`); the README says so (Req 22.9). |
| `runAs: 'USER'` may post as the app account for an unpublished app (the schema calls `asUser` "not currently in use"). | Both `scope: "user"` and the `asUser` list are declared; the playtest checklist verifies the comment author (Req 15.12). |
| `post.setPostData()` replaces the whole object; postData targets at most 2,048 bytes. | `buildPostData` always writes the full object from the Day_Record; the worst case is 608 bytes, guarded by Property 22 (Req 7.6, 20.8). |
| `@devvit/test` does not implement `submitComment`, `distinguish`, `subscribeToCurrentSubreddit` or Flair calls. | Vitest spies with argument assertions cover those paths (Req 29.11). |
| The login wizard needs a browser. | Project creation and playtest login are owner steps; the agent stops for them (Req 30.4). |

## Architecture

Two client entries and one Express server, per the planned file layout and devvit.json in design.md's Architecture section:

- `default` entry (`launch.html`, framework-free): the inline Launch_Screen. It renders today's Maze, yesterday's Heatmap and the Community_Route from `context.postData` alone, with zero required requests, inside the INLINE_BUNDLE_MAX budget.
- `game` entry (`game.html`, React): the expanded Play_Screen and End_Card, opened by `requestExpandedMode` on the Play target. Distribution and Leaderboard code are lazy chunks (Req 27.4).
- `src/shared/` (Shared_Core): pure TypeScript. No Devvit, clock, randomness, locale, network or storage; a test scans for all of these (Req 29.3, 29.9). Generator, Solver, Erosion_Engine, Game_Engine, codecs, streak, share, hooks, postData.
- `src/server/`: Express. `/api/*` answers HTTP 200 with `{ status, ... }` for every outcome including rejections; `/internal/*` serves the two scheduler tasks, three menu actions, two forms, three triggers and two settings validators.
- Redis: hashes, sorted sets and strings only, every key prefixed `em:`; per-day keys expire DAY_RETENTION days after their Erosion_Cutoff (rule R of the key schema); streak, join and flair records never expire (Req 11.10).
- Journeys telemetry lives in exactly two files (`src/client/track.ts`, `src/server/core/track.ts`), never awaited, silent on any non-VALID receipt (Req 22.1, 22.7).

Key decisions (design.md "Key design decisions", full list of 13): Express for the telemetry router; Difficulty_Rating = Par / Move_Budget compared by exact cross-multiplication; Start_Cell and Exit_Cell in opposite corners so Par >= 2(n - 1) proves the weekly curve; one watched transaction per finish carrying every counter, leaderboard, streak and Trailblazer write; the day-close write aborts in-flight finishes so the Counter_Snapshot is exact (Req 5.10); fingerprint = Move_Codec of the Canonical_Route; leaderboard ties on Route_Cost then completion time then user id byte order; Share_Grid bands `B = min(6, floor(n/2))`.

## Daily content pipeline

- Generator: seeded opposite-corner Start/Exit, recursive backtracker spanning tree, braid of `floor(n*n/10)` extra openings, up to 32 attempts to reach Par >= 2n, then a deterministic serpentine fallback (Req 1.3 to 1.6, 1.10).
- Solver: reverse Dijkstra with the lexicographically smallest optimal path; Maze_Validator rules in a fixed order (Req 2.1, 2.4).
- Move_Budget = Par + ceil(Par x SLACK) in integer hundredths; SLACK falls 0.60 (Monday) to 0.12 (Sunday); the curve proof shows day k+1 never rates below day k when `2(n - 1) * minGap >= 100`, which the default constants satisfy at 11 x 11 (Req 4.1 to 4.4, 4.7; deviation 1 covers other sizes).
- Erosion: Worn = at least half the day's maximum counter (BigInt); up to WALL_CAP Walls between Worn Cells fall, ordered by traffic then Route_Cost saved; up to OVERGROWTH_CAP untouched Cells grow over in a seeded shuffle order that depends on the Variant (Req 6.3 to 6.6, Q9).
- Every evolved Maze passes the Maze_Validator for every snapshot, proven and property-tested (Req 6.9, 6.11, Property 15).
- The Daily_Pipeline runs at 00:01 UTC and hourly at minute 17: close yesterday and freeze counters, backfill missed days, classify Seed/Evolved, build through the Variant loop, store the Day_Record, create the Daily_Post once (lock plus idempotent record), post and sticky the Results_Thread (Req 8, 19.3).
- Titles are `Day N · Hook`, the Hook chosen from condition-matching templates by a seeded pick (Req 8.5 to 8.7). Wording is owner-approved placeholder text (Q10).

## Screens (summary)

Launch_Screen states per the postData condition table (live, Seed_Day "Last week's trails", closed with final Heatmap, skipped with countdown, decode failure); Play_Screen with swipe, direction pad and keyboard, a 44 x 44 minimum target everywhere, the wordless ghost-hand hint, progress saves on the first Move, every 5 Moves and on hide; End_Card with result summary, board with both route lines, crowd stats ("N trails found today", Community_Route percentage), Percentile and Distribution when the Field has 2+ Solved, the Leaderboard_View with snoovatars, streak block with opt-in Streak_Flair, share preview above "Comment my result", join button, Practice, and the UTC countdown (Req 14 to 21). One SVG board renderer serves both entries; the stone/hedge/worn-path palette passes CVD simulation (Machado 2009, CIEDE2000) and WCAG contrast in both themes (Req 25.1, 25.3, 26.3).

## Journeys events (summary)

Six events: post_view (client App.Ready), first_interaction (client), attempt_start (client Journey.Start on `newClaim: true` only), attempt_complete (server Journey.End), share_comment (server), return_next_day (server, once per user and day via `hSetNX`). The journey id rides the `x-devvit-journey-id` header with a `''` fallback; Redis `em:funnel` counters are the reliable record until allowlisting (Req 22).

## Test plan (summary)

Vitest run mode, no login, no network (Req 29.4). 39 property tests with fast-check (numRuns >= 100, seed and shrink reporting, titles like "6.9 solvability property") cover all 43 FOR ALL criteria, including the finite enumerations (120 Puzzle_Days 2027-11-04 to 2028-03-02; Par 1 to 448 x 7 weekdays) and three reference models (exhaustive Solver search, an independent Move simulator, a naive streak reference). `createDevvitTest()` covers every route, the pipeline at both midnight edges, menu actions, forms, triggers and settings validators (Req 29.6); the concurrency properties run 2 to 20 unawaited submissions per case against the Redis mock (Req 29.10); unimplemented Reddit methods are spied with argument assertions (Req 29.11). Build gates: strict type check with 0 errors, CommonJS server bundle check, per-entry gzip budgets (Req 27, 29.1, 29.7). A manual playtest and Lighthouse checklist covers what automation cannot (Req 17.3, 18.4, 26.8, 27.1).

## Risks

All 24 risks with likelihood, impact and mitigation are in design.md's "Risks" section. The five that most affect this plan: Journeys events dropped until allowlisting (Req 22.9); the telemetry status shim depending on 0.15.3 router internals; unmeasured finish throughput under the 20-transaction-slot limit; the scaffold-day template possibly shipping Hono; and the localStorage reset limiting the hint and sound persistence (deviation 3).

## Requirement deviations awaiting owner approval

1. GRID_SIZE and the weekly curve: with the default SLACK values the curve is proven at 10 x 10 and above; a 9 x 9 grid needs every adjacent SLACK gap >= 0.07 (Req 4.3, 4.4; proposed wording in design.md).
2. Closed day with an all-zero final Heatmap: the Launch_Screen still draws the Community_Route when one exists, beside "No trails this day" (Req 20.6 versus 28.7).
3. localStorage persistence is promised only within one installed app version (Req 26.6, 18.5).
4. A Journeys interaction event with no active journey is dropped, never auto-started (Req 22.3).

## Open questions

Q1 to Q9 from requirements.md stand at their defaults because they were never answered; Q10 (owner writes or approves every shipped string) was raised during design. The full text of each is in design.md's "Open Questions" section. The ones that most affect next steps: Q5 (category, needed for SUBMISSION_CHECKLIST.md), Q6 (app root `erosion-maze/`, applied here), Q10 (strings approval gates release).

## Work order

1. This plan and the four deviations: owner approval. **Stop here.**
2. Owner runs `devvit login` and creates the React template outside the workspace; the agent moves it into `erosion-maze/` (tasks 1.1 to 1.4).
3. tasks.md steps 2 to 18: tooling, Shared_Core with property tests, server core and services, routes, client entries, integration and concurrency tests, palette tests. Each step ends with `npm test` and `npm run build` green.
4. tasks.md step 19: private upload and playtest measurements.
5. tasks.md step 20: owner string approval (Q10).
6. tasks.md step 21: documentation, video, submission checklist. The agent never runs `launch` or `publish` (Req 30.3).
