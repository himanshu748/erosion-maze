# Erosion Maze

A grid maze for Reddit Interactive Posts. Today's finished solves change tomorrow's maze. In the standalone practice build, one route generates a preview of those changes.

## Status

The playable build includes the daily scheduler, ranked play and shared rollover. These have passed local tests. The owner approved the player-facing copy in the reviewed build on November 28, 2026. A native Reddit playtest remains pending. The player-facing leaderboard and result comments are still in development.

[58.5-second local walkthrough](https://youtu.be/PjQ8wTulXtw) · [Screenshot of the local erosion preview](docs/local-erosion.png) · [Devpost project awaiting submission](https://devpost.com/software/erosion-maze)

## How to play

Move the token from the ring to the square with the direction buttons or arrow keys. Normal and worn cells cost one move, hedges cost two, and a wall costs nothing. After you reach the exit, choose **See how this run changes the next maze**. The same erosion engine planned for the daily game turns your route into a one-player snapshot. You can play the next maze or restart.

To try the practice build without signing in, run `npm ci`, `npm run build`, and `python3 -m http.server 4173 --directory dist/client`. Open [the practice screen](http://localhost:4173/game.html). The preview stores no scores and makes no requests to Reddit.

## What we verified

In a phone-width browser, the splash opened an 11×11 board. A wall cost nothing, spending all 55 moves away from the exit produced the loss card, and restarting restored the initial board. A 34-move route reached the exit at par. The practice rollover preview showed 35 worn cells, six removed walls and eight new hedges from that route. Desktop keyboard play produced the same result. The local seed changed on reopening in a new UTC week. The in-week preview is triggered by the player after solving.

With local test data, the daily splash rendered earlier trails without a request. A signed-out phone browser solved from the post data. A desktop browser retried a failed score save, restored the confirmed result after reload and accepted keyboard input during a delayed progress save.

## Owner playtest

Use Node 24.18 or newer. From the app root, run these commands in your own terminal. Replace `your-test-subreddit` with the name of a private test subreddit you moderate, without `r/`.

```sh
npm ci
npx devvit login
npx devvit whoami
npm run dev -- your-test-subreddit
```

Open the playtest subreddit from the CLI, use its moderator menu to choose **Open practice maze**, and tap **Play** on the new post. The menu creates a practice post when a moderator explicitly asks for one. The UI runs locally in that post. The menu handler has passed local Devvit mock tests; a signed-in Reddit session still needs to verify it. See [Devvit’s playtest guide](https://developers.reddit.com/docs/guides/tools/playtest) and the [hackathon judge-access rules](https://redditgameofday2026.devpost.com/rules).

For the ranked check, look for the scheduled daily post after 00:01 UTC or the hourly catch-up at minute 17. Tap **Play**, make a move, reopen the post to check that progress resumes, and finish the maze. After the next UTC rollover, check that yesterday’s post is closed for scoring and today’s puzzle loads. Local tests use mock Reddit calls with the Devvit Redis test client. An ambiguous Reddit post response pauses further attempts for that day to avoid posting twice.

## Development

Requires Node.js 24.18 or later (`export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`).

- `npm run dev`: Devvit playtest (needs `devvit login`, run by the owner).
- `npm test`: Vitest in run mode; no login, no network.
- `npm run build`: strict type check, Vite build, CommonJS server check and bundle budgets.
- `npm run deploy`: **private** upload only (`devvit upload`).

Never run `npm run launch` or `devvit publish`; the `launch` script does not exist on purpose.

## Structure

- `src/shared/`: pure TypeScript (no Devvit, DOM, clock, randomness, locale, network or storage): the seeded Maze_Generator, Solver, Erosion_Engine, Game_Engine, codecs, Streak_Calculator, Share_Formatter, Hook templates and the postData wire format.
- `src/server/`: Express server, Redis data model, ranked attempt and streak modules, UTC scheduler and moderator practice-post action.
- `src/client/`: the inline launcher and expanded practice and daily screens.
- `PLAN.md`: the reviewed plan; `../.kiro/specs/daily-erosion-maze/` holds requirements.md, design.md and tasks.md.

## Bundle budgets (build-enforced)

- Launch_Screen entry: at most INLINE_BUNDLE_MAX gzipped, framework-free.
- Play_Screen entry initial load: at most GAME_BUNDLE_MAX gzipped.

The budgets live in `src/shared/constants.ts` and are measured by `tools/check-bundle.mjs` on every build (1 KB = 1,024 bytes, gzip level 6 per file).
