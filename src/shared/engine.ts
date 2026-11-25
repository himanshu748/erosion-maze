// Game_Engine (Req 3.1 to 3.11) and Move_Validator (Req 10.1, 10.2, 10.6, 10.10).
import type { ApiStatus } from './api';
import { decodeMoves } from './codec/moves';
import { MOVES, moveCost, neighbour, type Maze, type Move } from './maze';

export type Outcome = 'solved' | 'out-of-moves';
export type MoveResult =
  'accepted' | 'blocked-wall' | 'blocked-budget' | 'rejected-finished';

export interface AttemptState {
  readonly maze: Maze;
  readonly budget: number;
  readonly cell: number;
  /** Starts with the Start_Cell (Req 3.9). */
  readonly route: readonly number[];
  /** Route_Cost. */
  readonly cost: number;
  readonly accepted: readonly Move[];
  readonly outcome: Outcome | null;
}

export const initAttempt = (m: Maze, budget: number): AttemptState => ({
  maze: m,
  budget,
  cell: m.start,
  route: [m.start],
  cost: 0,
  accepted: [],
  outcome: null,
});

type Step =
  | { readonly result: Exclude<MoveResult, 'accepted'> }
  | {
      readonly result: 'accepted';
      readonly cell: number;
      readonly cost: number;
      readonly outcome: Outcome | null;
    };

function step(
  m: Maze,
  budget: number,
  cell: number,
  cost: number,
  outcome: Outcome | null,
  mv: Move
): Step {
  if (outcome !== null) return { result: 'rejected-finished' };
  const next = neighbour(m, cell, mv);
  if (next === null) return { result: 'blocked-wall' };
  const spent = cost + moveCost(m, next);
  if (spent > budget) return { result: 'blocked-budget' };
  if (next === m.exit) {
    return { result: 'accepted', cell: next, cost: spent, outcome: 'solved' };
  }
  const left = budget - spent;
  const stuck = MOVES.every((d) => {
    const u = neighbour(m, next, d);
    return u === null || moveCost(m, u) > left;
  });
  return {
    result: 'accepted',
    cell: next,
    cost: spent,
    outcome: stuck ? 'out-of-moves' : null,
  };
}

export function applyMove(
  s: AttemptState,
  mv: Move
): { readonly state: AttemptState; readonly result: MoveResult } {
  const r = step(s.maze, s.budget, s.cell, s.cost, s.outcome, mv);
  if (r.result !== 'accepted') return { state: s, result: r.result };
  return {
    state: {
      ...s,
      cell: r.cell,
      route: [...s.route, r.cell],
      cost: r.cost,
      accepted: [...s.accepted, mv],
      outcome: r.outcome,
    },
    result: 'accepted',
  };
}

/** The same rules as repeated `applyMove`, without copying the Route on every Move. */
export function replay(
  m: Maze,
  budget: number,
  moves: readonly Move[]
): { readonly state: AttemptState; readonly results: readonly MoveResult[] } {
  let cell = m.start;
  let cost = 0;
  let outcome: Outcome | null = null;
  const route = [cell];
  const accepted: Move[] = [];
  const results: MoveResult[] = [];
  for (const mv of moves) {
    const r = step(m, budget, cell, cost, outcome, mv);
    results.push(r.result);
    if (r.result !== 'accepted') continue;
    cell = r.cell;
    cost = r.cost;
    outcome = r.outcome;
    route.push(cell);
    accepted.push(mv);
  }
  return {
    state: { maze: m, budget, cell, route, cost, accepted, outcome },
    results,
  };
}

/** Visited_Cell_Set: distinct Cells of the Route, ascending. */
export const visitedSet = (route: readonly number[]): readonly number[] =>
  [...new Set(route)].sort((a, b) => a - b);

export type SubmissionMode = 'progress' | 'finish';
export type SubmissionResult =
  | {
      readonly status: 'ok';
      readonly moves: readonly Move[];
      readonly state: AttemptState;
      readonly visited: readonly number[];
    }
  | {
      readonly status: Extract<
        ApiStatus,
        'invalid_moves' | 'invalid_length' | 'unfinished'
      >;
    };

/**
 * Move_Validator: decode, length check, replay, finish-mode Outcome check. Route_Cost, Outcome
 * and Visited_Cell_Set come only from this replay (Req 10.4).
 */
export function validateSubmission(
  m: Maze,
  budget: number,
  encoded: string,
  mode: SubmissionMode
): SubmissionResult {
  const decoded = decodeMoves(encoded);
  if (!decoded.ok) return { status: 'invalid_moves' };
  const moves = decoded.value;
  if (moves.length === 0 || moves.length > budget) {
    return { status: 'invalid_length' };
  }
  const { state, results } = replay(m, budget, moves);
  if (results.some((r) => r !== 'accepted')) return { status: 'invalid_moves' };
  if (mode === 'finish' && state.outcome === null) {
    return { status: 'unfinished' };
  }
  return { status: 'ok', moves, state, visited: visitedSet(state.route) };
}
