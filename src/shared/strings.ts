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
    result: (cost: number, par: number) => `Your cost: ${cost}. Par: ${par}.`,
    nextBoard: 'See how this run changes the next maze',
    erosion: (worn: number, walls: number, hedges: number) =>
      `Next maze: ${worn} worn path cells, ${walls} walls removed, ${hedges} new hedges.`,
    reset: 'Restart practice',
    postError: 'Could not open the practice post. Check the playtest logs.',
  },
  daily: {
    number: (day: number) => `Day ${String(day)}`,
    loading: 'Loading today’s maze…',
    unavailable: 'This daily maze could not be loaded.',
    priorTrails: 'Maze board with yesterday’s paths',
    finalTrails: 'Maze board with this day’s paths',
    closed: 'This day is closed for scoring.',
    skipped: 'This day was skipped.',
    signedOut: 'You can play locally. Sign in to save a score.',
    saving: 'Saving your run…',
    saved: 'Score saved.',
    retry: 'Retry',
    saveError: 'The run could not be saved. Your moves are still here.',
    refresh: 'Reload saved run',
    stale: 'The saved run changed. Reload it before continuing.',
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
