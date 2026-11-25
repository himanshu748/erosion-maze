// Test-only helpers for Maze tests. Wall and Cell reads here go straight to the arrays, so the
// checks do not reuse `neighbour` or `moveCost` from src/shared/maze.ts.
import fc from 'fast-check';
import { OVERGROWN_COST } from '../shared/constants';
import {
  addDays,
  fromDayIndex,
  parsePuzzleDay,
  toDayIndex,
  type PuzzleDay,
} from '../shared/date';
import { generateDetailed, type Generated } from '../shared/generator';
import type { Maze } from '../shared/maze';
import { solve } from '../shared/solver';

export const FC_SEED = Number(process.env.FC_SEED ?? 20261120);
export const runs = (numRuns: number): { numRuns: number; seed: number } => ({
  numRuns,
  seed: FC_SEED,
});

export function day(s: string): PuzzleDay {
  const r = parsePuzzleDay(s);
  if (!r.ok) throw new Error(`test fixture ${s} is invalid`);
  return r.value;
}

export function gen(d: string, v: number, side?: number): Generated {
  const r = generateDetailed(d, v, side);
  if (!r.ok) throw new Error(`generate(${d}, ${v}) failed: ${r.error.kind}`);
  return r.value;
}

/** The 120 consecutive Puzzle_Days of Req 4.5: 2027-11-04 (a Thursday) through 2028-03-02. */
export const WINDOW: readonly PuzzleDay[] = Array.from(
  { length: 120 },
  (_, i) => addDays(day('2027-11-04'), i)
);

export const dayArb = (
  from = '2000-01-01',
  to = '2099-12-31'
): fc.Arbitrary<PuzzleDay> =>
  fc
    .integer({ min: toDayIndex(day(from)), max: toDayIndex(day(to)) })
    .map(fromDayIndex);

/** Canonical text for a Maze under the Req 1.2 equality. */
export const mazeKey = (m: Maze): string =>
  [
    m.side,
    m.start,
    m.exit,
    Array.from(m.hWalls, (w) => (w ? 1 : 0)).join(''),
    Array.from(m.vWalls, (w) => (w ? 1 : 0)).join(''),
    m.states.join(''),
  ].join('|');

export type Dir = 'U' | 'R' | 'D' | 'L';
export const DIR_CODE: Record<Dir, 0 | 1 | 2 | 3> = { U: 0, R: 1, D: 2, L: 3 };

export function openSteps(m: Maze, cell: number): { to: number; dir: Dir }[] {
  const n = m.side;
  const r = Math.floor(cell / n);
  const c = cell % n;
  const out: { to: number; dir: Dir }[] = [];
  if (r > 0 && m.hWalls[r * n + c] === 0) out.push({ to: cell - n, dir: 'U' });
  if (c < n - 1 && m.vWalls[r * (n + 1) + c + 1] === 0)
    out.push({ to: cell + 1, dir: 'R' });
  if (r < n - 1 && m.hWalls[(r + 1) * n + c] === 0)
    out.push({ to: cell + n, dir: 'D' });
  if (c > 0 && m.vWalls[r * (n + 1) + c] === 0)
    out.push({ to: cell - 1, dir: 'L' });
  return out;
}

export const entryCost = (m: Maze, cell: number): number =>
  m.states[cell] === 2 ? OVERGROWN_COST : 1;

export function reachable(m: Maze, from: number): Uint8Array {
  const seen = new Uint8Array(m.side * m.side);
  seen[from] = 1;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const { to } of openSteps(m, queue[i]!)) {
      if (!seen[to]) {
        seen[to] = 1;
        queue.push(to);
      }
    }
  }
  return seen;
}

export function outerClosed(m: Maze): boolean {
  const n = m.side;
  for (let i = 0; i < n; i++) {
    if (
      !m.hWalls[i] ||
      !m.hWalls[n * n + i] ||
      !m.vWalls[i * (n + 1)] ||
      !m.vWalls[i * (n + 1) + n]
    )
      return false;
  }
  return true;
}

/** Interior Walls as [array, index] pairs, horizontal first. */
export function interiorSlots(side: number): { h: boolean; i: number }[] {
  const out: { h: boolean; i: number }[] = [];
  for (let r = 1; r < side; r++)
    for (let c = 0; c < side; c++) out.push({ h: true, i: r * side + c });
  for (let r = 0; r < side; r++)
    for (let c = 1; c < side; c++)
      out.push({ h: false, i: r * (side + 1) + c });
  return out;
}

