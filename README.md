# Erosion Maze

A daily grid maze for Reddit, built on Devvit Web (Interactive Posts). Every UTC day brings one maze; every finished run erodes it. Cells the crowd walks lose their walls overnight, cells nobody touches grow over, and the Move_Budget tightens from Monday to Sunday. The board remembers the crowd.

**Status: not published.** This app is uploaded privately for playtesting only and is never submitted for review (no `launch` script, no `devvit publish`).

## How to play

- Open today's post and tap Play. Move the token from the ring (Start) to the arch (Exit) with swipes, the direction pad, or arrow keys / WASD.
- Entering a Normal or Worn Cell costs 1, entering an Overgrown (hedge) Cell costs 2, a blocked Move costs 0. Finish within the Move_Budget; the lowest Route_Cost wins.
- Logged-in players get one Scored_Attempt per Puzzle_Key; everything after that is practice.
- The End_Card shows your cost against Par, the field's Distribution and your Percentile (once at least two players solved), the leaderboard, the trails count, your streak, and a spoiler-safe share comment.
- Moderators get Regenerate (3 per day), Skip and "Post today's maze now" menu actions.

## Development

Requires Node.js 24.18 or later (`export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`).

- `npm run dev`: Devvit playtest (needs `devvit login`, run by the owner).
- `npm test`: Vitest in run mode; no login, no network.
- `npm run build`: strict type check, Vite build, CommonJS server check and bundle budgets.
- `npm run deploy`: **private** upload only (`devvit upload`).

Never run `npm run launch` or `devvit publish`; the `launch` script does not exist on purpose.

## Structure

- `src/shared/`: pure TypeScript (no Devvit, DOM, clock, randomness, locale, network or storage): the seeded Maze_Generator, Solver, Erosion_Engine, Game_Engine, codecs, Streak_Calculator, Share_Formatter, Hook templates and the postData wire format.
- `src/server/`: Express server. `core/` holds the Redis model (`em:` keys), the Daily_Pipeline, the attempt write plans, and the leaderboard, streak, flair, share, subscribe and Trailblazer services. `routes/` maps `/api/*` (always HTTP 200 with a `status` field) and `/internal/*` (scheduler, menu actions, forms, triggers, settings validation).
- `src/client/`: `launch.html`/`launch.ts` (framework-free inline Launch_Screen rendering from postData alone) and `game.html`/`game.tsx` (the expanded Play_Screen and End_Card). The Distribution chart and Leaderboard_View are lazy chunks.
- `PLAN.md`: the reviewed plan; `../.kiro/specs/daily-erosion-maze/` holds requirements.md, design.md and tasks.md.

## Analytics (Journeys)

The app instruments a six-event funnel (post_view, first_interaction, attempt_start, attempt_complete, share_comment, return_next_day) through Devvit Journeys. **Journeys events are not ingested until Reddit allowlists the app during review, which this project does not request**; receipts read `JOURNEY_RECEIPT_DENIED_NOT_ALLOWLISTED` until then, and playtest versions can instead receive `JOURNEY_RECEIPT_DENIED_PLAYTEST` (a status present in the installed `@devvit/analytics` package though not on the receipts docs page). No event carries usernames, user ids, post or comment ids, or free text. The app keeps its own per-day funnel counters in Redis so the funnel is verifiable while unpublished (Req 22.9).

## Data honesty

- Daily content is deterministic: a seeded generator and a deterministic erosion rule. No runtime LLM calls, no paid APIs, no outside fetches (`permissions.http.enable` is `false`).
- Every number on screen comes from postData, a server response for this Puzzle_Key and user, or a Shared_Core computation over the current Maze and the player's own Moves. Empty states are intentional ("Be the first today"); unavailable data shows "unavailable", never a zero or a placeholder.
- Scoring is server-verified: the server replays the submitted Moves and rejects anything illegal, divergent, late or already finished.
- localStorage holds only two best-effort preferences (hint shown, sound choice) and resets on each new app version; results, streaks and attempts live in Redis.

## Bundle budgets (build-enforced)

- Launch_Screen entry: at most INLINE_BUNDLE_MAX gzipped, framework-free.
- Play_Screen entry initial load: at most GAME_BUNDLE_MAX gzipped; chart and leaderboard code load lazily.

The budgets live in `src/shared/constants.ts` and are measured by `tools/check-bundle.mjs` on every build (1 KB = 1,024 bytes, gzip level 6 per file).
