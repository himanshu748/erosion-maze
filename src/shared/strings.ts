// Every player-facing string lives here. PLACEHOLDER wording: the owner must write or
// approve each entry before release (Q10, Req 26.4).
import type { Outcome } from './engine';

export const STRINGS = {
  gameName: 'Erosion Maze',
  play: 'Play',
  comingSoon: 'The maze is not built yet.',
  practice: {
    title: 'Practice maze',
    note: 'This local practice run does not submit a score or change the shared maze.',
    directions: 'Use the direction buttons or arrow keys to reach the exit.',
    board: 'Maze board',
    moves: ['Up', 'Right', 'Down', 'Left'],
    cost: (cost: number, budget: number) => `Cost: ${cost} of ${budget}`,
    solved: 'You reached the exit.',
    exhausted: 'You are out of moves.',
    nextBoard: 'See how this run changes the next maze',
    erosion: (worn: number, walls: number, hedges: number) =>
      `Next maze: ${worn} worn path cells, ${walls} walls removed, ${hedges} new hedges.`,
    reset: 'Restart practice',
  },
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
