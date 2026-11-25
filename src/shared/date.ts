// Puzzle_Day arithmetic on integers only: no Date, Intl or locale (Req 1.8, 8.2, 29.3).
// Day indices use H. Hinnant's days-from-civil algorithm (days since 1970-01-01).
import { err, ok, type Result } from './result';

export type PuzzleDay = string & { readonly __puzzleDay: true };
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Monday
export type DateError = {
  readonly kind: 'invalid-puzzle-day';
  readonly input: string;
};

export const MS_PER_DAY = 86_400_000;
const PUZZLE_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const isLeap = (y: number): boolean =>
  (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

// The only place a string becomes a PuzzleDay; every caller has validated or built it.
const brand = (s: string): PuzzleDay => s as PuzzleDay;

function fields(d: PuzzleDay): readonly [number, number, number] {
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
}

export function parsePuzzleDay(s: string): Result<PuzzleDay, DateError> {
  const bad = err<DateError>({ kind: 'invalid-puzzle-day', input: s });
  if (!PUZZLE_DAY.test(s)) return bad;
  const [y, m, d] = fields(brand(s));
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return bad;
  return ok(brand(s));
}

function daysFromCivil(y0: number, m: number, d: number): number {
  const y = m <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civilFromDays(z0: number): readonly [number, number, number] {
  const z = z0 + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36_524) -
      Math.floor(doe / 146_096)) /
      365
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

export function toDayIndex(d: PuzzleDay): number {
  const [y, m, day] = fields(d);
  return daysFromCivil(y, m, day);
}

export function fromDayIndex(i: number): PuzzleDay {
  const [y, m, d] = civilFromDays(i);
  return brand(`${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`);
}

export const addDays = (d: PuzzleDay, k: number): PuzzleDay =>
  fromDayIndex(toDayIndex(d) + k);

export function weekday(d: PuzzleDay): Weekday {
  // 1970-01-01 (index 0) was a Thursday, weekday 3.
  return (((toDayIndex(d) % 7) + 7 + 3) % 7) as Weekday;
}

export const mondayOf = (d: PuzzleDay): PuzzleDay => addDays(d, -weekday(d));

export const dayNumber = (start: PuzzleDay, d: PuzzleDay): number =>
  toDayIndex(d) - toDayIndex(start) + 1;

/** 00:00:00.000 UTC of the day after `d`, in epoch milliseconds (the Erosion_Cutoff). */
export const cutoffMs = (d: PuzzleDay): number =>
  (toDayIndex(d) + 1) * MS_PER_DAY;

/** UTC calendar date of an epoch-millisecond instant; the caller supplies the clock (Req 8.2). */
export const puzzleDayFromMs = (ms: number): PuzzleDay =>
  fromDayIndex(Math.floor(ms / MS_PER_DAY));
