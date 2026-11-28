# Submission checklist: Erosion Maze, Game of the Day Hackathon

Deadline: **8 Dec 2026, 6:00 PM PST / 9 Dec 2026, 7:30 AM IST** per the [official rules](https://redditgameofday2026.devpost.com/rules). Category: **[OWNER INPUT NEEDED]** (Q5).
Use a private Devvit upload. The submission requires the app listing, the test subreddit and a working demo post, plus a root README. The agent never runs `npm run launch` or `devvit publish` (Req 30.3).

## Before submitting

- [x] Owner approved `PLAN.md` and the four requirement deviations (2026-11-19)
- [x] CLI logged in as u/jhahimanshu653; template project created (tasks 1.1, 1.2)
- [x] App name chosen and set in `devvit.json` and `package.json`: `erosion-maze`
- [x] Local verification on 26 Nov 2026: `npm test` (171 passed), `npm run lint` and `npm run build` passed. The build checked types, CommonJS output and bundle budgets.
- [ ] Owner approved every shipped string: `src/shared/strings.ts`, Hook templates, textFallback, Results_Thread text, Share_Comment templates (Q10, Req 26.4, task 20)
- [ ] Private upload with `npm run deploy` and a full playtest on the private playtest subreddit (task 19):
  - [ ] Daily_Post created by the scheduler (or "Post today's maze now"), correct "Day N · Hook" title and Launch_Screen
  - [ ] Results_Thread posted once and stickied
  - [ ] First finish is the Scored_Attempt; a second run is practice
  - [ ] After rollover the next Evolved_Day shows the frozen Heatmap, worn cells, fallen walls and hedges consistent with the previous day's play
  - [ ] Monday is a fresh Seed_Day ("Last week's trails")
  - [ ] Community_Route drawn on the Launch_Screen when one exists
  - [ ] Leaderboard rows with snoovatars and own row; Distribution and Percentile appear only with 2 or more Solved
  - [ ] Streak increments; Streak_Flair toggle sets flair or fails gracefully
  - [ ] Share_Comment posts under the Results_Thread; record which account authored it (Req 15.12)
  - [ ] Trailblazer credit awarded to the first finisher of a Canonical_Route
  - [ ] Join button subscribes; logged-out play works end to end
  - [ ] Regenerate (3 per day), Skip and "Post today's maze now" moderator actions work
  - [ ] First Move accepted within 3 seconds of tapping Play (Req 18.4); record the measured time
  - [ ] Journeys receipts recorded as observed (expect `JOURNEY_RECEIPT_DENIED_PLAYTEST` or `JOURNEY_RECEIPT_DENIED_NOT_ALLOWLISTED`); `em:funnel:<day>` counters increase
  - [ ] No error-level console output during a normal session (Req 26.8)
- [ ] Provide the test subreddit and a working post permalink. Use a public subreddit (fewer than 200 members) or verify judge access via Reddit's developer bot as described in the official rules.
- [ ] Capture two consecutive days of play to demonstrate that day one's routes change day two's maze.
- [ ] Optional demo video: record under 60 s per `VIDEO_SHOTLIST.md` and verify the public video link.
- [ ] `README.md` in this folder present and accurate
- [ ] `DEVPOST_STORY.md` copied into the Devpost write-up, brackets filled honestly, unshipped claims removed

## Submission fields

- **App listing URL:** `https://developers.reddit.com/apps/erosion-maze` (resolves only after the first upload)
- **Demo post:** permalink of a maze post in the public test subreddit
- **Category:** [OWNER INPUT NEEDED]
- **Video:** upload per shotlist
- **App status:** private (uploaded, never published)
