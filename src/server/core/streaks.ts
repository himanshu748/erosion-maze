import type { RedisClient, TxClientLike } from '@devvit/web/server';
import { redis as defaultRedis } from '@devvit/web/server';
import {
  parsePuzzleDay,
  puzzleDayFromMs,
  type PuzzleDay,
} from '../../shared/date';
import {
  computeStreak,
  type DayKind,
  type StreakValue,
} from '../../shared/streak';
import type { Clock } from './clock';
import { DAYS, streakKey } from './keys';

export async function queuePlayedDay(
  tx: TxClientLike,
  userId: string,
  day: PuzzleDay
): Promise<void> {
  await tx.hSet(streakKey(userId), { [day]: '1' });
}

const dayKind = (value: string | undefined): DayKind => {
  if (value === 'p') return 'posted';
  if (value === 's') return 'skipped';
  return 'no-post';
};

/** Null means unavailable; callers never turn that into a zero streak (Req 12.12). */
export async function readStreakWith(
  client: RedisClient,
  userId: string,
  now: Clock
): Promise<StreakValue | null> {
  try {
    const [playedHash, days] = await Promise.all([
      client.hGetAll(streakKey(userId)),
      client.hGetAll(DAYS),
    ]);
    const played: PuzzleDay[] = [];
    for (const [day, playedDay] of Object.entries(playedHash)) {
      if (playedDay !== '1') continue;
      const parsed = parsePuzzleDay(day);
      if (parsed.ok) played.push(parsed.value);
    }
    return computeStreak({
      played,
      kindOf: (d) => dayKind(days[d]),
      today: puzzleDayFromMs(now()),
    });
  } catch {
    return null;
  }
}

export const readStreak = (
  userId: string,
  now: Clock
): Promise<StreakValue | null> => readStreakWith(defaultRedis, userId, now);
