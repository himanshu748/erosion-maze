# AGENTS.md: Erosion Maze

Erosion Maze is a daily grid maze for Reddit, built on Devvit Web (Interactive Posts) for the Game of the Day Hackathon. Each UTC day's post is one maze; finished runs erode the board for the next day.

Read these before any work:

- `PLAN.md` (this folder): the plan, approved by the owner on 2026-11-19 together with its four requirement deviations.
- `../.kiro/specs/daily-erosion-maze/requirements.md`, `design.md` and `tasks.md`: the full specification. "Req N.M" means Requirement N, criterion M; "Property N" is in design.md. Where this file and requirements.md disagree, requirements.md wins.

## Where Erosion Maze lives

- The app root is `erosion-maze/` inside the workspace `/Users/himanshujha/.t3/projects/this`. The spec stays in `.kiro/specs/daily-erosion-maze/` at the workspace root.
- The workspace root is Foldline Daily (another agent's project), `app/` is a third project, and `patchwork/` plus `.kiro/specs/patchwork-daily-mosaic/` are a fourth. Never create, edit, move, format, lint, stage or delete anything outside `erosion-maze/` and `.kiro/specs/daily-erosion-maze/`.
- Copy no application source code from Foldline, `app/` or `patchwork/`.

## Commands

- Use Node 24.18 or later: `export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"`.
- Allowed: `npm run dev`, `npm test`, `npm run lint`, `npm run build`, `npm run deploy` (private upload only, `devvit upload`). Run them from `erosion-maze/`.
- `npm run build` = `tsc --build` (strict, 0 errors) + `vite build` + `tools/check-server-cjs.mjs` + `tools/check-bundle.mjs`. `devvit.json` `scripts.build` calls it, so uploads run every gate.
- Tests live in `src/test/` (Vitest run mode, Node environment).
- Forbidden: `npm run launch`, `devvit publish`, and anything that submits the app for review. The `launch` script is deleted from `package.json` on purpose. If a task needs one, stop and report instead.
- `devvit login` and any Reddit sign-in are run only by the owner, in the owner's own terminal. Stop and ask (Req 30.4).
- No load generator runs against Reddit's infrastructure without the owner's approval.

## Platform rules (from the Devvit React template)

- Open URLs with `navigateTo` from `@devvit/web/client`, never `window.location` or `window.open`.
- No `window.alert`: use `showToast` or `showForm` from `@devvit/web/client`.
- No inline `<script>` bodies in HTML; every script is a separate file.
- Every menu, form, trigger, scheduler and settings-validation endpoint must also be mapped in `devvit.json`, or the platform never calls it.
- Use Devvit Web only; ignore Blocks or `@devvit/public-api` examples.

## Hard rules

- **Verify every Devvit API before first use** against developers.reddit.com/docs (or the installed package typings, noting "package-only"). The verified ledger is design.md's "Platform API Ledger" section and `.agents/tasks/task-erosion-maze-design/api-ledger.md`.
- Daily content stays deterministic (seeded generator and erosion rule). No runtime LLM calls, no paid APIs, no outside fetches.
- **Never fabricate numbers in UI or docs.** Every number traces to a test result, recorded Redis data, code or configuration, or a cited doc page. Empty states are intentional ("Be the first today"); unavailable data shows "unavailable".
- **Strings need owner approval (Q10).** `src/shared/strings.ts`, the Hook templates, the textFallback, the Results_Thread text and the Share_Comment templates ship only after the owner writes or approves them (Req 26.4).
- Do not commit secrets or generated `dist/` output.

## Architecture invariants

- `src/shared/` is pure TypeScript: no Devvit or DOM imports, no `Date.now`/`Math.random`/`Intl`/network/storage; a scan test enforces it (Req 29.3, 29.9).
- Scoring is server-verified: the server replays the Move sequence and ignores any client-sent cost, Outcome, Cell list or timestamp (Req 10.4).
- One Scored_Attempt per user per Puzzle_Key: the attempt hash moves to finished only inside one watched transaction that also carries the counters, leaderboard, streak and Trailblazer writes (Req 5, 9.5, 11.11, 21.11).
- Every `/api/*` route answers HTTP 200 with a `status` field, including rejections (Req 26.8).
- Journeys calls live only in `src/client/track.ts` and `src/server/core/track.ts`, are never awaited, and never log at error level (Req 22.1, 22.7).

## Bundle budgets (build-enforced)

- Launch_Screen entry: at most INLINE_BUNDLE_MAX gz, no framework.
- Play_Screen initial load: at most GAME_BUNDLE_MAX gz; Distribution and Leaderboard chunks stay lazy.
- Server bundle: CommonJS at `dist/server/index.cjs` (Req 29.7).
