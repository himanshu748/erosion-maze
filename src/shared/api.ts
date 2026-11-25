import type { PuzzleDay } from './date';
import type { Outcome } from './engine';
import type { StreakValue } from './streak';

export type ApiStatus =
  | 'ok'
  | 'sign_in_required'
  | 'rate_limited'
  | 'maze_unavailable'
  | 'day_skipped'
  | 'day_closed'
  | 'maze_changed'
  | 'invalid_moves'
  | 'invalid_length'
  | 'divergence'
  | 'already_finished'
  | 'unfinished'
  | 'not_finished'
  | 'already_shared'
  | 'flair_disabled'
  | 'error';

export interface AttemptRequest {
  readonly variant: number;
  readonly moves: string;
}

export type SavedAttempt =
  | { readonly kind: 'none' }
  | { readonly kind: 'unfinished'; readonly moves: string }
  | {
      readonly kind: 'finished';
      readonly moves: string;
      readonly cost: number;
      readonly outcome: Outcome;
      readonly trailblazer: boolean;
      readonly completedAt: number;
    };

export interface FinishResult {
  readonly cost: number;
  readonly outcome: Outcome;
  readonly par: number;
  readonly budget: number;
  readonly trailblazer: boolean;
  readonly completedAt: number;
  readonly streak: StreakValue | null;
}

export interface ApiRejection<S extends ApiStatus = ApiStatus> {
  readonly status: S;
  readonly attempt?: SavedAttempt;
}

export type AttemptRejection = ApiRejection<
  Exclude<
    ApiStatus,
    'ok' | 'not_finished' | 'already_shared' | 'flair_disabled'
  >
>;

export type ProgressResponse =
  | {
      readonly status: 'ok';
      readonly newClaim: boolean;
      readonly finished: FinishResult | null;
    }
  | AttemptRejection;

export type FinishResponse =
  { readonly status: 'ok'; readonly result: FinishResult } | AttemptRejection;

export interface StateSuccess {
  readonly status: 'ok';
  readonly day: PuzzleDay;
  readonly dayNumber: number;
  readonly variant: number;
  readonly maze: string;
  readonly par: number;
  readonly budget: number;
  readonly dayStatus: 'live' | 'closed' | 'skipped';
  readonly loggedIn: boolean;
  readonly attempt: SavedAttempt;
}

export type StateResponse =
  StateSuccess | ApiRejection<'maze_unavailable' | 'error'>;
