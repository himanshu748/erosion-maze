import fc from 'fast-check';
import { afterEach, describe, expect, test } from 'vitest';
import { compareRating, moveBudget } from '../shared/budget';
import {
  GRID_SIDE,
  MAX_REGENERATIONS,
  OVERGROWTH_CAP,
  WALL_CAP,
  WORN_RATIO,
} from '../shared/constants';
import { addDays, mondayOf, weekday, type PuzzleDay } from '../shared/date';
import {
  classifyWorn,
  evolve,
  validateSnapshot,
  type CounterSnapshot,
} from '../shared/erosion';
import { decodeMaze, encodeMaze } from '../shared/codec/maze';
import { generate } from '../shared/generator';
import { cloneMaze, mazeEquals, type Maze } from '../shared/maze';
import { rngFor, shuffled } from '../shared/prng';
import { solve } from '../shared/solver';
import { validateMaze } from '../shared/validator';
import { budgetFor } from './budget-ref';
import { ENVS, enterHost, restoreHost } from './host-env';
import {
  WINDOW,
  bigMazeArb,
  dayArb,
  day,
  entryCost,
  gen,
  interiorSlots,
  mazeKey,
  openSteps,
  runs,
  snapshotArb,
} from './maze-fixtures';

afterEach(restoreHost);

function enc(m: Maze): string {
  const r = encodeMaze(m);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
}

function dec(s: string): Maze {
  const r = decodeMaze(s);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
}

const cnt = (s: CounterSnapshot, i: number): number => s[i] ?? 0;

/** Plain O(V^2) Dijkstra, cost charged on entry. */
function refMinCost(m: Maze, from: number, to: number): number {
  const cells = m.side * m.side;
  const dist = new Array<number>(cells).fill(Infinity);
  const done = new Uint8Array(cells);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < cells; i++)
      if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!))
        u = i;
    if (u < 0 || u === to) return dist[to]!;
    done[u] = 1;
    for (const { to: v } of openSteps(m, u)) {
      const d = dist[u]! + entryCost(m, v);
      if (d < dist[v]!) dist[v] = d;
    }
  }
}

/** Interior Wall slot to its Cells (a < b). */
function slotCells(
  side: number,
  s: { h: boolean; i: number }
): [number, number] {
  if (s.h) {
    const r = Math.floor(s.i / side);
    const c = s.i % side;
    return [(r - 1) * side + c, r * side + c];
  }
  const r = Math.floor(s.i / (side + 1));
  const c = s.i % (side + 1);
  return [r * side + c - 1, r * side + c];
}

/**
 * Reference Erosion_Engine written from Req 6.3 to 6.8 and 6.15 directly. Route_Cost saved is
 * computed literally: the minimum Route_Cost before minus after removing only that Wall.
 */
function refEvolve(prev: Maze, s: CounterSnapshot, d: PuzzleDay, v: number) {
  const n = prev.side;
  const cells = n * n;
  let max = 0n;
  for (let i = 0; i < cells; i++)
    if (BigInt(cnt(s, i)) > max) max = BigInt(cnt(s, i));
  const worn = Array.from(
    { length: cells },
    (_, i) =>
      cnt(s, i) >= 1 &&
      BigInt(cnt(s, i)) * WORN_RATIO.den >= max * WORN_RATIO.num
  );
  const cands = interiorSlots(n)
    .filter((sl) => (sl.h ? prev.hWalls : prev.vWalls)[sl.i] !== 0)
    .map((sl) => ({ sl, ab: slotCells(n, sl) }))
    .filter(({ ab: [a, b] }) => worn[a] && worn[b])
    .map(({ sl, ab: [a, b] }) => {
      const opened = cloneMaze(prev);
      (sl.h ? opened.hWalls : opened.vWalls)[sl.i] = 0;
      return {
        sl,
        a,
        b,
        traffic: BigInt(cnt(s, a)) + BigInt(cnt(s, b)),
        saved: refMinCost(prev, a, b) - refMinCost(opened, a, b),
      };
    })
    .sort((x, y) =>
      x.traffic !== y.traffic
        ? x.traffic > y.traffic
          ? -1
          : 1
        : y.saved - x.saved || x.a - y.a || x.b - y.b
    );
  const removed = cands.slice(0, WALL_CAP);
  const out = cloneMaze(prev);
  for (const w of removed) (w.sl.h ? out.hWalls : out.vWalls)[w.sl.i] = 0;
  const eligible = (c: number) =>
    cnt(s, c) === 0 &&
    prev.states[c] !== 2 &&
    c !== prev.start &&
    c !== prev.exit;
  const chosen = new Set(
    shuffled(cells, rngFor(d, v, 'overgrow'))
      .filter(eligible)
      .slice(0, OVERGROWTH_CAP)
  );
  for (let c = 0; c < cells; c++) {
    out.states[c] = worn[c] ? 1 : prev.states[c] === 2 || chosen.has(c) ? 2 : 0;
  }
  return {
    maze: out,
    removableCount: cands.length,
    eligibleCount: Array.from({ length: cells }, (_, c) => c).filter(eligible)
      .length,
    worn: worn.flatMap((w, i) => (w ? [i] : [])),
    removed: removed.map((w) => [w.a, w.b]),
    grown: [...chosen].sort((a, b) => a - b),
  };
}

