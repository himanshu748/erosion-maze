import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { GRACE_PER_WEEK } from '../shared/constants';
import {
  addDays,
  fromDayIndex,
  mondayOf,
  toDayIndex,
  weekday,
  type PuzzleDay,
} from '../shared/date';
import {
  computeStreak,
  tierOf,
  type DayKind,
  type StreakInput,
  type StreakValue,
} from '../shared/streak';
import { day, dayArb, runs } from './maze-fixtures';

interface HistDay {
  readonly kind: DayKind;
  readonly played: boolean;
}

/** 1 to 120 consecutive days mixing played, missed, skipped, skipped-after-play and no-post. */
const historyArb: fc.Arbitrary<{ start: PuzzleDay; days: HistDay[] }> =
  dayArb().chain((start) =>
    fc
      .array(
        fc
          .record({
            kind: fc.constantFrom<DayKind>('posted', 'skipped', 'no-post'),
            played: fc.boolean(),
          })
          .map(({ kind, played }) => ({
            kind,
            played: kind === 'no-post' ? false : played,
          })),
        { minLength: 1, maxLength: 120 }
      )
      .map((days) => ({ start, days }))
  );

function inputOf(
  { start, days }: { start: PuzzleDay; days: HistDay[] },
  duplicated = false
): StreakInput {
  const kinds = new Map<string, DayKind>();
  const played: PuzzleDay[] = [];
  days.forEach(({ kind, played: p }, i) => {
    const d = addDays(start, i);
    kinds.set(d, kind);
    if (p) played.push(d);
  });
  const list = duplicated ? played.flatMap((d) => [d, d, d]).reverse() : played;
  return {
    played: list,
    kindOf: (d) => kinds.get(d) ?? 'posted',
    today: addDays(start, days.length - 1),
  };
}

/** Naive day-by-day reference for Req 12.7, written independently of the Shared_Core. */
function refStreak(
  played: readonly PuzzleDay[],
  kindOf: (d: PuzzleDay) => DayKind,
  today: PuzzleDay
): StreakValue {
  const set = new Set(played.map(toDayIndex));
  const evaluation = set.has(toDayIndex(today)) ? today : addDays(today, -1);
  let current = 0;
  let best = 0;
  let graceUsed = 0;
  const bridgedDays: PuzzleDay[] = [];
  if (set.size > 0) {
    let d = fromDayIndex(Math.min(...set));
    while (toDayIndex(d) <= toDayIndex(evaluation)) {
      if (weekday(d) === 0) graceUsed = 0;
      if (set.has(toDayIndex(d))) {
        current += 1;
        if (current > best) best = current;
      } else if (kindOf(d) === 'posted' && current > 0) {
        if (graceUsed < GRACE_PER_WEEK) {
          graceUsed += 1;
          bridgedDays.push(d);
        } else {
          current = 0;
        }
      }
      d = addDays(d, 1);
    }
  }
  const week = mondayOf(today);
  const bridged = bridgedDays.filter((b) => mondayOf(b) === week).length;
  return { current, best, graceLeft: GRACE_PER_WEEK - bridged };
}

const MONDAY = mondayOf(day('2026-11-16'));

describe('Streak_Calculator', () => {
  test('12.4 no played days: 0, 0 and full grace', () => {
    expect(
      computeStreak({
        played: [],
        kindOf: () => 'posted',
        today: day('2026-11-20'),
      })
    ).toEqual({ current: 0, best: 0, graceLeft: GRACE_PER_WEEK });
  });

  test('12.3 an unplayed today neither adds to nor resets the streak', () => {
    const played = [MONDAY, addDays(MONDAY, 1)];
    expect(
      computeStreak({
        played,
        kindOf: () => 'posted',
        today: addDays(MONDAY, 2),
      })
    ).toEqual({ current: 2, best: 2, graceLeft: GRACE_PER_WEEK });
  });

  test('12.2 and 12.8 worked example across a Week_Cycle boundary', () => {
    const at = (k: number): PuzzleDay => addDays(MONDAY, k);
    // Mon play, Tue play, Wed missed (bridged), Thu play, Fri skipped, Sat missed (reset),
    // Sun play, Mon2 play, Tue2 missed (bridged), Wed2 play, Thu2 missed (reset), Fri2 play.
    const played = [0, 1, 3, 6, 7, 9, 11].map(at);
    const kindOf = (d: PuzzleDay): DayKind =>
      d === at(4) ? 'skipped' : 'posted';
    const run = (today: PuzzleDay) => computeStreak({ played, kindOf, today });
    expect(run(at(3))).toEqual({ current: 3, best: 3, graceLeft: 0 });
    // Sunday shares Monday's Week_Cycle, so Wednesday's bridge still counts.
    expect(run(at(6))).toEqual({ current: 1, best: 3, graceLeft: 0 });
    expect(run(at(7))).toEqual({ current: 2, best: 3, graceLeft: 1 });
    expect(run(at(9))).toEqual({ current: 3, best: 3, graceLeft: 0 });
    expect(run(at(11))).toEqual({ current: 1, best: 3, graceLeft: 0 });
  });

  test('12.2 a missed day at streak 0 uses no grace', () => {
    expect(
      computeStreak({
        played: [addDays(MONDAY, 1)],
        kindOf: () => 'posted',
        today: addDays(MONDAY, 2),
      })
    ).toEqual({ current: 1, best: 1, graceLeft: GRACE_PER_WEEK });
  });

  test('12.10 skipped-without-play and no-post days are neutral', () => {
    const at = (k: number): PuzzleDay => addDays(MONDAY, k);
    const kindOf = (d: PuzzleDay): DayKind =>
      d === at(1) ? 'skipped' : d === at(2) ? 'no-post' : 'posted';
    expect(
      computeStreak({ played: [at(0), at(3)], kindOf, today: at(3) })
    ).toEqual({ current: 2, best: 2, graceLeft: GRACE_PER_WEEK });
  });

  test('12.1 a day skipped after the finish still counts as played', () => {
    const played = [0, 1, 2].map((k) => addDays(MONDAY, k));
    const kindOf = (d: PuzzleDay): DayKind =>
      d === played[1] ? 'skipped' : 'posted';
    expect(computeStreak({ played, kindOf, today: played[2]! })).toMatchObject({
      current: 3,
    });
  });

  test('13.3 tier thresholds at 0, 2, 3, 6, 7, 29 and 30', () => {
    expect(tierOf(0)).toBeNull();
    expect(tierOf(2)).toBeNull();
    expect(tierOf(3)).toBe('Wanderer');
    expect(tierOf(6)).toBe('Wanderer');
    expect(tierOf(7)).toBe('Pathfinder');
    expect(tierOf(29)).toBe('Pathfinder');
    expect(tierOf(30)).toBe('Cartographer');
    expect(tierOf(99_999)).toBe('Cartographer');
  });

  // Property 29: Streak recording idempotence (Req 12.6).
  test('12.6 recording a played day more than once changes nothing', () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        expect(computeStreak(inputOf(h, true))).toEqual(
          computeStreak(inputOf(h))
        );
      }),
      runs(200)
    );
  });

  // Property 30: Streak_Calculator matches the naive reference (Req 12.7).
  test('12.7 matches the naive day-by-day reference', () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        const input = inputOf(h);
        expect(computeStreak(input)).toEqual(
          refStreak(input.played, input.kindOf, input.today)
        );
      }),
      runs(300)
    );
  });
});
