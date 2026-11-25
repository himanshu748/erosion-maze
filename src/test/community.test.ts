import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { canonicalize, fingerprint, routeToMoves } from '../shared/canonical';
import { decodeMoves, encodeMoves } from '../shared/codec/moves';
import { communityPercent, communityRoute } from '../shared/community';
import { HEAT_LEVELS } from '../shared/constants';
import { visitedSet } from '../shared/engine';
import { evolve } from '../shared/erosion';
import { quantize } from '../shared/heatmap';
import {
  DOWN,
  LEFT,
  RIGHT,
  UP,
  closedMaze,
  setWall,
  type Maze,
} from '../shared/maze';
import { solve } from '../shared/solver';
import {
  bigMazeArb,
  dayArb,
  interiorSlots,
  openSteps,
  reachable,
  runs,
  snapshotArb,
} from './maze-fixtures';

const cnt = (s: readonly number[], i: number): number => s[i] ?? 0;

/** Square Maze of 2 x 2 to 4 x 4: closed boundary, random interior Walls, all Cells Normal. */
const tinyMazeArb: fc.Arbitrary<Maze> = fc
  .integer({ min: 2, max: 4 })
  .chain((side) => {
    const cells = side * side;
    const slots = interiorSlots(side);
    return fc
      .record({
        walls: fc.array(fc.boolean(), {
          minLength: slots.length,
          maxLength: slots.length,
        }),
        start: fc.nat(cells - 1),
        offset: fc.integer({ min: 1, max: cells - 1 }),
      })
      .map(({ walls, start, offset }) => {
        const m = closedMaze(side, start, (start + offset) % cells);
        slots.forEach((s, k) => {
          (s.h ? m.hWalls : m.vWalls)[s.i] = walls[k] ? 1 : 0;
        });
        return m;
      });
  });

/** A wall-free walk of up to 60 Cells from the Start_Cell. */
const routeWalkArb = (m: Maze): fc.Arbitrary<number[]> =>
  fc.array(fc.nat(), { maxLength: 60 }).map((rolls) => {
    const route = [m.start];
    let cell = m.start;
    for (const roll of rolls) {
      const open = openSteps(m, cell);
      if (open.length === 0) break;
      cell = open[roll % open.length]!.to;
      route.push(cell);
    }
    return route;
  });

/** The route with one out-and-back detour spliced in after position `at`. */
const withDetour = (
  m: Maze,
  route: readonly number[],
  at: number,
  roll: number
): number[] => {
  const anchor = route[at]!;
  const open = openSteps(m, anchor);
  if (open.length === 0) return [...route];
  const s = open[roll % open.length]!.to;
  return [...route.slice(0, at + 1), s, ...route.slice(at)];
};

function expectValidRoute(m: Maze, route: readonly number[]): void {
  expect(route[0]).toBe(m.start);
  expect(route[route.length - 1]).toBe(m.exit);
  expect(new Set(route).size).toBe(route.length);
  for (let i = 1; i < route.length; i++) {
    expect(openSteps(m, route[i - 1]!).some((x) => x.to === route[i])).toBe(
      true
    );
  }
}

const lexLess = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return a.length < b.length;
};

const EXPLORATION_CAP = 200_000;

/** Reference Community_Route: exhaustive simple-path search, minimum (weight, cells), then lex. */
function refCommunity(m: Maze, s: readonly number[]): number[] | null {
  const cells = m.side * m.side;
  let max = 0;
  for (let i = 0; i < cells; i++) max = Math.max(max, cnt(s, i));
  if (max === 0) return null;
  const w = (c: number): number => max + 1 - cnt(s, c);
  let best: number[] | null = null;
  let bestKey: readonly [number, number] | null = null;
  let explored = 0;
  const path = [m.start];
  const inPath = new Set([m.start]);
  const dfs = (u: number): void => {
    if (u === m.exit) {
      const weight = path.reduce((t, c) => t + w(c), 0);
      const key: [number, number] = [weight, path.length];
      if (
        bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && lexLess(path, best!))
      ) {
        best = [...path];
        bestKey = key;
      }
      return;
    }
    for (const { to } of openSteps(m, u)) {
      if (inPath.has(to)) continue;
      if (++explored > EXPLORATION_CAP) throw new Error('too many paths');
      inPath.add(to);
      path.push(to);
      dfs(to);
      path.pop();
      inPath.delete(to);
    }
  };
  dfs(m.start);
  return best;
}

/** Fully open 3 x 3 Maze. */
const open3 = (start: number, exit: number): Maze => {
  const m = closedMaze(3, start, exit);
  for (const s of interiorSlots(3)) (s.h ? m.hWalls : m.vWalls)[s.i] = 0;
  return m;
};

