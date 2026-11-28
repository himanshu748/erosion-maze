# Erosion Maze

A daily grid maze for Reddit, built on Devvit Web (Interactive Posts). Every UTC day brings one maze; every finished run erodes it. Cells the crowd walks lose their walls overnight, cells nobody touches grow over, and the Move_Budget tightens from Monday to Sunday. The board remembers the crowd.

**Status:** This build has a local practice maze. The Reddit daily scoring, shared rollover, leaderboard, and result comments are still in development.

## How to play

Move the token from the ring to the square with the direction buttons or arrow keys. Normal and worn cells cost one move, hedges cost two, and a wall costs nothing. After you reach the exit, choose **See how this run changes the next maze**. The same erosion engine planned for the daily game turns your route into a one-player snapshot. You can play the next maze or restart.

To try the practice build without signing in, run `npm ci`, `npm run build`, and `python3 -m http.server 4173 --directory dist/client`. Open [the practice screen](http://localhost:4173/game.html). The preview stores no scores and makes no requests to Reddit.

## Development

Requires Node.js 24.18 or later (`export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`).

- `npm run dev`: Devvit playtest (needs `devvit login`, run by the owner).
- `npm test`: Vitest in run mode; no login, no network.
- `npm run build`: strict type check, Vite build, CommonJS server check and bundle budgets.
- `npm run deploy`: **private** upload only (`devvit upload`).

Never run `npm run launch` or `devvit publish`; the `launch` script does not exist on purpose.

## Structure

- `src/shared/`: pure TypeScript (no Devvit, DOM, clock, randomness, locale, network or storage): the seeded Maze_Generator, Solver, Erosion_Engine, Game_Engine, codecs, Streak_Calculator, Share_Formatter, Hook templates and the postData wire format.
- `src/server/`: Express server, Redis data model, and daily pipeline and scoring modules. The app routes are still scaffolds.
- `src/client/`: the inline launcher and expanded practice screen.
- `PLAN.md`: the reviewed plan; `../.kiro/specs/daily-erosion-maze/` holds requirements.md, design.md and tasks.md.

## Bundle budgets (build-enforced)

- Launch_Screen entry: at most INLINE_BUNDLE_MAX gzipped, framework-free.
- Play_Screen entry initial load: at most GAME_BUNDLE_MAX gzipped.

The budgets live in `src/shared/constants.ts` and are measured by `tools/check-bundle.mjs` on every build (1 KB = 1,024 bytes, gzip level 6 per file).