function mustEvolve(prev: Maze, s: CounterSnapshot, d: PuzzleDay, v: number) {
  const r = evolve(prev, s, d, v);
  if (!r.ok) throw new Error(`evolve failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

interface Built {
  readonly maze: Maze;
  readonly par: number;
  readonly budget: number;
  readonly variant: number;
}

/** One Puzzle_Day with the Req 2.5 Variant rule: the first Variant that passes the validator. */
function buildDay(
  d: PuzzleDay,
  prev: Maze | null,
  snapshot: CounterSnapshot,
  firstVariant = 0
): Built {
  for (let v = firstVariant; v < firstVariant + 10; v++) {
    const maze = prev ? mustEvolve(prev, snapshot, d, v).maze : gen(d, v).maze;
    const s = solve(maze);
    if (s.kind !== 'solved') continue;
    const budget = moveBudget(s.par, weekday(d));
    if (validateMaze(maze, budget).ok)
      return { maze, par: s.par, budget, variant: v };
  }
  throw new Error(`10 Variants rejected on ${d}`);
}

const bigWithDay = fc.tuple(
  bigMazeArb,
  dayArb('2026-01-01', '2099-12-31'),
  fc.nat(3)
);

describe('Erosion_Engine rules', () => {
  test('6.16 invalid snapshots name the first failing Cell and give no Maze', () => {
    const cells = 9;
    const cases: [number[], number, string][] = [
      [[-1], 0, 'negative'],
      [[0, 1.5], 1, 'non-integer'],
      [[0, Number.NaN], 1, 'non-integer'],
      [[0, 0, 2 ** 53], 2, 'too-large'],
      [[0, Number.POSITIVE_INFINITY], 1, 'non-integer'],
      [[0, -1, 1.5], 1, 'negative'],
      [new Array<number>(10).fill(0), 9, 'outside-grid'],
    ];
    for (const [s, cell, reason] of cases) {
      expect(validateSnapshot(s, cells)).toEqual({
        kind: 'snapshot-invalid',
        cell,
        reason,
      });
    }
    const prev = gen('2026-11-16', 0).maze;
    const bad = new Array<number>(122).fill(0);
    expect(evolve(prev, bad, day('2026-11-17'), 0)).toEqual({
      ok: false,
      error: { kind: 'snapshot-invalid', cell: 121, reason: 'outside-grid' },
    });
    const sparse: number[] = [1];
    sparse[2] = 3; // index 1 is a hole, a missing entry
    expect(validateSnapshot(sparse, cells)).toBeNull();
    expect(validateSnapshot([], cells)).toBeNull();
    expect(validateSnapshot([Number.MAX_SAFE_INTEGER], cells)).toBeNull();
  });

  test('6.3 Worn threshold: max 3 makes 2 and 3 Worn and 1 not; exact near 2^53', () => {
    expect(Array.from(classifyWorn([1, 2, 3, 0], 4))).toEqual([0, 1, 1, 0]);
    const M = Number.MAX_SAFE_INTEGER;
    expect(Array.from(classifyWorn([M, 2 ** 52, 2 ** 52 - 1], 3))).toEqual([
      1, 1, 0,
    ]);
    expect(Array.from(classifyWorn([0, 0], 3))).toEqual([0, 0, 0]);
  });

  // Model test for Req 6.3 to 6.8 and 6.15 against the literal reference above.
  test('6.3 to 6.8 and 6.15 evolve matches the reference Erosion_Engine', () => {
    fc.assert(
      fc.property(
        bigWithDay.chain(([m, d, v]) =>
          snapshotArb(m.side * m.side).map((s) => ({ m, d, v, s }))
        ),
        ({ m, d, v, s }) => {
          const got = mustEvolve(m, s, d, v);
          const want = refEvolve(m, s, d, v);
          expect(mazeKey(got.maze)).toBe(mazeKey(want.maze));
          expect(got.report.worn).toEqual(want.worn);
          expect(got.report.wallsRemoved).toEqual(want.removed);
          expect(got.report.newlyOvergrown).toEqual(want.grown);
        }
      ),
      runs(60)
    );
  });

  test('6.8 GRID_SIZE, endpoints, boundary and every unremoved Wall are kept; no Wall is added', () => {
    fc.assert(
      fc.property(
        bigWithDay.chain(([m, d, v]) =>
          snapshotArb(m.side * m.side).map((s) => ({ m, d, v, s }))
        ),
        ({ m, d, v, s }) => {
          const { maze: e, report } = mustEvolve(m, s, d, v);
          expect([e.side, e.start, e.exit]).toEqual([m.side, m.start, m.exit]);
          const opened: string[] = [];
          m.hWalls.forEach((w, i) => {
            expect(e.hWalls[i]! <= w).toBe(true);
            if (w && !e.hWalls[i]) opened.push(`h${i}`);
          });
          m.vWalls.forEach((w, i) => {
            expect(e.vWalls[i]! <= w).toBe(true);
            if (w && !e.vWalls[i]) opened.push(`v${i}`);
          });
          expect(opened).toHaveLength(report.wallsRemoved.length);
          for (const [a, b] of report.wallsRemoved) {
            expect(openSteps(e, a).some((x) => x.to === b)).toBe(true);
          }
        }
      ),
      runs(100)
    );
  });

  test('6.6 and Q9 a different Variant picks different overgrowth when more Cells are eligible than the cap', () => {
    const prev = gen('2026-11-16', 0).maze;
    const zero: number[] = [];
    const a = mustEvolve(prev, zero, day('2026-11-17'), 0).report
      .newlyOvergrown;
    const b = mustEvolve(prev, zero, day('2026-11-17'), 1).report
      .newlyOvergrown;
    expect(a).toHaveLength(OVERGROWTH_CAP);
    expect(b).toHaveLength(OVERGROWTH_CAP);
    expect(a).not.toEqual(b);
  });
});

describe('Erosion_Engine properties', () => {
  // Property 14: Erosion_Engine determinism.
  test('6.2 determinism property across clock, time zone, locale and Math.random', () => {
    fc.assert(
      fc.property(
        bigWithDay.chain(([m, d, v]) =>
          snapshotArb(m.side * m.side, true).map((s) => ({ m, d, v, s }))
        ),
        ({ m, d, v, s }) => {
          const first = mustEvolve(m, s, d, v);
          expect(mustEvolve(m, s, d, v)).toEqual(first);
          for (const env of ENVS) {
            enterHost(env);
            try {
              const again = mustEvolve(m, s, d, v);
              expect(mazeEquals(again.maze, first.maze)).toBe(true);
              expect(again.report).toEqual(first.report);
            } finally {
              restoreHost();
            }
          }
        }
      ),
      runs(100)
    );
  });

  // Property 15: Evolution preserves validity.
  test('6.9 and 6.11 solvability and zero-player properties', () => {
    fc.assert(
      fc.property(
        bigWithDay.chain(([m, d, v]) =>
          snapshotArb(m.side * m.side, true).map((s) => ({ m, d, v, s }))
        ),
        ({ m, d, v, s }) => {
          for (const snap of [s, []]) {
            const { maze, report } = mustEvolve(m, snap, d, v);
            const sol = solve(maze);
            if (sol.kind !== 'solved') throw new Error('evolved Maze unsolved');
            const budget = moveBudget(sol.par, weekday(d));
            expect(validateMaze(maze, budget)).toEqual({
              ok: true,
              par: sol.par,
            });
            if (snap.length === 0) {
              expect(report.worn).toEqual([]);
              expect(report.wallsRemoved).toEqual([]);
            }
          }
        }
      ),
      runs(150)
    );
  });

  // Property 16: Evolution caps.
  test('6.10 cap property, with exactly min(cap, available) changes', () => {
    fc.assert(
      fc.property(
        bigWithDay.chain(([m, d, v]) =>
          snapshotArb(m.side * m.side, true).map((s) => ({ m, d, v, s }))
        ),
        ({ m, d, v, s }) => {
          const { maze, report } = mustEvolve(m, s, d, v);
          const want = refEvolve(m, s, d, v);
          expect(report.wallsRemoved.length).toBeLessThanOrEqual(WALL_CAP);
          expect(report.wallsRemoved).toHaveLength(
            Math.min(WALL_CAP, want.removableCount)
          );
          const newly = Array.from(maze.states).flatMap((st, c) =>
            st === 2 && m.states[c] !== 2 ? [c] : []
          );
          expect(newly).toEqual(report.newlyOvergrown);
          expect(newly.length).toBeLessThanOrEqual(OVERGROWTH_CAP);
          expect(newly).toHaveLength(
            Math.min(OVERGROWTH_CAP, want.eligibleCount)
          );
        }
      ),
      runs(60)
    );
  });

  // Property 9: Weekly difficulty curve over the 120-day range (enumerated in full).
  test('4.3 and 4.5 difficulty-curve property over 2027-11-04 to 2028-03-02', () => {
    let prev: Built | null = null;
    let compared = 0;
    let seeds = 0;
    for (const [i, d] of WINDOW.entries()) {
      const seed = i === 0 || weekday(d) === 0;
      const built: Built = buildDay(d, seed ? null : prev!.maze, []);
      expect(built.variant).toBe(0);
      expect(built.budget).toBe(budgetFor(built.par, weekday(d)));
      expect(validateMaze(built.maze, built.budget).ok).toBe(true);
      if (seed) seeds++;
      else {
        compared++;
        expect(
          compareRating(built, prev!),
          `${d} rates below the day before`
        ).toBeGreaterThanOrEqual(0);
      }
      prev = built;
    }
    expect(WINDOW.map(String)).toContain('2028-02-29');
    expect(WINDOW.map(String)).toContain('2028-01-01');
    expect(seeds + compared).toBe(120);
    expect(compared).toBe(102);
  });

  // Property 10: Weekly difficulty curve over random Week_Cycles (at least 100 per run).
  test('4.4 and 4.6 difficulty-curve property over random Week_Cycles', () => {
    const cells = GRID_SIDE * GRID_SIDE;
    fc.assert(
      fc.property(
        dayArb('2026-01-05', '2099-12-28').map(mondayOf),
        fc.integer({ min: 0, max: MAX_REGENERATIONS }),
        fc.array(snapshotArb(cells), { minLength: 6, maxLength: 6 }),
        (monday, variant, snaps) => {
          let prev = buildDay(monday, null, [], variant);
          for (let k = 1; k <= 6; k++) {
            const d = addDays(monday, k);
            const next = buildDay(d, prev.maze, snaps[k - 1]!);
            expect(validateMaze(next.maze, next.budget).ok).toBe(true);
            expect(compareRating(next, prev)).toBeGreaterThanOrEqual(0);
            prev = next;
          }
        }
      ),
      runs(100)
    );
  });

  // Property 17: Evolution reproducibility from stored records (stored Maze_Codec strings).
  test('6.13 reproducibility property from stored Day_Records', () => {
    const playerArb = fc.array(fc.nat(), { maxLength: 200 });
    fc.assert(
      fc.property(
        dayArb('2026-01-01', '2099-12-31'),
        fc.array(
          fc.record({
            variant: fc.nat(MAX_REGENERATIONS),
            players: fc.array(playerArb, { maxLength: 6 }),
            trim: fc.boolean(),
          }),
          { minLength: 1, maxLength: 7 }
        ),
        (start, days) => {
          const seed = generate(start, 0);
          if (!seed.ok) throw new Error('seed failed');
          const records: {
            key: string;
            snapshot: number[];
            day: PuzzleDay;
            variant: number;
          }[] = [
            { key: enc(seed.value), snapshot: [], day: start, variant: 0 },
          ];
          let maze = seed.value;
          for (const [k, plan] of days.entries()) {
            const cells = maze.side * maze.side;
            const counters = new Array<number>(cells).fill(0);
            const sol = solve(maze);
            if (sol.kind !== 'solved') throw new Error('unsolved');
            const budget = moveBudget(sol.par, weekday(records[k]!.day));
            for (const rolls of plan.players) {
              const visited = new Set([maze.start]);
              let cell = maze.start;
              let cost = 0;
              for (const roll of rolls) {
                const opts = openSteps(maze, cell).filter(
                  (x) => entryCost(maze, x.to) <= budget - cost
                );
                if (opts.length === 0 || cell === maze.exit) break;
                const pick = opts[roll % opts.length]!;
                cell = pick.to;
                cost += entryCost(maze, cell);
                visited.add(cell);
              }
              for (const c of visited) counters[c]! += 1;
            }
            let snapshot = counters;
            if (plan.trim) {
              let end = snapshot.length;
              while (end > 0 && snapshot[end - 1] === 0) end--;
              snapshot = snapshot.slice(0, end);
            }
            const d = addDays(start, k + 1);
            maze = mustEvolve(maze, snapshot, d, plan.variant).maze;
            records.push({
              key: enc(maze),
              snapshot: [...snapshot],
              day: d,
              variant: plan.variant,
            });
          }
          for (let i = 1; i < records.length; i++) {
            const r = records[i]!;
            const again = mustEvolve(
              dec(records[i - 1]!.key),
              r.snapshot,
              r.day,
              r.variant
            );
            expect(enc(again.maze)).toBe(r.key);
          }
        }
      ),
      runs(100)
    );
  });
});
