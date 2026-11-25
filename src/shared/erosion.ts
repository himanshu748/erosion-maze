// Erosion_Engine (Req 6.1 to 6.17): the next day's Maze from the previous Maze, the previous
// Puzzle_Key's Counter_Snapshot, the Puzzle_Day and the Variant, and nothing else.
import { OVERGROWTH_CAP, WALL_CAP, WORN_RATIO } from './constants';
import type { PuzzleDay } from './date';
import {
  DOWN,
  OVERGROWN,
  NORMAL,
  RIGHT,
  WORN,
  at,
  cloneMaze,
  moveCost,
  setWall,
  type Maze,
} from './maze';
import { rngFor, shuffled } from './prng';
import { err, ok, type Result } from './result';
import { minCost } from './solver';

/** Dense, by Cell index; missing trailing entries count as 0. */
export type CounterSnapshot = readonly number[];
export type SnapshotError = {
  readonly kind: 'snapshot-invalid';
  readonly cell: number;
  readonly reason: 'negative' | 'non-integer' | 'too-large' | 'outside-grid';
};

export interface EvolveReport {
  /** Worn_Cells, ascending. */
  readonly worn: readonly number[];
  /** Removed Walls as [a, b] with a < b, in removal order. */
  readonly wallsRemoved: readonly (readonly [a: number, b: number])[];
  /** Cells newly Overgrown, ascending. */
  readonly newlyOvergrown: readonly number[];
}

const count = (s: CounterSnapshot, cell: number): number => s[cell] ?? 0;

/** First failing index in ascending order, or null (Req 6.16). */
export function validateSnapshot(
  s: CounterSnapshot,
  cells: number
): SnapshotError | null {
  for (let i = 0; i < s.length; i++) {
    const fail = (reason: SnapshotError['reason']): SnapshotError => ({
      kind: 'snapshot-invalid',
      cell: i,
      reason,
    });
    if (i >= cells) return fail('outside-grid');
    const v: unknown = s[i];
    if (v === undefined) continue; // a hole in a sparse array is a missing entry
    if (typeof v !== 'number' || Number.isNaN(v)) return fail('non-integer');
    if (v < 0) return fail('negative');
    if (!Number.isInteger(v)) return fail('non-integer');
    if (v > Number.MAX_SAFE_INTEGER) return fail('too-large');
  }
  return null;
}

/** Worn exactly when count >= 1 and count * den >= max * num, in BigInt (Req 6.3). */
export function classifyWorn(s: CounterSnapshot, cells: number): Uint8Array {
  let max = 0n;
  for (let i = 0; i < cells; i++) {
    const v = BigInt(count(s, i));
    if (v > max) max = v;
  }
  const worn = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    const v = BigInt(count(s, i));
    if (v >= 1n && v * WORN_RATIO.den >= max * WORN_RATIO.num) worn[i] = 1;
  }
  return worn;
}

interface Candidate {
  readonly a: number;
  readonly b: number;
  readonly traffic: bigint;
  readonly saved: number;
}

/** Interior Walls present between two Worn_Cells, in the Req 6.5 removal order. */
function removalOrder(
  prev: Maze,
  s: CounterSnapshot,
  worn: Uint8Array
): Candidate[] {
  const n = prev.side;
  const out: Candidate[] = [];
  const consider = (a: number, b: number, present: boolean): void => {
    if (!present || !at(worn, a) || !at(worn, b)) return;
    const d = minCost(prev, a, b);
    out.push({
      a,
      b,
      traffic: BigInt(count(s, a)) + BigInt(count(s, b)),
      saved: d - Math.min(d, moveCost(prev, b)),
    });
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * n + c;
      if (c < n - 1)
        consider(a, a + 1, at(prev.vWalls, r * (n + 1) + c + 1) !== 0);
      if (r < n - 1) consider(a, a + n, at(prev.hWalls, (r + 1) * n + c) !== 0);
    }
  }
  return out.sort((x, y) =>
    x.traffic !== y.traffic
      ? x.traffic > y.traffic
        ? -1
        : 1
      : y.saved - x.saved || x.a - y.a || x.b - y.b
  );
}

export function evolve(
  prev: Maze,
  snapshot: CounterSnapshot,
  day: PuzzleDay,
  variant: number
): Result<
  { readonly maze: Maze; readonly report: EvolveReport },
  SnapshotError
> {
  const n = prev.side;
  const cells = n * n;
  const bad = validateSnapshot(snapshot, cells);
  if (bad) return err(bad);

  const worn = classifyWorn(snapshot, cells);
  const next = cloneMaze(prev);

  const removed = removalOrder(prev, snapshot, worn).slice(0, WALL_CAP);
  for (const w of removed) {
    setWall(next, w.a, w.b === w.a + 1 ? RIGHT : DOWN, false);
  }

  const order = shuffled(cells, rngFor(day, variant, 'overgrow'));
  const grow = new Uint8Array(cells);
  let grown = 0;
  for (const cell of order) {
    if (grown >= OVERGROWTH_CAP) break;
    const eligible =
      count(snapshot, cell) === 0 &&
      at(prev.states, cell) !== OVERGROWN &&
      cell !== prev.start &&
      cell !== prev.exit;
    if (eligible) {
      grow[cell] = 1;
      grown++;
    }
  }

  const wornList: number[] = [];
  const newlyOvergrown: number[] = [];
  for (let c = 0; c < cells; c++) {
    if (at(worn, c)) {
      next.states[c] = WORN;
      wornList.push(c);
    } else if (at(prev.states, c) === OVERGROWN) {
      next.states[c] = OVERGROWN;
    } else if (at(grow, c)) {
      next.states[c] = OVERGROWN;
      newlyOvergrown.push(c);
    } else {
      next.states[c] = NORMAL;
    }
  }

  return ok({
    maze: next,
    report: {
      worn: wornList,
      wallsRemoved: removed.map((w) => [w.a, w.b] as const),
      newlyOvergrown,
    },
  });
}
