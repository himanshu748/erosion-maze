# Erosion Maze submission notes

Erosion Maze is a grid puzzle where the path you take changes a later board. Move from the ring to the square within a budget. A wall costs nothing, an open or worn cell costs one, and a hedge costs two. After you solve a board, the result card compares your cost to par. Advance to see which paths wore down, which walls fell, and where new hedges grew.

The practice build runs in the Devvit Web client and uses the same deterministic generator, solver, movement rules and erosion engine planned for the daily game. A phone-width test exercised both the win and loss cards. A desktop solve used 34 moves at par and produced 35 worn cells, six removed walls and eight new hedges. The preview uses one local route. Ranked daily posting, shared player counters and judge access on Reddit are still pending.

## Judge access

- [Local erosion screenshot](docs/local-erosion.png) shows the changed board after that run.
- [Owner playtest instructions](README.md#owner-playtest) cover creating the practice post from the moderator menu after copy approval.
- The draft still needs a test subreddit and a working interactive post permalink verified for judge access. See the [official requirements](https://redditgameofday2026.devpost.com/rules).
