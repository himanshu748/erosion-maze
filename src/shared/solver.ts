import { MOVES, moveCost, neighbour, type Maze } from './maze';

export type SolveResult =
  | {
      readonly kind: 'solved';
      readonly par: number;
      readonly path: readonly number[];
    }
  | { readonly kind: 'unreachable' };

export type RateResult =
  | { readonly kind: 'rated'; readonly par: number; readonly rating: number }
  | { readonly kind: 'unreachable' };

/**
 * Minimum Route_Cost from every Cell to `target` (Infinity when unreachable). Costs are
 * charged on entry, so this runs Dijkstra backwards with a bucket queue (costs 1 or 2).
 */
export function distancesTo(m: Maze, target: number): Float64Array {
  const cells = m.side * m.side;
  const dist = new Float64Array(cells).fill(Infinity);
  if (!Number.isInteger(target) || target < 0 || target >= cells) return dist;
  dist[target] = 0;
  const buckets: number[][] = [[target]];
  for (let d = 0; d < buckets.length; d++) {
    for (const v of buckets[d] ?? []) {
      if (dist[v] !== d) continue;
      const via = d + moveCost(m, v);
      for (const mv of MOVES) {
        const u = neighbour(m, v, mv);
        if (u !== null && via < (dist[u] ?? Infinity)) {
          dist[u] = via;
          (buckets[via] ??= []).push(u);
        }
      }
    }
  }
  return dist;
}

/** Minimum Route_Cost from each Cell to the Exit_Cell (Req 14.6). */
export const costToExit = (m: Maze): Float64Array => distancesTo(m, m.exit);

export const minCost = (m: Maze, from: number, to: number): number =>
  distancesTo(m, to)[from] ?? Infinity;

/**
 * Par and the lexicographically smallest optimal path (Req 2.1, 2.7): from each Cell, step to
 * the lowest-index open neighbour that keeps the route optimal.
 */
export function solve(m: Maze): SolveResult {
  const dist = costToExit(m);
  const par = dist[m.start];
  if (par === undefined || !Number.isFinite(par))
    return { kind: 'unreachable' };
  const path = [m.start];
  let u = m.start;
  while (u !== m.exit) {
    const here = at8(dist, u);
    let best: number | null = null;
    for (const mv of MOVES) {
      const v = neighbour(m, u, mv);
      if (
        v !== null &&
        moveCost(m, v) + at8(dist, v) === here &&
        (best === null || v < best)
      )
        best = v;
    }
    if (best === null) return { kind: 'unreachable' };
    path.push(best);
    u = best;
  }
  return { kind: 'solved', par, path };
}

const at8 = (a: Float64Array, i: number): number => a[i] ?? Infinity;

export function rate(m: Maze, budget: number): RateResult {
  const s = solve(m);
  if (s.kind === 'unreachable') return s;
  return { kind: 'rated', par: s.par, rating: s.par / budget };
}
