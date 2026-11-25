import { SLACK_H } from './constants';
import type { Weekday } from './date';

/** Par plus the exact ceiling of Par x SLACK, in integer hundredths (Req 4.1, 4.7). */
export function moveBudget(par: number, w: Weekday): number {
  return par + Math.floor((par * SLACK_H[w] + 99) / 100);
}

/** Difficulty_Rating = Par / Move_Budget, in (0, 1]; rises as the margin shrinks. */
export const difficultyRating = (par: number, budget: number): number =>
  par / budget;

/** Exact rating order by cross-multiplication (all operands are small integers). */
export function compareRating(
  a: { readonly par: number; readonly budget: number },
  b: { readonly par: number; readonly budget: number }
): -1 | 0 | 1 {
  const d = a.par * b.budget - b.par * a.budget;
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** Smallest drop between adjacent SLACK values, Monday to Sunday. */
export function minGap(slack: readonly number[]): number {
  let g = Infinity;
  for (let i = 1; i < slack.length; i++)
    g = Math.min(g, (slack[i - 1] ?? 0) - (slack[i] ?? 0));
  return g;
}
