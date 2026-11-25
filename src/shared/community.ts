// Community_Route_Builder (Req 20.1 to 20.5, 20.7).
import type { CounterSnapshot } from './erosion';
import { MOVES, neighbour, type Maze } from './maze';

interface Best {
  readonly weight: bigint;
  readonly cells: number;
}

const better = (a: Best, b: Best | null): boolean =>
  b === null ||
  a.weight < b.weight ||
  (a.weight === b.weight && a.cells < b.cells);

function openNeighbours(m: Maze, cell: number): number[] {
  const out: number[] = [];
  for (const mv of MOVES) {
    const v = neighbour(m, cell, mv);
    if (v !== null) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The Start_Cell-to-Exit_Cell path of minimum total weight, where each Cell (both endpoints
 * included) weighs M + 1 - count with M the maximum counter; ties go to fewer Cells, then to the
 * lexicographically smallest row-major sequence (Req 20.1, 20.2). Null when every counter is 0
 * (Req 20.5). The snapshot must pass `validateSnapshot`; an unreachable Exit_Cell throws.
 */
export function communityRoute(
  prev: Maze,
  s: CounterSnapshot
): readonly number[] | null {
  const cells = prev.side * prev.side;
  const counts = Array.from({ length: cells }, (_, i) => BigInt(s[i] ?? 0));
  let max = 0n;
  for (const c of counts) if (c > max) max = c;
  if (max === 0n) return null;
  const w = counts.map((c) => max + 1n - c);
  const weight = (cell: number): bigint => w[cell] ?? 0n;

  // best[u]: the lexicographically least (weight, cells) over paths from u to the Exit_Cell.
  const best: (Best | null)[] = new Array<Best | null>(cells).fill(null);
  const done = new Uint8Array(cells);
  best[prev.exit] = { weight: weight(prev.exit), cells: 1 };
  for (;;) {
    let u = -1;
    let bu: Best | null = null;
    for (let i = 0; i < cells; i++) {
      const bi = best[i] ?? null;
      if (!done[i] && bi !== null && better(bi, bu)) {
        u = i;
        bu = bi;
      }
    }
    if (bu === null) break;
    done[u] = 1;
    for (const v of openNeighbours(prev, u)) {
      if (done[v]) continue;
      const cand = { weight: weight(v) + bu.weight, cells: bu.cells + 1 };
      if (better(cand, best[v] ?? null)) best[v] = cand;
    }
  }
  if (!best[prev.start])
    throw new RangeError('Exit_Cell unreachable from the Start_Cell');

  // Weights are positive, so `cells` drops by 1 per step and no Cell repeats.
  const route = [prev.start];
  let u = prev.start;
  while (u !== prev.exit) {
    const bu = best[u];
    const next = openNeighbours(prev, u).find((v) => {
      const bv = best[v];
      return (
        !!bu &&
        !!bv &&
        bv.weight + weight(u) === bu.weight &&
        bv.cells + 1 === bu.cells
      );
    });
    if (next === undefined) throw new RangeError(`no optimal step from ${u}`);
    route.push(next);
    u = next;
  }
  return route;
}

/**
 * Community_Route Cells inside the Visited_Cell_Set over all Community_Route Cells, as a whole
 * percent rounded down (Req 20.7).
 */
export function communityPercent(
  route: readonly number[],
  visited: readonly number[]
): number {
  if (route.length === 0) return 0;
  const seen = new Set(visited);
  let hit = 0;
  for (const c of route) if (seen.has(c)) hit++;
  return Math.floor((hit * 100) / route.length);
}
