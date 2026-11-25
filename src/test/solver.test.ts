import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { compareRating } from '../shared/budget';
import { replay } from '../shared/engine';
import { closedMaze, type Maze } from '../shared/maze';
import { costToExit, minCost, rate, solve } from '../shared/solver';
import { validateMaze } from '../shared/validator';
import {
  bigMazeArb,
  DIR_CODE,
  entryCost,
  openSteps,
  pathToDirs,
  reachable,
  runs,
  smallMazeArb,
} from './maze-fixtures';

const lexLess = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  return a.length < b.length;
};

/**
 * Exhaustive branch-and-bound reference (Property 3). Reachability by breadth-first search; then
 * a depth-first enumeration of simple paths, pruned only by cost so far plus the Manhattan
 * distance (every Move costs at least 1), starting from the cost of a breadth-first path as an
 * upper bound. It returns the minimum cost and the lexicographically smallest path of that cost.
 */
function reference(m: Maze): { par: number; path: number[] } | null {
  const n = m.side;
  if (!reachable(m, m.start)[m.exit]) return null;
  const er = Math.floor(m.exit / n);
  const ec = m.exit % n;
  const md = (u: number): number =>
    Math.abs(Math.floor(u / n) - er) + Math.abs((u % n) - ec);

  const prev = new Int32Array(n * n).fill(-1);
  prev[m.start] = m.start;
  const queue = [m.start];
  for (let i = 0; i < queue.length; i++) {
    for (const { to } of openSteps(m, queue[i]!)) {
      if (prev[to] === -1) {
        prev[to] = queue[i]!;
        queue.push(to);
      }
    }
  }
  let best = 0;
  for (let u = m.exit; u !== m.start; u = prev[u]!) best += entryCost(m, u);

  let lex: number[] | null = null;
  const onPath = new Uint8Array(n * n);
  const path = [m.start];
  onPath[m.start] = 1;
  const dfs = (u: number, cost: number): void => {
    if (u === m.exit) {
      if (cost < best || lex === null || lexLess(path, lex)) {
        best = cost;
        lex = path.slice();
      }
      return;
    }
    for (const { to } of openSteps(m, u)) {
      const c = cost + entryCost(m, to);
      if (onPath[to] || c + md(to) > best) continue;
      onPath[to] = 1;
      path.push(to);
      dfs(to, c);
      path.pop();
      onPath[to] = 0;
    }
  };
  dfs(m.start, 0);
  if (lex === null) throw new Error('reference lost the breadth-first path');
  return { par: best, path: lex };
}

/** Bellman-Ford relaxation of cost-to-exit, for costToExit and minCost. */
function relaxToExit(m: Maze): number[] {
  const cells = m.side * m.side;
  const dist = new Array<number>(cells).fill(Infinity);
  dist[m.exit] = 0;
  for (let round = 0; round < cells; round++) {
    let changed = false;
    for (let u = 0; u < cells; u++) {
      for (const { to } of openSteps(m, u)) {
        const via = entryCost(m, to) + dist[to]!;
        if (via < dist[u]!) {
          dist[u] = via;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return dist;
}

function checkPath(m: Maze, path: readonly number[], par: number): void {
  expect(path[0]).toBe(m.start);
  expect(path[path.length - 1]).toBe(m.exit);
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    expect(openSteps(m, path[i - 1]!).some((s) => s.to === path[i])).toBe(true);
    cost += entryCost(m, path[i]!);
  }
  expect(cost).toBe(par);
}

describe('solver', () => {
  // Property 3: Solver matches exhaustive search (at least 500 Mazes, unreachable ones included).
  test('2.2 model-based property against the exhaustive reference', () => {
    let solved = 0;
    let unreachable = 0;
    fc.assert(
      fc.property(smallMazeArb, (m) => {
        const want = reference(m);
        const got = solve(m);
        if (want === null) {
          unreachable++;
          expect(got).toEqual({ kind: 'unreachable' });
          return;
        }
        solved++;
        if (got.kind !== 'solved') throw new Error('solver missed a path');
        expect(got.par).toBe(want.par);
        expect(Number.isInteger(got.par) && got.par > 0).toBe(true);
        checkPath(m, got.path, got.par);
        expect(got.path).toEqual(want.path);
      }),
      runs(600)
    );
    expect(solved + unreachable).toBeGreaterThanOrEqual(500);
    expect(unreachable).toBeGreaterThan(0);
    expect(solved).toBeGreaterThan(0);
  });

  test('2.1 and 14.6 costToExit and minCost match a Bellman-Ford relaxation', () => {
    fc.assert(
      fc.property(smallMazeArb, (m) => {
        const want = relaxToExit(m);
        expect(Array.from(costToExit(m))).toEqual(want);
        expect(minCost(m, m.start, m.exit)).toBe(want[m.start]);
      }),
      runs(300)
    );
  });

  test('2.1 equal Mazes give the same Par and path', () => {
    fc.assert(
      fc.property(bigMazeArb, (m) => {
        const copy: Maze = {
          ...m,
          hWalls: m.hWalls.slice(),
          vWalls: m.vWalls.slice(),
          states: m.states.slice(),
        };
        expect(solve(copy)).toEqual(solve(m));
      }),
      runs(100)
    );
  });

  // Property 4: Optimal path soundness.
  test('2.3 soundness property at every GRID_SIZE from 9 x 9 to 15 x 15', () => {
    fc.assert(
      fc.property(bigMazeArb, (m) => {
        const s = solve(m);
        if (s.kind !== 'solved') throw new Error('generated Maze unsolved');
        expect(validateMaze(m, s.par)).toEqual({ ok: true, par: s.par });
        const moves = pathToDirs(m, s.path).map((d) => DIR_CODE[d]);
        const run = replay(m, s.par, moves);
        expect(run.results.every((x) => x === 'accepted')).toBe(true);
        expect(run.state.outcome).toBe('solved');
        expect(run.state.cost).toBe(s.par);
      }),
      runs(150)
    );
  });

  // Property 5: Difficulty_Rating determinism and monotonicity.
  test('2.6 and 2.9 rating determinism and monotonicity property', () => {
    fc.assert(
      fc.property(bigMazeArb, fc.nat(500), fc.nat(500), (m, k1, k2) => {
        const s = solve(m);
        if (s.kind !== 'solved') throw new Error('generated Maze unsolved');
        const b1 = s.par + k1;
        const b2 = b1 + 1 + k2;
        expect(validateMaze(m, b1).ok && validateMaze(m, b2).ok).toBe(true);
        const r1 = rate(m, b1);
        const r1again = rate(m, b1);
        const r2 = rate(m, b2);
        if (
          r1.kind !== 'rated' ||
          r2.kind !== 'rated' ||
          r1again.kind !== 'rated'
        )
          throw new Error('unrated');
        expect(r1again).toEqual(r1);
        expect(Number.isFinite(r1.rating) && Number.isFinite(r2.rating)).toBe(
          true
        );
        expect(r1.par * b2).toBeGreaterThan(r2.par * b1);
        expect(
          compareRating(
            { par: r1.par, budget: b1 },
            { par: r2.par, budget: b2 }
          )
        ).toBe(1);
        expect(r1.rating).toBeGreaterThan(r2.rating);
      }),
      runs(100)
    );
  });

  test('2.7 an unreachable Exit_Cell gives no Par, path or rating', () => {
    const m = closedMaze(3, 0, 8);
    expect(solve(m)).toEqual({ kind: 'unreachable' });
    expect(rate(m, 10)).toEqual({ kind: 'unreachable' });
    expect(minCost(m, 0, 8)).toBe(Infinity);
  });
});
