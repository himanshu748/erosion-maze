import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  compareRating,
  difficultyRating,
  minGap,
  moveBudget,
} from '../shared/budget';
import { GRID_SIDE, SLACK_H } from '../shared/constants';
import type { Weekday } from '../shared/date';
import { SLACK_TEXT, budgetFor } from './budget-ref';
import { runs } from './maze-fixtures';

const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

describe('budget', () => {
  test('4.2 seven SLACK values in (0, 1], two decimals, strictly decreasing, Mon >= 0.50, Sun <= 0.15', () => {
    expect(SLACK_H).toHaveLength(7);
    expect(SLACK_H.map((h) => (h / 100).toFixed(2))).toEqual([...SLACK_TEXT]);
    for (const h of SLACK_H)
      expect(Number.isInteger(h) && h > 0 && h <= 100).toBe(true);
    for (let i = 1; i < 7; i++)
      expect(SLACK_H[i]!).toBeLessThan(SLACK_H[i - 1]!);
    expect(SLACK_H[0]).toBeGreaterThanOrEqual(50);
    expect(SLACK_H[6]).toBeLessThanOrEqual(15);
  });

  // Property 11: Move_Budget exactness, enumerated in full (Par 1 to 448 x 7 weekdays).
  test('4.7 budget property over Par 1 to 448 and all 7 weekdays', () => {
    for (let par = 1; par <= 448; par++) {
      for (const w of WEEKDAYS) {
        const b = moveBudget(par, w);
        expect(Number.isInteger(b)).toBe(true);
        expect(b).toBe(budgetFor(par, w));
        expect(b).toBeGreaterThanOrEqual(par + 1);
      }
    }
    expect(moveBudget(22, 0)).toBe(36);
    expect(moveBudget(25, 6)).toBe(28);
    expect(moveBudget(1, 6)).toBe(2);
  });

  test('4.3 configuration: 2 * (GRID_SIDE - 1) * minGap(SLACK_H) >= 100', () => {
    expect(minGap(SLACK_H)).toBe(6);
    expect(2 * (GRID_SIDE - 1) * minGap(SLACK_H)).toBeGreaterThanOrEqual(100);
  });

  test('2.9 compareRating matches exact BigInt cross-multiplication', () => {
    const side = fc.record({
      par: fc.integer({ min: 1, max: 9999 }),
      budget: fc.integer({ min: 1, max: 9999 }),
    });
    fc.assert(
      fc.property(side, side, (a, b) => {
        const d =
          BigInt(a.par) * BigInt(b.budget) - BigInt(b.par) * BigInt(a.budget);
        expect(compareRating(a, b)).toBe(d < 0n ? -1 : d > 0n ? 1 : 0);
        expect(compareRating(b, a)).toBe(d < 0n ? 1 : d > 0n ? -1 : 0);
      }),
      runs(500)
    );
  });

  test('2.6 Difficulty_Rating is finite, in (0, 1], and 1 exactly when the budget equals Par', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 448 }),
        fc.nat(2000),
        (par, extra) => {
          const r = difficultyRating(par, par + extra);
          expect(Number.isFinite(r) && r > 0 && r <= 1).toBe(true);
          expect(r === 1).toBe(extra === 0);
        }
      ),
      runs(200)
    );
  });
});
