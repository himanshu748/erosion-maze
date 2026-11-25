import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { encodeMoves } from '../shared/codec/moves';
import {
  applyMove,
  initAttempt,
  replay,
  validateSubmission,
  visitedSet,
  type AttemptState,
} from '../shared/engine';
import { closedMaze, DOWN, LEFT, RIGHT, UP, type Maze } from '../shared/maze';
import { attemptArb, runs, simulate, toDirs } from './maze-fixtures';

/**
 * 3 x 3, Start_Cell 0, Exit_Cell 2, Cell 1 Overgrown. Open edges: 0-1, 1-2, 0-3, 3-4.
 *   0 = 1 = 2
 *   |
 *   3 - 4
 */
function tiny(): Maze {
  const m = closedMaze(3, 0, 2);
  m.vWalls[1] = 0; // 0-1
  m.vWalls[2] = 0; // 1-2
  m.hWalls[3] = 0; // 0-3
  m.vWalls[4 + 1] = 0; // 3-4
  m.states[1] = 2;
  return m;
}

function run(m: Maze, budget: number, moves: (0 | 1 | 2 | 3)[]) {
  let s: AttemptState = initAttempt(m, budget);
  const results = [];
  for (const mv of moves) {
    const r = applyMove(s, mv);
    results.push(r.result);
    s = r.state;
  }
  return { s, results };
}

describe('Game_Engine rules', () => {
  test('3.9 an attempt starts on the Start_Cell with cost 0 and no Outcome', () => {
    const m = tiny();
    expect(initAttempt(m, 7)).toEqual({
      maze: m,
      budget: 7,
      cell: 0,
      route: [0],
      cost: 0,
      accepted: [],
      outcome: null,
    });
  });

  test('3.1 accepted Moves add the entered Cell cost, revisits included', () => {
    const { s, results } = run(tiny(), 9, [DOWN, UP, DOWN, RIGHT]);
    expect(results).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
    expect(s.route).toEqual([0, 3, 0, 3, 4]);
    expect(s.cost).toBe(4);
    expect(s.accepted).toEqual([DOWN, UP, DOWN, RIGHT]);
  });

  test('3.2 a Move into a Wall or the boundary is blocked and changes nothing', () => {
    const start = initAttempt(tiny(), 9);
    for (const mv of [UP, LEFT] as const) {
      const r = applyMove(start, mv);
      expect(r.result).toBe('blocked-wall');
      expect(r.state).toBe(start);
    }
    const at3 = applyMove(start, DOWN).state;
    expect(applyMove(at3, DOWN)).toEqual({
      state: at3,
      result: 'blocked-wall',
    });
  });

  test('3.3 a Move whose cost exceeds the remaining budget is blocked', () => {
    const start = initAttempt(tiny(), 1);
    expect(applyMove(start, RIGHT)).toEqual({
      state: start,
      result: 'blocked-budget',
    });
  });

  test('3.4 reaching the Exit_Cell solves the attempt, even with 0 budget left', () => {
    const { s } = run(tiny(), 3, [RIGHT, RIGHT]);
    expect(s.outcome).toBe('solved');
    expect(s.cost).toBe(3);
  });

  test('3.5 out of moves only when no open neighbour fits the remaining budget', () => {
    const m = tiny();
    const a = run(m, 2, [DOWN]);
    expect(a.s.outcome).toBeNull(); // the Exit_Cell is out of reach, but Cell 0 still fits
    const b = run(m, 2, [DOWN, RIGHT]);
    expect(b.s.outcome).toBe('out-of-moves');
    expect(b.s.cell).toBe(4);
    expect(b.s.cost).toBe(2);
    const c = run(m, 3, [RIGHT]); // on Cell 1 with 1 left: Cell 0 and Exit_Cell 2 cost 1
    expect(c.s.outcome).toBeNull();
  });

  test('3.10 Moves after an Outcome are rejected and change nothing', () => {
    const solved = run(tiny(), 3, [RIGHT, RIGHT]).s;
    for (const mv of [UP, RIGHT, DOWN, LEFT] as const) {
      expect(applyMove(solved, mv)).toEqual({
        state: solved,
        result: 'rejected-finished',
      });
    }
  });

  test('applyMove never mutates its input state', () => {
    const start = initAttempt(tiny(), 9);
    const snapshot = structuredClone(start);
    applyMove(start, DOWN);
    expect(start).toEqual(snapshot);
  });

  test('visitedSet is the distinct Route Cells in ascending order', () => {
    expect(visitedSet([5, 3, 5, 0, 3])).toEqual([0, 3, 5]);
    expect(visitedSet([7])).toEqual([7]);
  });
});

