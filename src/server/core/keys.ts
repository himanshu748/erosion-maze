import { DAY_RETENTION } from '../../shared/constants';
import { cutoffMs, MS_PER_DAY, type PuzzleDay } from '../../shared/date';

export const META = 'em:meta';
export const DAYS = 'em:days';
export const POSTS = 'em:posts';
export const JOINED = 'em:joined';

export const puzzleKey = (day: PuzzleDay, variant: number): string =>
  `${day}:${variant}`;

export const dayKey = (day: PuzzleDay): string => `em:day:${day}`;
export const stateKey = (day: PuzzleDay): string => `em:state:${day}`;
export const countersKey = (pk: string): string => `em:cnt:${pk}`;
export const attemptKey = (pk: string, userId: string): string =>
  `em:att:${pk}:${userId}`;
export const leaderboardKey = (pk: string): string => `em:lb:${pk}`;
export const statsKey = (pk: string): string => `em:stats:${pk}`;
export const costsKey = (pk: string): string => `em:costs:${pk}`;
export const fingerprintsKey = (pk: string): string => `em:fp:${pk}`;
export const shareKey = (pk: string): string => `em:share:${pk}`;
export const shareUrlKey = (pk: string): string => `em:shareurl:${pk}`;
export const shareCommentKey = (commentId: string): string =>
  `em:sharecmt:${commentId}`;
export const flairKey = (userId: string): string => `em:flair:${userId}`;
export const streakKey = (userId: string): string => `em:streak:${userId}`;
export const returnNextKey = (day: PuzzleDay): string => `em:rnd:${day}`;
export const rateKey = (userId: string, minute: number): string =>
  `em:rate:${userId}:${minute}`;
export const funnelKey = (day: PuzzleDay): string => `em:funnel:${day}`;

export const stateValue = (
  status: 'live' | 'closed' | 'skipped',
  variant: number
): string => `${status}:${variant}`;

export function parseStateValue(
  value: string | undefined
): {
  readonly status: 'live' | 'closed' | 'skipped';
  readonly variant: number;
} | null {
  const match = /^(live|closed|skipped):([0-9]+)$/.exec(value ?? '');
  if (!match) return null;
  const variant = Number(match[2]);
  if (!Number.isSafeInteger(variant)) return null;
  return { status: match[1] as 'live' | 'closed' | 'skipped', variant };
}

/** Seconds from `nowMs` to DAY_RETENTION days after the Puzzle_Day cutoff (rule R). */
export const retentionSeconds = (day: PuzzleDay, nowMs: number): number =>
  Math.ceil((cutoffMs(day) + DAY_RETENTION * MS_PER_DAY - nowMs) / 1000);
