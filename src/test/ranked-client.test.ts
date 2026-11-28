import { describe, expect, it } from 'vitest';
import { isDailyPost, rankedSaveRequest, restoreDailyRun, restoreSignedOutDaily, shouldSaveProgress } from '../shared/daily-run';
import type { StateSuccess } from '../shared/api';
import { routeToMoves } from '../shared/canonical';
import { encodeHeatmap } from '../shared/codec/heatmap';
import { encodeMaze } from '../shared/codec/maze';
import { encodeMoves } from '../shared/codec/moves';
import { GRID_SIDE } from '../shared/constants';
import { applyMove } from '../shared/engine';
import { serpentine } from '../shared/generator';
import { solve } from '../shared/solver';
import { day } from './maze-fixtures';

function fixture() {
  const maze = serpentine(GRID_SIDE, 0, GRID_SIDE * GRID_SIDE - 1);
  const encoded = encodeMaze(maze);
  const solution = solve(maze);
  if (!encoded.ok || solution.kind !== 'solved') throw new Error('invalid fixture');
  const state: StateSuccess = {
    status: 'ok',
    day: day('2026-11-23'),
    dayNumber: 1,
    variant: 0,
    maze: encoded.value,
    par: solution.par,
    budget: solution.par + 2,
    dayStatus: 'live',
    loggedIn: true,
    attempt: { kind: 'none' },
  };
  return { state, moves: routeToMoves(maze.side, solution.path) };
}

describe('ranked client state', () => {
  it('routes daily post metadata to ranked play and leaves practice metadata alone', () => {
    expect(isDailyPost(undefined)).toBe(false);
    expect(isDailyPost({})).toBe(false);
    expect(isDailyPost({ v: 1 })).toBe(true);
    expect(isDailyPost({ day: '2026-11-23' })).toBe(true);
  });

  it('restores a saved prefix and remembers the last synchronized move', () => {
    const { state, moves } = fixture();
    const prefix = moves.slice(0, 2);
    const run = restoreDailyRun({
      ...state,
      attempt: { kind: 'unfinished', moves: encodeMoves(prefix) },
    });
    expect(run?.attempt.accepted).toEqual(prefix);
    expect(run?.savedMoves).toBe(2);
    expect(run?.confirmed).toBe(false);
  });

  it('only shows a finished state when server outcome and replay agree', () => {
    const { state, moves } = fixture();
    const attempt = {
      kind: 'finished' as const,
      moves: encodeMoves(moves),
      cost: state.par,
      outcome: 'solved' as const,
      trailblazer: false,
      completedAt: 1,
    };
    expect(restoreDailyRun({ ...state, attempt })?.confirmed).toBe(true);
    expect(restoreDailyRun({ ...state, attempt: { ...attempt, cost: 1 } })).toBeNull();
  });

  it('plays valid post metadata locally and closes old cached metadata by UTC day', () => {
    const { state } = fixture();
    const heat = encodeHeatmap({ side: GRID_SIDE, levels: new Uint8Array(GRID_SIDE * GRID_SIDE) });
    if (!heat.ok) throw new Error('invalid heat fixture');
    const post = {
      v: 1, n: state.dayNumber, day: state.day, var: state.variant, status: 'live',
      seed: true, maze: state.maze, par: state.par, budget: state.budget,
      heat: heat.value, finalHeat: null, route: null,
    };
    const play = restoreSignedOutDaily(post, state.day);
    expect(play?.puzzle.loggedIn).toBe(false);
    expect(play?.puzzle.dayStatus).toBe('live');
    expect(play?.puzzle.attempt).toEqual({ kind: 'none' });
    expect(restoreSignedOutDaily(post, day('2026-11-24'))?.puzzle.dayStatus).toBe('closed');
    expect(restoreSignedOutDaily({ ...post, maze: 'broken' }, state.day)).toBeNull();
  });

  it('schedules the first and every fifth accepted move even across a pending save', () => {
    expect(shouldSaveProgress(0, 1)).toBe(true);
    expect(shouldSaveProgress(1, 4)).toBe(false);
    expect(shouldSaveProgress(1, 6)).toBe(true);
    expect(shouldSaveProgress(6, 10)).toBe(true);
    expect(shouldSaveProgress(10, 11)).toBe(false);
  });
  it('sends the unsent finish with keepalive while its first checkpoint is pending', () => {
    const { state, moves } = fixture();
    const start = restoreDailyRun(state);
    if (!start || moves[0] === undefined) throw new Error('invalid fixture');

    const checkpoint = { ...start, attempt: applyMove(start.attempt, moves[0]).state };
    expect(rankedSaveRequest(checkpoint)?.url).toBe('/api/progress');
    expect(rankedSaveRequest(checkpoint, 'progress')).toBeUndefined();

    const attempt = moves.slice(1).reduce((run, move) => applyMove(run, move).state, checkpoint.attempt);
    const finished = { ...checkpoint, attempt };
    expect(attempt.outcome).toBe('solved');
    expect(rankedSaveRequest(finished, 'progress')).toMatchObject({
      kind: 'finish',
      url: '/api/finish',
      options: {
        keepalive: true,
        method: 'POST',
        body: JSON.stringify({ variant: state.variant, moves: encodeMoves(moves) }),
      },
    });
    expect(rankedSaveRequest(finished, 'finish')).toBeUndefined();
    expect(rankedSaveRequest(finished, 'load')).toBeUndefined();
    expect(rankedSaveRequest({ ...finished, confirmed: true })).toBeUndefined();
  });
});