describe('Heatmap quantization (Req 14.5)', () => {
  test('fixed: zero, maximum, ceiling and counters near 2^53', () => {
    expect(quantize([], 3).levels).toEqual(new Uint8Array(9));
    expect(quantize([1], 1).levels).toEqual(Uint8Array.from([HEAT_LEVELS - 1]));
    expect(Array.from(quantize([1, 2], 2).levels)).toEqual([4, 7, 0, 0]);
    const M = Number.MAX_SAFE_INTEGER;
    // ceil(2^52 * 7 / (2^53 - 1)) = 4; every walked Cell is at least level 1.
    expect(Array.from(quantize([M, M - 1, 2 ** 52, 1], 2).levels)).toEqual([
      7, 7, 4, 1,
    ]);
  });

  test('definition property: 0 only at 0, walked Cells at least 1, busiest at the top', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 2, max: 15 })
          .chain((side) =>
            snapshotArb(side * side, true).map((s) => ({ side, s }))
          ),
        ({ side, s }) => {
          const h = quantize(s, side);
          expect(h.levels).toHaveLength(side * side);
          let max = 0n;
          for (let i = 0; i < side * side; i++) {
            const c = BigInt(cnt(s, i));
            if (c > max) max = c;
          }
          const top = BigInt(HEAT_LEVELS - 1);
          for (let i = 0; i < side * side; i++) {
            const c = BigInt(cnt(s, i));
            const l = BigInt(h.levels[i]!);
            if (c === 0n) {
              expect(l).toBe(0n);
            } else {
              // l - 1 < c * top / max <= l, checked exactly in BigInt.
              expect(l >= 1n && l <= top).toBe(true);
              expect((l - 1n) * max < c * top && c * top <= l * max).toBe(true);
            }
            if (max > 0n && c === max) expect(l).toBe(top);
          }
        }
      ),
      runs(200)
    );
  });
});

