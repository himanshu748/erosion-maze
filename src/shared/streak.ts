// Streak_Calculator (Req 12.1 to 12.4, 12.6, 12.8, 12.10) and Streak_Tier mapping (Req 13.3).
import { FLAIR_TIERS, GRACE_PER_WEEK } from './constants';
import { fromDayIndex, mondayOf, toDayIndex, type PuzzleDay } from './date';

export type DayKind = 'posted' | 'skipped' | 'no-post';

export interface StreakInput {
  /** Any order, duplicates allowed (Req 12.6). */
  readonly played: readonly PuzzleDay[];
  /** Day status from the days index. */
  readonly kindOf: (d: PuzzleDay) => DayKind;
  readonly today: PuzzleDay;
}

export interface StreakValue {
  readonly current: number;
  readonly best: number;
  readonly graceLeft: number;
}

const weekIndex = (d: PuzzleDay): number => toDayIndex(mondayOf(d));

export function computeStreak(i: StreakInput): StreakValue {
  const played = new Set<number>();
  for (const d of i.played) played.add(toDayIndex(d));
  const today = toDayIndex(i.today);
  // The evaluation day is today when it is played, else today - 1 (Req 12.3).
  const evaluation = played.has(today) ? today : today - 1;
  const todayWeek = weekIndex(i.today);
  let current = 0;
  let best = 0;
  let bridged = 0;
  let week = -1;
  let bridgedThisWeek = 0;
  if (played.size > 0) {
    const first = Math.min(...played);
    for (let idx = first; idx <= evaluation; idx++) {
      const d = fromDayIndex(idx);
      const w = weekIndex(d);
      if (w !== week) {
        week = w;
        bridged = 0; // unused grace never carries into the next Week_Cycle (Req 12.2)
      }
      if (played.has(idx)) {
        current++;
        if (current > best) best = current;
        continue;
      }
      // Skipped-without-play and no-post days are neutral (Req 12.10).
      if (i.kindOf(d) !== 'posted') continue;
      if (current === 0) continue; // a missed day at 0 changes nothing (Req 12.2)
      if (bridged < GRACE_PER_WEEK) {
        bridged++;
        if (w === todayWeek) bridgedThisWeek++;
      } else {
        current = 0;
      }
    }
  }
  return { current, best, graceLeft: GRACE_PER_WEEK - bridgedThisWeek };
}

/** Highest Streak_Tier whose threshold is at most `current`; null below Wanderer (Req 13.3). */
export function tierOf(
  current: number
): 'Wanderer' | 'Pathfinder' | 'Cartographer' | null {
  let out: 'Wanderer' | 'Pathfinder' | 'Cartographer' | null = null;
  for (const t of FLAIR_TIERS) if (current >= t.min) out = t.name;
  return out;
}
