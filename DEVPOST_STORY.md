# Erosion Maze: Devpost story

> Draft for the Devpost write-up. It describes the approved design in `../.kiro/specs/daily-erosion-maze/design.md`; before pasting, check every sentence against the shipped code and delete anything that did not ship. Fill the bracketed bits after playtesting, with real observations only. Category: **[OWNER INPUT NEEDED]** (Q5).

## Inspiration

Most daily puzzles reset to a blank slate at midnight, and the community only meets in the comments. I wanted a daily game where the crowd leaves marks on the puzzle itself: today's board should carry yesterday's footsteps. A maze is the simplest board where that reads at a glance. Paths people walk wear open; corners nobody visits grow over.

## What it does

One maze post per UTC day in the subreddit. The feed preview already shows today's maze, yesterday's traffic as a heatmap, and the Community_Route, the path the crowd walked most. Tap Play and move a token from the ring to the arch with swipes, a direction pad, or the keyboard. Normal and worn cells cost 1 to enter, hedges cost 2, and you must finish within the day's Move_Budget. Lowest cost wins. Logged-in players get one scored attempt per day; everything after that is practice.

At rollover the board erodes. Cells that enough players walked through become worn, and a capped number of walls between worn cells fall, busiest first. A capped number of cells nobody touched grow into hedges. Monday is a fresh maze; Tuesday to Sunday each evolve from the day before, while the Move_Budget tightens across the week. The crowd decides which shortcuts exist tomorrow.

The end card shows your cost against par, how many trails the crowd found, where you placed in the field once at least two players have solved, the leaderboard with snoovatars, your streak with opt-in streak flair, and a spoiler-safe result grid you can post as a comment under the day's stickied results thread. The first player to find a given route gets Trailblazer credit.

## How I built it

- **Deterministic daily content.** A seeded integer PRNG builds Monday's maze from the date (spanning tree plus braided extra openings, start and exit in opposite corners), and every later day is a pure function of yesterday's maze and yesterday's frozen counters. Every maze, fresh or evolved, passes the same validator: solvable, par proven by the solver, budget above par. No runtime LLM, no paid API, no outside fetches.
- **Server-verified scoring.** The client sends only its moves. The server replays them with the same shared engine and ignores any client-sent cost, outcome or timestamp. One watched Redis transaction per finish records the result together with the erosion counters, leaderboard, streak and Trailblazer writes, so a run either counts everywhere or nowhere. Closing the day aborts any finish still in flight, so the counter snapshot that drives erosion is exact.
- **Property tests over the whole rule set.** The design lists 39 correctness properties (fast-check, at least 100 runs each) covering generation, erosion, scoring, streaks and share grids, plus Devvit test-harness tests for every route and the daily pipeline at both midnight edges. [Replace with the real test count and run time from the final `npm test`.]
- **A real Reddit game.** Scheduled daily posts with a stickied results thread, share comments posted as the player only on an explicit tap, opt-in streak flair, a join button, moderator Regenerate, Skip and "Post today's maze now" actions, and a Journeys funnel behind two small tracking files.
- **Restraint.** The launch screen is framework-free and renders from postData alone with no network request. [Insert measured gzipped size from `npm run build`.] The stone, hedge and worn-path palette is checked for colour-vision deficiency and contrast in light and dark themes. Every touch target is at least 44 by 44 pixels. A wordless ghost-hand hint is the only tutorial.

## Challenges

- Making erosion fair and testable: the rule had to be deterministic, capped, and guaranteed never to make a maze unsolvable or trivially cheap, for every possible snapshot of crowd traffic.
- Proving the weekly difficulty curve: with start and exit in opposite corners, par has a floor, which is what lets the design prove that each day of the week rates at least as hard as the one before at the default grid size.
- Concurrency under Redis transaction limits: every finish runs in one transaction slot, retries aborts, and resends the same moves, so a retry can never double-count.
- Journeys analytics only record events for apps Reddit allowlists during review, which this unpublished app never requests, so the app also keeps its own per-day funnel counters.
- [Add after playtest: what the first real session surfaced.]

## What I learned

[Fill after playtest. Keep it honest and specific.]

## What's next

[Fill before submission, for example: weekly recap comment, more erosion rules for special days, larger grids once the curve condition is retuned.]