/** Square Maze of 2 x 2 to 6 x 6 with a closed boundary, random interior Walls and Cell_States. */
export const smallMazeArb: fc.Arbitrary<Maze> = fc
  .integer({ min: 2, max: 6 })
  .chain((side) => {
    const cells = side * side;
    const slots = interiorSlots(side);
    return fc
      .record({
        density: fc.integer({ min: 0, max: 100 }),
        rolls: fc.array(fc.nat(99), {
          minLength: slots.length,
          maxLength: slots.length,
        }),
        states: fc.array(fc.constantFrom(0, 1, 2), {
          minLength: cells,
          maxLength: cells,
        }),
        start: fc.nat(cells - 1),
        offset: fc.integer({ min: 1, max: cells - 1 }),
      })
      .map(({ density, rolls, states, start, offset }): Maze => {
        const hWalls = new Uint8Array((side + 1) * side).fill(1);
        const vWalls = new Uint8Array(side * (side + 1)).fill(1);
        slots.forEach((s, k) => {
          (s.h ? hWalls : vWalls)[s.i] = rolls[k]! < density ? 1 : 0;
        });
        return {
          side,
          hWalls,
          vWalls,
          start,
          exit: (start + offset) % cells,
          states: Uint8Array.from(states),
        };
      });
  });

/**
 * A generated Maze at 9 x 9 to 15 x 15, then changed the way erosion can change one: some
 * interior Walls removed and some Cells Worn or Overgrown, endpoints kept non-Overgrown.
 */
export const bigMazeArb: fc.Arbitrary<Maze> = fc
  .record({
    d: dayArb('2026-01-01', '2099-12-31'),
    v: fc.nat(3),
    side: fc.integer({ min: 9, max: 15 }),
  })
  .chain(({ d, v, side }) => {
    const cells = side * side;
    return fc
      .record({
        rolls: fc.array(fc.nat(9), { minLength: cells, maxLength: cells }),
        removals: fc.array(fc.nat(100_000), { maxLength: 30 }),
      })
      .map(({ rolls, removals }): Maze => {
        const base = gen(d, v, side).maze;
        const hWalls = base.hWalls.slice();
        const vWalls = base.vWalls.slice();
        const slots = interiorSlots(side);
        for (const k of removals) {
          const s = slots[k % slots.length]!;
          (s.h ? hWalls : vWalls)[s.i] = 0;
        }
        const states = Uint8Array.from(rolls, (x) =>
          x < 6 ? 0 : x < 8 ? 1 : 2
        );
        states[base.start] = 0;
        states[base.exit] = 0;
        return {
          side,
          hWalls,
          vWalls,
          start: base.start,
          exit: base.exit,
          states,
        };
      });
  });

export type SimStep =
  'accepted' | 'blocked-wall' | 'blocked-budget' | 'rejected-finished';

/** Independent Move simulator for Req 3.1 to 3.5 and 3.10. */
export function simulate(
  m: Maze,
  budget: number,
  dirs: readonly Dir[]
): {
  steps: SimStep[];
  route: number[];
  cost: number;
  outcome: 'solved' | 'out-of-moves' | null;
} {
  let cell = m.start;
  let cost = 0;
  let outcome: 'solved' | 'out-of-moves' | null = null;
  const route = [cell];
  const steps: SimStep[] = [];
  for (const d of dirs) {
    if (outcome) {
      steps.push('rejected-finished');
      continue;
    }
    const s = openSteps(m, cell).find((x) => x.dir === d);
    if (!s) {
      steps.push('blocked-wall');
      continue;
    }
    if (entryCost(m, s.to) > budget - cost) {
      steps.push('blocked-budget');
      continue;
    }
    cell = s.to;
    cost += entryCost(m, cell);
    route.push(cell);
    steps.push('accepted');
    if (cell === m.exit) outcome = 'solved';
    else if (
      openSteps(m, cell).every((x) => entryCost(m, x.to) > budget - cost)
    )
      outcome = 'out-of-moves';
  }
  return { steps, route, cost, outcome };
}

export function pathToDirs(m: Maze, path: readonly number[]): Dir[] {
  const out: Dir[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const delta = b - a;
    out.push(
      delta === -m.side ? 'U' : delta === 1 ? 'R' : delta === m.side ? 'D' : 'L'
    );
  }
  return out;
}