describe('Community_Route_Builder', () => {
  test('20.5 an all-zero or empty snapshot gives no Community_Route', () => {
    const m = closedMaze(9, 0, 80);
    expect(communityRoute(m, [])).toBeNull();
    expect(communityRoute(m, [0, 0, 0])).toBeNull();
  });

  test('20.3 an unreachable Exit_Cell throws', () => {
    expect(() => communityRoute(closedMaze(9, 0, 80), [1])).toThrow(RangeError);
  });

  test('20.1 weight favours busy Cells, then the lexicographic tie-break applies', () => {
    // w(4) = 1, w(others) = 6; the four shortest routes through Cell 4 tie at 25.
    expect(communityRoute(open3(0, 8), [0, 0, 0, 0, 5, 0, 0, 0, 0])).toEqual([
      0, 1, 4, 5, 8,
    ]);
  });

  test('20.2 fewer Cells wins a weight tie', () => {
    // Direct route [0,1,2] and detour [0,3,4,5,2] both weigh 9; the direct one has 3 Cells.
    expect(communityRoute(open3(0, 2), [0, 0, 0, 2, 2, 2, 0, 0, 0])).toEqual([
      0, 1, 2,
    ]);
  });

  test('20.1 heavy traffic pulls the route off the direct line', () => {
    // w(3) = w(4) = w(5) = 1, w(others) = 4; the detour weighs 11 against 12.
    expect(communityRoute(open3(0, 2), [0, 0, 0, 3, 3, 3, 0, 0, 0])).toEqual([
      0, 3, 4, 5, 2,
    ]);
  });

  test('20.2 the forward walk checks the Cell count, not only the weight', () => {
    // Two disjoint routes: [3,0,1,2,5,8] (5 busy Cells, weight 5 from 0) and [3,6,7,8]
    // (weight 5 from 6). Both neighbours of 3 match on weight; only 6 matches on Cells.
    const m = closedMaze(3, 3, 8);
    setWall(m, 0, RIGHT, false);
    setWall(m, 1, RIGHT, false);
    setWall(m, 2, DOWN, false);
    setWall(m, 5, DOWN, false);
    setWall(m, 0, DOWN, false);
    setWall(m, 3, DOWN, false);
    setWall(m, 6, RIGHT, false);
    setWall(m, 7, RIGHT, false);
    expect(communityRoute(m, [1, 1, 1, 0, 0, 1, 0, 0, 1])).toEqual([
      3, 6, 7, 8,
    ]);
  });

  test('20.2 the lexicographically smallest sequence wins a full tie', () => {
    // Two disjoint routes, [0,1,2,5,8] and [0,3,6,7,8]; Cell 4 is busy but walled off.
    const m = closedMaze(3, 0, 8);
    setWall(m, 0, RIGHT, false);
    setWall(m, 1, RIGHT, false);
    setWall(m, 2, DOWN, false);
    setWall(m, 5, DOWN, false);
    setWall(m, 0, DOWN, false);
    setWall(m, 3, DOWN, false);
    setWall(m, 6, RIGHT, false);
    setWall(m, 7, RIGHT, false);
    expect(communityRoute(m, [0, 0, 0, 0, 7, 0, 0, 0, 0])).toEqual([
      0, 1, 2, 5, 8,
    ]);
  });

  test('20.1 and 20.2 communityRoute matches exhaustive simple-path search', () => {
    fc.assert(
      fc.property(
        tinyMazeArb.chain((m) =>
          fc
            .array(fc.nat(4), {
              minLength: m.side * m.side,
              maxLength: m.side * m.side,
            })
            .map((s) => ({ m, s }))
        ),
        ({ m, s }) => {
          fc.pre(reachable(m, m.start)[m.exit] === 1);
          const want = (() => {
            try {
              return refCommunity(m, s);
            } catch {
              return undefined; // too many simple paths to enumerate
            }
          })();
          fc.pre(want !== undefined);
          const got = communityRoute(m, s);
          expect(got === null ? null : [...got]).toEqual(want);
        }
      ),
      runs(200)
    );
  });

  // Property 33: Community_Route validity (Req 20.3).
  test('20.3 validity property, on the Maze and on its evolution', () => {
    fc.assert(
      fc.property(
        bigMazeArb.chain((m) =>
          fc
            .tuple(snapshotArb(m.side * m.side, true), dayArb(), fc.nat(3))
            .map(([s, d, v]) => ({ m, s, d, v }))
        ),
        ({ m, s, d, v }) => {
          const route = communityRoute(m, s);
          fc.pre(route !== null);
          expectValidRoute(m, route);
          const e = evolve(m, s, d, v);
          if (!e.ok) throw new Error('evolve failed');
          // Evolution only removes Walls and keeps the endpoints (Req 6.8, D21).
          expectValidRoute(e.value.maze, route);
        }
      ),
      runs(60)
    );
  });

  // Property 34: Community_Route determinism (Req 20.4).
  test('20.4 determinism property, all-zero snapshots included', () => {
    fc.assert(
      fc.property(
        bigMazeArb.chain((m) =>
          snapshotArb(m.side * m.side, true).map((s) => ({ m, s }))
        ),
        ({ m, s }) => {
          expect(communityRoute(m, s)).toEqual(communityRoute(m, s));
        }
      ),
      runs(100)
    );
  });
});

describe('communityPercent (Req 20.7)', () => {
  test('fixed: floor percent of Community_Route Cells visited', () => {
    expect(communityPercent([], [])).toBe(0);
    expect(communityPercent([0, 1, 2, 3], [0, 3])).toBe(50);
    expect(communityPercent([0, 1, 2], [1])).toBe(33);
    expect(communityPercent([4, 5], [4, 5, 9])).toBe(100);
    expect(communityPercent([4, 5], [9])).toBe(0);
  });

  test('property: equals the Set recount, floored', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat(224), { maxLength: 225 }),
        fc.array(fc.nat(224), { maxLength: 300 }),
        (route, visited) => {
          const seen = new Set(visited);
          const hit = route.filter((c) => seen.has(c)).length;
          const want =
            route.length === 0 ? 0 : Math.floor((hit * 100) / route.length);
          expect(communityPercent(route, visited)).toBe(want);
        }
      ),
      runs(200)
    );
  });
});

