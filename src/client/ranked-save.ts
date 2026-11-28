import { encodeMoves } from '../shared/codec/moves';
import type { DailyRun } from '../shared/daily-run';

export type RankedRequestKind = 'load' | 'progress' | 'finish';

export function rankedSaveRequest(
  run: DailyRun,
  pending?: RankedRequestKind
): { readonly kind: 'progress' | 'finish'; readonly url: string; readonly options: RequestInit } | undefined {
  if (
    !run.puzzle.loggedIn ||
    run.confirmed ||
    run.puzzle.dayStatus !== 'live' ||
    run.attempt.accepted.length <= run.savedMoves
  ) return;

  const kind = run.attempt.outcome === null ? 'progress' : 'finish';
  // The finish contains the whole run. It can survive navigation even if a
  // checkpoint is still in flight, and the server preserves the longer run.
  if (pending && !(kind === 'finish' && pending === 'progress')) return;

  return {
    kind,
    url: kind === 'finish' ? '/api/finish' : '/api/progress',
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variant: run.puzzle.variant,
        moves: encodeMoves(run.attempt.accepted),
      }),
      keepalive: true,
    },
  };
}