describe('Game_Engine properties', () => {
  // Property 6: Game_Engine replay determinism.
  test('3.6 replay determinism property', () => {
    fc.assert(
      fc.property(attemptArb, ({ m, budget, moves }) => {
        expect(replay(m, budget, moves)).toEqual(replay(m, budget, moves));
      }),
      runs(150)
    );
  });

  // Property 7: Route_Cost bounds.
  test('3.7 Route_Cost bounds invariant', () => {
    fc.assert(
      fc.property(attemptArb, ({ m, par, budget, moves }) => {
        let s = initAttempt(m, budget);
        for (const mv of moves) {
          s = applyMove(s, mv).state;
          expect(s.cost).toBeGreaterThanOrEqual(0);
          expect(s.cost).toBeLessThanOrEqual(budget);
          expect(s.accepted.length).toBeLessThanOrEqual(s.cost);
          if (s.outcome === 'solved')
            expect(s.cost).toBeGreaterThanOrEqual(par);
        }
        expect(replay(m, budget, moves).state).toEqual(s);
      }),
      runs(150)
    );
  });

  // Property 8: Blocked Moves are inert.
  test('3.11 blocked-Move property', () => {
    fc.assert(
      fc.property(attemptArb, ({ m, budget, moves }) => {
        const full = replay(m, budget, moves);
        const kept = moves.filter((_, i) => full.results[i] === 'accepted');
        const only = replay(m, budget, kept);
        expect(only.state.route).toEqual(full.state.route);
        expect(only.state.cost).toBe(full.state.cost);
        expect(only.state.outcome).toBe(full.state.outcome);
        expect(only.results.every((r) => r === 'accepted')).toBe(true);
      }),
      runs(150)
    );
  });
});

describe('Move_Validator', () => {
  // Property 27: Move_Validator matches the reference simulator.
  test('10.9 model-based property against the reference simulator', () => {
    const seen = new Map<string, number>();
    fc.assert(
      fc.property(
        attemptArb,
        fc.constantFrom('progress' as const, 'finish' as const),
        ({ m, budget, moves }, mode) => {
          const got = validateSubmission(m, budget, encodeMoves(moves), mode);
          const ref = simulate(m, budget, toDirs(moves));
          const lengthOk = moves.length >= 1 && moves.length <= budget;
          const allAccepted = ref.steps.every((x) => x === 'accepted');
          const want = !lengthOk
            ? 'invalid_length'
            : !allAccepted
              ? 'invalid_moves'
              : mode === 'finish' && ref.outcome === null
                ? 'unfinished'
                : 'ok';
          seen.set(want, (seen.get(want) ?? 0) + 1);
          expect(got.status).toBe(want);
          if (got.status !== 'ok') return;
          expect(got.state.cost).toBe(ref.cost);
          expect(got.state.outcome).toBe(ref.outcome);
          expect(got.visited).toEqual(
            [...new Set(ref.route)].sort((a, b) => a - b)
          );
          expect(got.moves).toEqual(moves);
        }
      ),
      runs(400)
    );
    for (const s of ['ok', 'invalid_moves', 'invalid_length', 'unfinished']) {
      expect(seen.get(s) ?? 0, `cases ending ${s}`).toBeGreaterThan(0);
    }
  });

  test('10.2 undecodable Move strings are invalid Moves', () => {
    const m = tiny();
    for (const bad of [
      '',
      'A',
      'AAA',
      'BAAB',
      'AAAB',
      'AAAEa',
      'AAAEa=',
      'AAAEax',
    ]) {
      expect(validateSubmission(m, 9, bad, 'progress')).toEqual({
        status: 'invalid_moves',
      });
    }
  });

  test('10.6 zero Moves or more Moves than the budget is an invalid length, checked before replay', () => {
    const m = tiny();
    expect(validateSubmission(m, 9, 'AAAA', 'progress').status).toBe(
      'invalid_length'
    );
    const tooMany = encodeMoves([UP, UP, UP, UP]);
    expect(validateSubmission(m, 3, tooMany, 'progress').status).toBe(
      'invalid_length'
    );
  });

  test('10.2 a blocked Move or a Move after the Outcome rejects the whole submission', () => {
    const m = tiny();
    expect(
      validateSubmission(m, 9, encodeMoves([DOWN, DOWN]), 'progress').status
    ).toBe('invalid_moves');
    expect(
      validateSubmission(m, 9, encodeMoves([RIGHT, RIGHT, LEFT]), 'progress')
        .status
    ).toBe('invalid_moves');
    expect(
      validateSubmission(m, 1, encodeMoves([RIGHT]), 'progress').status
    ).toBe('invalid_moves');
  });

  test('10.10 and 10.11 finish needs an Outcome; progress accepts one', () => {
    const m = tiny();
    expect(validateSubmission(m, 9, encodeMoves([DOWN]), 'finish').status).toBe(
      'unfinished'
    );
    const p = validateSubmission(m, 9, encodeMoves([DOWN]), 'progress');
    expect(p.status === 'ok' && p.state.outcome).toBeNull();
    const solved = validateSubmission(
      m,
      3,
      encodeMoves([RIGHT, RIGHT]),
      'progress'
    );
    expect(solved).toMatchObject({
      status: 'ok',
      visited: [0, 1, 2],
      state: { cost: 3, outcome: 'solved' },
    });
    const out = validateSubmission(m, 2, encodeMoves([DOWN, RIGHT]), 'finish');
    expect(out).toMatchObject({
      status: 'ok',
      visited: [0, 3, 4],
      state: { cost: 2, outcome: 'out-of-moves' },
    });
  });
});
