// Every player-facing string lives here. PLACEHOLDER wording: the owner must write or
// approve each entry before release (Q10, Req 26.4).
import type { Outcome } from './engine';

export const STRINGS = {
  gameName: 'Erosion Maze',
  play: 'Play',
  comingSoon: 'The maze is not built yet.',
  shareHeader: (
    dayNumber: number,
    outcome: Outcome,
    cost: number,
    par: number
  ): string =>
    `Erosion Maze Day ${String(dayNumber)} \u00B7 ${
      outcome === 'solved' ? 'solved' : 'out of moves'
    } \u00B7 cost ${String(cost)} (par ${String(par)})`,
  shareStreak: (streak: number): string => `Streak: ${String(streak)}`,
} as const;