describe('Route_Canonicalizer', () => {
  test('21.1 fixed: chronological loop erasure, Start-only Routes', () => {
    expect(canonicalize([5])).toEqual([5]);
    expect(canonicalize([0, 1, 0])).toEqual([0]); // ends back at the Start_Cell
    expect(canonicalize([0, 1, 2, 1, 3])).toEqual([0, 1, 3]);
    expect(canonicalize([0, 1, 2, 3, 1, 4, 2])).toEqual([0, 1, 4, 2]);
    expect(canonicalize([0, 1, 2, 1, 3, 2])).toEqual([0, 1, 3, 2]);
    expect(canonicalize([0, 1, 2, 2])).toEqual([0, 1, 2]);
    expect(canonicalize([])).toEqual([]);
  });

  // Property 35: Canonicalization idempotence (Req 21.2).
  test('21.2 idempotence property', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(40), { maxLength: 80 }), (r) => {
        const once = canonicalize(r);
        expect(canonicalize(once)).toEqual(once);
        expect(new Set(once).size).toBe(once.length);
      }),
      runs(300)
    );
  });

  // Property 36: Canonical_Route shape (Req 21.3).
  test('21.3 shape property over solved Routes with detours', () => {
    fc.assert(
      fc.property(
        bigMazeArb.chain((m) => {
          const s = solve(m);
          if (s.kind !== 'solved') throw new Error('generated Maze unsolved');
          return fc
            .array(
              fc.record({
                at: fc.nat(s.path.length - 1),
                rolls: fc.array(fc.nat(), { maxLength: 8 }),
              }),
              { maxLength: 5 }
            )
            .map((detours) => ({ m, path: s.path, detours }));
        }),
        ({ m, path, detours }) => {
          // A legal solved Route: the optimal path plus out-and-back detours.
          const route: number[] = [];
          let cursor = 0;
          for (const { at, rolls } of [...detours].sort(
            (a, b) => a.at - b.at
          )) {
            while (cursor <= at) route.push(path[cursor++]!);
            const anchor = path[at]!;
            let cell = anchor;
            const steps: number[] = [];
            for (const roll of rolls) {
              const open = openSteps(m, cell);
              if (open.length === 0) break;
              cell = open[roll % open.length]!.to;
              steps.push(cell);
            }
            route.push(...steps, ...steps.slice(0, -1).reverse(), anchor);
          }
          while (cursor < path.length) route.push(path[cursor++]!);
          expect(route[0]).toBe(m.start);
          expect(route[route.length - 1]).toBe(m.exit);
          const c = canonicalize(route);
          expect(c[0]).toBe(m.start);
          expect(c[c.length - 1]).toBe(m.exit);
          expect(new Set(c).size).toBe(c.length);
          const visited = visitedSet(route);
          for (const cell of c) expect(visited).toContain(cell);
          for (let i = 1; i < c.length; i++) {
            expect(openSteps(m, c[i - 1]!).some((x) => x.to === c[i])).toBe(
              true
            );
          }
        }
      ),
      runs(100)
    );
  });
});

describe('fingerprint (Req 21.10)', () => {
  test('fixed: Start-only route, one-Move route, decode round trip', () => {
    expect(fingerprint(9, [0])).toBe('AAAA');
    expect(fingerprint(9, [0])).toBe(encodeMoves([]));
    expect(fingerprint(9, [0, 1])).toBe(encodeMoves([RIGHT]));
    expect(decodeMoves(fingerprint(9, [0, 9, 10]))).toEqual({
      ok: true,
      value: [DOWN, RIGHT],
    });
    expect(decodeMoves(fingerprint(9, [10, 9, 0]))).toEqual({
      ok: true,
      value: [LEFT, UP],
    });
  });

  // Property 38: fingerprints are equal exactly when the Cell sequences are equal.
  test('21.10 fingerprint equality property', () => {
    fc.assert(
      fc.property(
        bigMazeArb.chain((m) =>
          fc
            .tuple(routeWalkArb(m), routeWalkArb(m))
            .map(([a, b]) => ({ m, a, b }))
        ),
        ({ m, a, b }) => {
          const ca = canonicalize(a);
          const cb = canonicalize(b);
          const same =
            ca.length === cb.length && ca.every((x, i) => x === cb[i]);
          expect(fingerprint(m.side, ca) === fingerprint(m.side, cb)).toBe(
            same
          );
        }
      ),
      runs(200)
    );
  });

  test('21.10 an out-and-back detour leaves the fingerprint unchanged', () => {
    fc.assert(
      fc.property(
        bigMazeArb.chain((m) =>
          fc
            .tuple(routeWalkArb(m), fc.nat(59), fc.nat())
            .map(([w, at, roll]) => ({ m, w, at, roll }))
        ),
        ({ m, w, at, roll }) => {
          const d = withDetour(m, w, at % w.length, roll);
          expect(fingerprint(m.side, canonicalize(d))).toBe(
            fingerprint(m.side, canonicalize(w))
          );
        }
      ),
      runs(200)
    );
  });

  test('routeToMoves throws on a non-adjacent or row-wrapping step', () => {
    expect(routeToMoves(9, [])).toEqual([]);
    expect(routeToMoves(9, [4])).toEqual([]);
    expect(() => routeToMoves(9, [0, 2])).toThrow(RangeError);
    expect(() => routeToMoves(9, [0, 18])).toThrow(RangeError);
    expect(() => routeToMoves(9, [8, 9])).toThrow(RangeError);
  });
});
