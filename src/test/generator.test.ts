import fc from 'fast-check';
import { afterEach, describe, expect, test } from 'vitest';
import { ENVS, enterHost, restoreHost } from './host-env';
import { budgetFor } from './budget-ref';
import { GRID_SIDE, MAX_REGENERATIONS, MIN_PAR } from '../shared/constants';
import { weekday } from '../shared/date';
import {
  GENERATOR_ATTEMPTS,
  generate,
  generateDetailed,
  serpentine,
} from '../shared/generator';
import { encodeMaze } from '../shared/codec/maze';
import { mazeEquals, type Maze } from '../shared/maze';
import { solve } from '../shared/solver';
import { validateMaze } from '../shared/validator';
import {
  WINDOW,
  dayArb,
  gen,
  outerClosed,
  reachable,
  runs,
} from './maze-fixtures';

afterEach(restoreHost);

function mustGenerate(d: string, v: number): Maze {
  const r = generate(d, v);
  if (!r.ok) throw new Error(`generate(${d}, ${v}) failed`);
  return r.value;
}

const corners = (n: number): readonly number[] => [
  0,
  n - 1,
  n * (n - 1),
  n * n - 1,
];
const opposite = (n: number, a: number): number => n * n - 1 - a;

describe('generator', () => {
  // Property 1: Generator determinism and environment independence.
  test('1.2 and 1.7 determinism and environment-independence property', () => {
    fc.assert(
      fc.property(dayArb(), fc.maxSafeNat(), (d, v) => {
        const first = mustGenerate(d, v);
        expect(mazeEquals(mustGenerate(d, v), first)).toBe(true);
        for (const env of ENVS) {
          enterHost(env);
          try {
            expect(mazeEquals(mustGenerate(d, v), first)).toBe(true);
          } finally {
            restoreHost();
          }
        }
      }),
      runs(100)
    );
  });

  test('1.8 invalid Puzzle_Days and Variants give typed errors naming the input', () => {
    for (const bad of [
      '2026-02-30',
      '2026-2-3',
      '2026-02-03 ',
      '',
      '2026-13-01',
      '0000-01-01',
      '2026/02/03',
    ]) {
      expect(generate(bad, 0)).toEqual({
        ok: false,
        error: { kind: 'invalid-puzzle-day', input: bad },
      });
    }
    for (const bad of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(generate('2026-11-16', bad)).toEqual({
        ok: false,
        error: { kind: 'invalid-variant', input: bad },
      });
    }
    expect(generate('2026-11-16', Number.MAX_SAFE_INTEGER).ok).toBe(true);
  });

  // Property 2: Maze distinctness over the finite domain (480 pairs, enumerated in full).
  test('1.9 distinctness property over 120 days x Variants 0 to MAX_REGENERATIONS', () => {
    const seen = new Map<string, string>();
    for (const d of WINDOW) {
      for (let v = 0; v <= MAX_REGENERATIONS; v++) {
        const enc = encodeMaze(mustGenerate(d, v));
        if (!enc.ok) throw new Error(enc.error.detail);
        const key = enc.value;
        expect(
          seen.get(key),
          `${d}:${v} repeats ${seen.get(key) ?? ''}`
        ).toBeUndefined();
        seen.set(key, `${d}:${v}`);
      }
    }
    expect(seen.size).toBe(120 * (MAX_REGENERATIONS + 1));
  });

  test('1.3 to 1.6, 4.1 and 4.5 every Maze in the 120-day window is well formed and valid', () => {
    let fallbacks = 0;
    const attempts = new Array<number>(GENERATOR_ATTEMPTS).fill(0);
    expect(weekday(WINDOW[0]!)).toBe(3);
    for (const d of WINDOW) {
      for (let v = 0; v <= MAX_REGENERATIONS; v++) {
        const g = gen(d, v);
        const m = g.maze;
        const n = m.side;
        expect(n).toBe(GRID_SIDE);
        expect(outerClosed(m)).toBe(true);
        expect(corners(n)).toContain(m.start);
        expect(m.exit).toBe(opposite(n, m.start));
        expect(reachable(m, m.start).every((x) => x === 1)).toBe(true);
        expect(m.states.every((s) => s === 0)).toBe(true);
        const s = solve(m);
        expect(s.kind === 'solved' && s.par).toBe(g.par);
        expect(g.par).toBeGreaterThanOrEqual(MIN_PAR);
        expect(validateMaze(m, budgetFor(g.par, weekday(d)))).toEqual({
          ok: true,
          par: g.par,
        });
        if (g.attempt < 0) fallbacks++;
        else attempts[g.attempt]! += 1;
      }
    }
    console.info(
      `[1.5] attempts used over 480 Mazes: ${JSON.stringify(attempts)}; serpentine fallbacks: ${fallbacks}`
    );
  });

  test('1.5 MIN_PAR holds at every allowed GRID_SIZE', () => {
    fc.assert(
      fc.property(
        dayArb('2026-01-01', '2099-12-31'),
        fc.nat(3),
        fc.integer({ min: 9, max: 15 }),
        (d, v, side) => {
          const g = gen(d, v, side);
          expect(g.maze.side).toBe(side);
          expect(g.par).toBeGreaterThanOrEqual(2 * side);
          expect(validateMaze(g.maze, g.par)).toEqual({ ok: true, par: g.par });
        }
      ),
      runs(100)
    );
  });

  test('1.5 the serpentine fallback is valid with Par of at least 2n for every corner pair', () => {
    for (let n = 9; n <= 15; n++) {
      for (const start of corners(n)) {
        const m = serpentine(n, start, opposite(n, start));
        const s = solve(m);
        if (s.kind !== 'solved') throw new Error(`serpentine ${n} unsolved`);
        expect(s.par).toBeGreaterThanOrEqual(2 * n);
        expect(reachable(m, start).every((x) => x === 1)).toBe(true);
        expect(validateMaze(m, s.par)).toEqual({ ok: true, par: s.par });
      }
    }
  });

  test('1.10 each generate call returns within 100 ms at the configured GRID_SIZE', () => {
    let worst = 0;
    let total = 0;
    for (const d of WINDOW) {
      for (let v = 0; v <= MAX_REGENERATIONS; v++) {
        const t0 = performance.now();
        const r = generateDetailed(d, v);
        const dt = performance.now() - t0;
        expect(r.ok).toBe(true);
        worst = Math.max(worst, dt);
        total += dt;
      }
    }
    console.info(
      `[1.10] 480 calls: worst ${worst.toFixed(2)} ms, mean ${(total / 480).toFixed(3)} ms`
    );
    expect(worst).toBeLessThan(100);
  });
});
