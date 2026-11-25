import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  addDays,
  cutoffMs,
  dayNumber,
  fromDayIndex,
  mondayOf,
  parsePuzzleDay,
  puzzleDayFromMs,
  toDayIndex,
  weekday,
  type PuzzleDay,
} from '../shared/date';

const day = (s: string): PuzzleDay => {
  const r = parsePuzzleDay(s);
  if (!r.ok) throw new Error(`test fixture ${s} is invalid`);
  return r.value;
};

// Independent oracle: the JavaScript Date object in UTC (allowed in tests, not in src/shared).
const MS = 86_400_000;
const isoOfIndex = (i: number): string =>
  new Date(i * MS).toISOString().slice(0, 10);
const MIN_INDEX = Date.parse('0001-01-01T00:00:00Z') / MS;
const MAX_INDEX = Date.parse('9999-12-31T00:00:00Z') / MS;
const runs = { numRuns: 1000, seed: Number(process.env.FC_SEED ?? 20261120) };

describe('parsePuzzleDay', () => {
  test.each([
    '2026-02-28',
    '2024-02-29',
    '2000-02-29',
    '0001-01-01',
    '9999-12-31',
    '2026-11-20',
  ])('1.8 accepts %s', (s) => {
    expect(parsePuzzleDay(s)).toEqual({ ok: true, value: s });
  });

  test.each([
    '2026-02-30',
    '2026-2-3',
    '2026-02-03 ',
    ' 2026-02-03',
    '1900-02-29',
    '2023-02-29',
    '0000-01-01',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-04-31',
    '2026/02/03',
    '20260203',
    '',
    '2026-02-03T00:00:00Z',
  ])('1.8 rejects %j with a typed error naming the input', (s) => {
    expect(parsePuzzleDay(s)).toEqual({
      ok: false,
      error: { kind: 'invalid-puzzle-day', input: s },
    });
  });

  test('1.8 parse agrees with the Date oracle for every real date', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_INDEX, max: MAX_INDEX }), (i) => {
        const iso = isoOfIndex(i);
        expect(parsePuzzleDay(iso)).toEqual({ ok: true, value: iso });
      }),
      runs
    );
  });
});

describe('day arithmetic', () => {
  test('8.2 day index round-trips and matches the Date oracle over years 0001 to 9999', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_INDEX, max: MAX_INDEX }), (i) => {
        const d = fromDayIndex(i);
        expect(d).toBe(isoOfIndex(i));
        expect(toDayIndex(d)).toBe(i);
      }),
      runs
    );
  });

  test('worked examples', () => {
    expect(toDayIndex(day('1970-01-01'))).toBe(0);
    expect(fromDayIndex(-1)).toBe('1969-12-31');
    expect(addDays(day('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(day('2026-12-31'), 1)).toBe('2027-01-01');
    expect(dayNumber(day('2026-11-16'), day('2026-11-16'))).toBe(1);
    expect(dayNumber(day('2026-11-16'), day('2026-11-22'))).toBe(7);
  });

  test('weekday is 0 for Monday and matches the Date oracle', () => {
    expect(weekday(day('2026-11-16'))).toBe(0); // a Monday
    expect(weekday(day('2026-11-22'))).toBe(6); // a Sunday
    expect(weekday(day('1970-01-01'))).toBe(3); // a Thursday
    fc.assert(
      fc.property(fc.integer({ min: MIN_INDEX, max: MAX_INDEX }), (i) => {
        const expected = (new Date(i * MS).getUTCDay() + 6) % 7;
        const d = fromDayIndex(i);
        expect(weekday(d)).toBe(expected);
        expect(weekday(mondayOf(d))).toBe(0);
        expect(toDayIndex(d) - toDayIndex(mondayOf(d))).toBe(expected);
      }),
      runs
    );
  });
});

describe('cutoff and clock mapping', () => {
  test('cutoffMs is 00:00:00.000 UTC of the next day', () => {
    expect(cutoffMs(day('2026-11-20'))).toBe(
      Date.parse('2026-11-21T00:00:00.000Z')
    );
    expect(cutoffMs(day('2026-12-31'))).toBe(
      Date.parse('2027-01-01T00:00:00.000Z')
    );
  });

  test('8.2 23:59:59.999 UTC maps to that date and 00:00:00.000 UTC to the next', () => {
    expect(puzzleDayFromMs(Date.parse('2026-11-20T23:59:59.999Z'))).toBe(
      '2026-11-20'
    );
    expect(puzzleDayFromMs(Date.parse('2026-11-21T00:00:00.000Z'))).toBe(
      '2026-11-21'
    );
    expect(puzzleDayFromMs(Date.parse('1969-12-31T23:59:59.999Z'))).toBe(
      '1969-12-31'
    );
    expect(puzzleDayFromMs(Date.parse('2028-02-29T12:00:00.000Z'))).toBe(
      '2028-02-29'
    );
  });

  test('8.2 puzzleDayFromMs matches the UTC Date oracle for any instant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Date.parse('2100-01-01T00:00:00Z') }),
        (ms) => {
          expect(puzzleDayFromMs(ms)).toBe(
            new Date(ms).toISOString().slice(0, 10)
          );
          expect(cutoffMs(puzzleDayFromMs(ms))).toBeGreaterThan(ms);
          expect(cutoffMs(puzzleDayFromMs(ms)) - ms).toBeLessThanOrEqual(MS);
        }
      ),
      runs
    );
  });
});
