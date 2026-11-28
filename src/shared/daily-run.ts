import type { StateResponse, StateSuccess } from './api';
import { decodeMaze } from './codec/maze';
import { PROGRESS_SYNC_MOVES } from './constants';
import { parsePuzzleDay, type PuzzleDay } from './date';
import { initAttempt, validateSubmission, type AttemptState } from './engine';
import { parsePostData } from './postdata';

export interface DailyRun {
  readonly puzzle: StateSuccess;
  readonly attempt: AttemptState;
  readonly savedMoves: number;
  readonly confirmed: boolean;
}

export function isDailyPost(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (Object.hasOwn(data, 'v') || Object.hasOwn(data, 'day'));
}

export function restoreDailyRun(state: StateResponse): DailyRun | null {
  if (state.status !== 'ok' || !Number.isSafeInteger(state.dayNumber) || state.dayNumber < 1 ||
      !Number.isSafeInteger(state.variant) || state.variant < 0 || !Number.isSafeInteger(state.budget) ||
      !Number.isSafeInteger(state.par) || state.budget < state.par || state.par < 1) {
    return null;
  }
  const maze = decodeMaze(state.maze);
  if (!maze.ok) return null;
  if (state.attempt.kind === 'none') {
    return { puzzle: state, attempt: initAttempt(maze.value, state.budget), savedMoves: 0, confirmed: false };
  }

  const saved = state.attempt;
  const finished = saved.kind === 'finished';
  const replayed = validateSubmission(maze.value, state.budget, saved.moves, finished ? 'finish' : 'progress');
  if (replayed.status !== 'ok') return null;
  const attempt = replayed.state;
  if (finished && (attempt.cost !== saved.cost || attempt.outcome !== saved.outcome)) return null;
  if (!finished && attempt.outcome !== null) return null;
  return { puzzle: state, attempt, savedMoves: attempt.accepted.length, confirmed: finished };
}

export function restoreSignedOutDaily(postData: unknown, today: PuzzleDay): DailyRun | null {
  const parsed = parsePostData(postData);
  if (!parsed.ok) return null;
  const { data, maze } = parsed.value;
  const day = parsePuzzleDay(data.day);
  if (!day.ok) return null;
  const dayStatus = data.status === 'live' && day.value < today ? 'closed' : data.status;
  return {
    puzzle: {
      status: 'ok',
      day: day.value,
      dayNumber: data.n,
      variant: data.var,
      maze: data.maze,
      par: data.par,
      budget: data.budget,
      dayStatus,
      loggedIn: false,
      attempt: { kind: 'none' },
    },
    attempt: initAttempt(maze, data.budget),
    savedMoves: 0,
    confirmed: false,
  };
}

export function shouldSaveProgress(saved: number, accepted: number): boolean {
  return (saved === 0 && accepted > 0) ||
    Math.floor(accepted / PROGRESS_SYNC_MOVES) > Math.floor(saved / PROGRESS_SYNC_MOVES);
}