/** An independent Move_Codec decoder (bit strings, no shared code) for model checks. */
const REF_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function refDecodeMoves(s: string): number[] | null {
  if (s.length < 4 || s[0] !== 'A') return null;
  let bits = '';
  for (let i = 1; i < s.length; i++) {
    const v = REF_ALPHABET.indexOf(s.charAt(i));
    if (v < 0) return null;
    bits += v.toString(2).padStart(6, '0');
  }
  const count = parseInt(bits.slice(0, 18), 2);
  if (s.length !== 4 + Math.ceil(count / 3)) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i++)
    out.push(parseInt(bits.slice(18 + 2 * i, 20 + 2 * i), 2));
  if (/1/.test(bits.slice(18 + 2 * count))) return null;
  return out;
}

const DIRS: readonly Dir[] = ['U', 'R', 'D', 'L'];
export const toDirs = (moves: readonly number[]): Dir[] =>
  moves.map((m) => DIRS[m]!);

/**
 * A valid Maze, a Move_Budget of at least Par, and a Move sequence of 0 to 2 x budget Moves:
 * random Moves, or a prefix of the optimal path followed by a walk over open edges that may
 * ignore the budget and may continue after an Outcome.
 */
export const attemptArb: fc.Arbitrary<{
  m: Maze;
  par: number;
  budget: number;
  moves: (0 | 1 | 2 | 3)[];
}> = fc
  .tuple(bigMazeArb, fc.nat(100))
  .map(([m, slackPct]) => {
    const s = solve(m);
    if (s.kind !== 'solved') throw new Error('generated Maze unsolved');
    const budget = s.par + Math.floor((s.par * slackPct) / 100);
    return { m, par: s.par, budget, path: s.path };
  })
  .chain(({ m, par, budget, path }) => {
    const max = 2 * budget;
    const random = fc.array(fc.constantFrom<0 | 1 | 2 | 3>(0, 1, 2, 3), {
      maxLength: max,
    });
    const walk = fc
      .record({
        prefix: fc.nat(),
        rolls: fc.array(fc.nat(), { maxLength: max }),
        fit: fc.boolean(),
        stop: fc.boolean(),
      })
      .map(({ prefix, rolls, fit, stop }) => {
        const opt = pathToDirs(m, path);
        const dirs: Dir[] = opt.slice(0, prefix % (opt.length + 1));
        let cell = m.start;
        let cost = 0;
        for (const d of dirs) {
          cell = openSteps(m, cell).find((x) => x.dir === d)!.to;
          cost += entryCost(m, cell);
        }
        let done = cell === m.exit;
        for (const roll of rolls) {
          if (dirs.length >= max || (stop && done)) break;
          const options = openSteps(m, cell).filter(
            (x) => !fit || entryCost(m, x.to) <= budget - cost
          );
          if (options.length === 0) break;
          const pick = options[roll % options.length]!;
          dirs.push(pick.dir);
          if (!done && entryCost(m, pick.to) <= budget - cost) {
            cell = pick.to;
            cost += entryCost(m, cell);
            done =
              cell === m.exit ||
              openSteps(m, cell).every(
                (x) => entryCost(m, x.to) > budget - cost
              );
          }
        }
        return dirs.map((d) => DIR_CODE[d]);
      });
    return fc
      .oneof(random, walk, walk)
      .map((moves) => ({ m, par, budget, moves }));
  });

/**
 * Counter_Snapshots for `cells` Cells: all-zero (full length, shortened or empty), small
 * counters with many ties, sparse, dense, truncated (missing trailing entries) and, when `huge`, counters up to 2^53 - 1.
 */
export function snapshotArb(
  cells: number,
  huge = false
): fc.Arbitrary<number[]> {
  const value = huge
    ? fc.oneof(
        fc.nat(1_000_000),
        fc.maxSafeNat(),
        fc.constant(Number.MAX_SAFE_INTEGER)
      )
    : fc.nat(1_000_000);
  const full = { minLength: cells, maxLength: cells };
  return fc.oneof(
    fc.integer({ min: 0, max: cells }).map((k) => new Array<number>(k).fill(0)),
    // Small counters, as on a quiet day: traffic ties and exact half-maximum counters are common.
    fc.array(fc.nat(3), full),
    fc.array(fc.constantFrom(0, 0, 0, 1, 2, 4), full),
    fc
      .tuple(
        fc.array(value, full),
        fc.array(fc.nat(99), full),
        fc.integer({ min: 1, max: 30 })
      )
      .map(([vals, rolls, pct]) =>
        vals.map((x, i) => (rolls[i]! < pct ? x : 0))
      ),
    fc.array(value, full),
    fc
      .tuple(fc.array(value, full), fc.nat(cells))
      .map(([vals, k]) => vals.slice(0, k))
  );
}
