// Hook templates, seeded selection and the Daily_Post title (Req 8.5 to 8.7).
// PLACEHOLDER wording: the owner must write or approve every template before release
// (Q10, Req 26.4, 28.5).
import type { PuzzleDay } from './date';
import { rngFor } from './prng';

export interface HookFacts {
  readonly seed: boolean;
  /** 0..WALL_CAP. */
  readonly wallsRemoved: number;
  /** 0..OVERGROWTH_CAP. */
  readonly newlyOvergrown: number;
}

interface HookTemplate {
  readonly id: string;
  /** A template is eligible only when every fact it states holds (Req 8.6). */
  readonly when: (f: HookFacts) => boolean;
  readonly fill: (f: HookFacts) => string;
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

const TEMPLATES: readonly HookTemplate[] = [
  {
    id: 'seed-a',
    when: (f) => f.seed,
    fill: () => 'A fresh maze for a new week',
  },
  { id: 'seed-b', when: (f) => f.seed, fill: () => 'New stone, no trails yet' },
  {
    id: 'walls',
    when: (f) => !f.seed && f.wallsRemoved > 0,
    fill: (f) => `${plural(f.wallsRemoved, 'wall', 'walls')} fell overnight`,
  },
  {
    id: 'walls-and-hedges',
    when: (f) => !f.seed && f.wallsRemoved > 0 && f.newlyOvergrown > 0,
    fill: (f) =>
      `${plural(f.wallsRemoved, 'wall', 'walls')} fell, ${plural(f.newlyOvergrown, 'path', 'paths')} grew over`,
  },
  {
    id: 'hedges',
    when: (f) => !f.seed && f.wallsRemoved === 0 && f.newlyOvergrown > 0,
    fill: (f) =>
      `No walls fell; ${plural(f.newlyOvergrown, 'path', 'paths')} grew over`,
  },
  {
    id: 'still',
    when: (f) => !f.seed && f.wallsRemoved === 0 && f.newlyOvergrown === 0,
    fill: () => 'The maze held still overnight',
  },
  {
    id: 'generic',
    when: () => true,
    fill: () => 'Find the shortest way through',
  },
];

/**
 * `generic` applies to every input, so the eligible list is never empty (Req 8.7). The pick
 * comes from the `hook` seed stream of the Puzzle_Day and Variant 0, so a Regenerate keeps the
 * Hook (Req 23.4).
 */
export function selectHook(
  day: PuzzleDay,
  facts: HookFacts
): { readonly id: string; readonly text: string } {
  const eligible = TEMPLATES.filter((t) => t.when(facts));
  const t = eligible[rngFor(day, 0, 'hook').nextInt(eligible.length)]!;
  return { id: t.id, text: t.fill(facts) };
}

/** "Day " + decimal Day_Number + " \u00B7 " + Hook (Req 8.5). */
export const postTitle = (dayNumber: number, hook: string): string =>
  `Day ${String(dayNumber)} \u00B7 ${hook}`;
