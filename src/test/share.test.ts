import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { SHARE_GRID_MAX } from '../shared/constants';
import { formatShare, shareBands, type ShareInput } from '../shared/share';
import { runs } from './maze-fixtures';

const gridLines = (s: string): string[] =>
  s.split('\n').filter((l) => l.startsWith('>!'));

const base: ShareInput = {
  dayNumber: 42,
  outcome: 'solved',
  cost: 37,
  par: 30,
  side: 9,
  visited: [0],
  streak: 5,
};

describe('shareBands (Req 15.5)', () => {
  test('band widths from the design table', () => {
    expect(shareBands(9)).toEqual([3, 2, 2, 2]);
    expect(shareBands(11)).toEqual([3, 2, 2, 2, 2]);
    expect(shareBands(12)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(shareBands(13)).toEqual([3, 2, 2, 2, 2, 2]);
    expect(shareBands(15)).toEqual([3, 3, 3, 2, 2, 2]);
  });

  test('bands cover every Cell exactly once: at most 6 bands, each at least 2 Cells', () => {
    fc.assert(
      fc.property(fc.integer({ min: 9, max: 15 }), (side) => {
        const bands = shareBands(side);
        expect(bands.length).toBeLessThanOrEqual(SHARE_GRID_MAX);
        expect(bands.reduce((a, b) => a + b, 0)).toBe(side);
        expect(Math.min(...bands)).toBeGreaterThanOrEqual(2);
      }),
      runs(50)
    );
  });
});

describe('formatShare', () => {
  test('15.4 fixed: header, one spoiler row per band row, streak line', () => {
    expect(formatShare(base)).toBe(
      'Erosion Maze Day 42 \u00B7 solved \u00B7 cost 37 (par 30)\n\n' +
        `>!🟩⬜⬜⬜!<\n\n` +
        `>!⬜⬜⬜⬜!<\n\n`.repeat(3) +
        'Streak: 5'
    );
    expect(formatShare({ ...base, outcome: 'out-of-moves' })).toContain(
      'out of moves'
    );
  });

  test('15.5 a visited Cell lights exactly its own block', () => {
    // Side 11, bands [3,2,2,2,2]: Cell (4, 5) sits in band row 1, band column 2.
    const out = formatShare({ ...base, side: 11, visited: [4 * 11 + 5] });
    const rows = gridLines(out);
    expect(rows).toHaveLength(5);
    const want = [0, 1, 2, 3, 4].map((bi) =>
      [0, 1, 2, 3, 4].map((bj) => (bi === 1 && bj === 2 ? '🟩' : '⬜')).join('')
    );
    rows.forEach((row, bi) => {
      expect([...row].slice(2, -2).join('')).toBe(want[bi]);
    });
  });

  // Property 23: Share_Comment size bound (Req 7.7).
  test('7.7 at most 1,000 UTF-16 code units', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999 }),
        fc.constantFrom('solved' as const, 'out-of-moves' as const),
        fc.nat(9_999),
        fc.integer({ min: 1, max: 9_999 }),
        fc.integer({ min: 9, max: 15 }),
        fc.nat(99_999),
        (dayNumber, outcome, cost, par, side, streak) => {
          const visited = Array.from({ length: side * side }, (_, i) => i);
          expect(
            formatShare({
              dayNumber,
              outcome,
              cost,
              par,
              side,
              visited,
              streak,
            }).length
          ).toBeLessThanOrEqual(1_000);
        }
      ),
      runs(200)
    );
  });

  // Property 31: Share_Grid spoiler safety (Req 15.6).
  test('15.6 same touched blocks give identical grids, and exactly those blocks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 9, max: 15 }).chain((side) => {
          const b = Math.min(SHARE_GRID_MAX, Math.floor(side / 2));
          const q = Math.floor(side / b);
          const r = side % b;
          const bands = Array.from({ length: b }, (_, i) =>
            i < r ? q + 1 : q
          );
          const starts: number[] = [0];
          for (let i = 1; i < b; i++)
            starts.push(starts[i - 1]! + bands[i - 1]!);
          return fc
            .record({
              touched: fc.array(fc.boolean(), {
                minLength: b * b,
                maxLength: b * b,
              }),
              picksA: fc.array(fc.nat(99), {
                minLength: b * b,
                maxLength: b * b,
              }),
              picksB: fc.array(fc.nat(99), {
                minLength: b * b,
                maxLength: b * b,
              }),
            })
            .map((x) => ({ side, bands, starts, ...x }));
        }),
        ({ side, bands, starts, touched, picksA, picksB }) => {
          const b = bands.length;
          const cell = (block: number, pick: number): number => {
            const br = Math.floor(block / b);
            const bc = block % b;
            const dr = pick % bands[br]!;
            const dc = Math.floor(pick / bands[br]!) % bands[bc]!;
            return (starts[br]! + dr) * side + starts[bc]! + dc;
          };
          const visitedA: number[] = [];
          const visitedB: number[] = [];
          touched.forEach((t, block) => {
            if (!t) return;
            visitedA.push(cell(block, picksA[block]!));
            visitedB.push(cell(block, picksB[block]!));
          });
          const gridA = gridLines(
            formatShare({ ...base, side, visited: visitedA })
          );
          const gridB = gridLines(
            formatShare({ ...base, side, visited: visitedB })
          );
          expect(gridA).toEqual(gridB);
          gridA.forEach((row, br) => {
            expect([...row].slice(2, -2).join('')).toBe(
              touched
                .slice(br * b, br * b + b)
                .map((t) => (t ? '🟩' : '⬜'))
                .join('')
            );
          });
        }
      ),
      runs(200)
    );
  });
});
