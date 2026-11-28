# Erosion Maze submission notes

Erosion Maze is a grid puzzle where the path you take changes a later board. Move from the ring to the square within a budget. A wall costs nothing, an open or worn cell costs one, and a hedge costs two. After you solve a board, the result card compares your cost to par. Advance to see which paths wore down, which walls fell, and where new hedges grew.

The practice build uses the same deterministic generator and movement rules as the daily game. A phone-width test exercised both result cards. A desktop solve used 34 moves at par and produced 35 worn cells, six removed walls and eight new hedges. The ranked draft replays moves on the server and uses verified finishes to change the next board at UTC rollover. The ranked behavior has local tests. A Reddit playtest and judge access still need verification.

## Judge access

- [58.5-second local walkthrough](https://youtu.be/PjQ8wTulXtw) shows the splash, solve at par, one-player erosion preview and restart. The video identifies the footage as local practice throughout.
- [Local erosion screenshot](docs/local-erosion.png) shows the changed board after that run.
- [Owner playtest instructions](README.md#owner-playtest) cover practice and scheduled daily checks after copy approval.
- The draft still needs a test subreddit and a working interactive post permalink verified for judge access. See the [official requirements](https://redditgameofday2026.devpost.com/rules).
