import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { encodeHeatmap } from '../shared/codec/heatmap';
import { encodeMaze } from '../shared/codec/maze';
import { HEAT_LEVELS } from '../shared/constants';
import type { DayStatus, VariantBuild } from '../shared/dayrecord';
import { closedMaze } from '../shared/maze';
import {
  POST_DATA_MAX_BYTES,
  buildPostData,
  parsePostData,
  type PostDataSource,
} from '../shared/postdata';
import { dayArb, gen, runs } from './maze-fixtures';

const bytes = (x: unknown): number =>
  new TextEncoder().encode(JSON.stringify(x)).length;

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const heat = (side: number, fill: number): string =>
  must(encodeHeatmap({ side, levels: new Uint8Array(side * side).fill(fill) }));

/** A walk of `steps` Moves from `start` that stays on the grid (geometry only). */
function walk(side: number, start: number, rolls: readonly number[]): number[] {
  const cells = [start];
  let c = start;
  for (const roll of rolls) {
    const r = Math.floor(c / side);
    const col = c % side;
    const opts = [
      r > 0 ? c - side : -1,
      col < side - 1 ? c + 1 : -1,
      r < side - 1 ? c + side : -1,
      col > 0 ? c - 1 : -1,
    ].filter((x) => x >= 0);
    c = opts[roll % opts.length]!;
    cells.push(c);
  }
  return cells;
}

const sourceArb: fc.Arbitrary<PostDataSource> = fc
  .record({
    d: dayArb('2026-01-01', '2099-12-31'),
    v: fc.integer({ min: 0, max: 999 }),
    side: fc.integer({ min: 9, max: 15 }),
    n: fc.integer({ min: 1, max: 99_999 }),
    budget: fc.integer({ min: 1, max: 9999 }),
    parPct: fc.integer({ min: 1, max: 100 }),
    status: fc.constantFrom<DayStatus>('live', 'closed', 'skipped'),
    seed: fc.boolean(),
    routeLen: fc.option(fc.nat(), { nil: null }),
    rolls: fc.array(fc.nat(), { minLength: 224, maxLength: 224 }),
    prevFill: fc.nat(HEAT_LEVELS - 1),
    finalFill: fc.nat(HEAT_LEVELS - 1),
    finalAnyway: fc.boolean(),
  })
  .map((x) => {
    const m = gen(x.d, x.v % 4, x.side).maze;
    const cells = x.side * x.side;
    const par = Math.max(1, Math.floor((x.budget * x.parPct) / 100));
    const build: VariantBuild = {
      maze: must(encodeMaze(m)),
      par,
      budget: x.budget,
    };
    return {
      day: x.d,
      dayNumber: x.n,
      seed: x.seed,
      status: x.status,
      active: x.v,
      builds: new Map([[x.v, build]]),
      community:
        x.routeLen === null
          ? null
          : walk(x.side, m.start, x.rolls.slice(0, x.routeLen % cells)),
      prevHeat: heat(x.side, x.prevFill),
      finalHeat:
        x.status === 'closed' || x.finalAnyway
          ? heat(x.side, x.finalFill)
          : null,
    };
  });

describe('postData', () => {
  // Property 22: postData size bound.
  test('7.6 and 20.8 size property: at most 2,048 JSON bytes', () => {
    fc.assert(
      fc.property(sourceArb, (src) => {
        expect(bytes(buildPostData(src))).toBeLessThanOrEqual(
          POST_DATA_MAX_BYTES
        );
      }),
      runs(300)
    );
  });

  test('7.6 the design worst case (15 x 15, every field longest, full-grid route) is 608 bytes', () => {
    const m = closedMaze(15, 0, 224);
    const snake: number[] = [];
    for (let r = 0; r < 15; r++)
      for (let c = 0; c < 15; c++)
        snake.push(r * 15 + (r % 2 === 0 ? c : 14 - c));
    const pd = buildPostData({
      day: '9999-12-31',
      dayNumber: 99_999,
      seed: false,
      status: 'skipped',
      active: 999,
      builds: new Map([
        [999, { maze: must(encodeMaze(m)), par: 9999, budget: 9999 }],
      ]),
      community: snake,
      prevHeat: heat(15, 7),
      finalHeat: heat(15, 7),
    });
    expect(pd.route?.length).toBe(79);
    expect(bytes(pd)).toBe(608);
  });

  test('8.8 build then parse returns every field and the decoded values', () => {
    fc.assert(
      fc.property(sourceArb, (src) => {
        const pd = buildPostData(src);
        const parsed = must(parsePostData(JSON.parse(JSON.stringify(pd))));
        expect(parsed.data).toEqual(pd);
        expect(pd.heat).toBe(src.prevHeat);
        expect(pd.finalHeat).toBe(src.finalHeat);
        expect(parsed.maze.side).toBe(parsed.heat.side);
        expect(parsed.route === null).toBe(src.community === null);
        if (src.community)
          expect(parsed.route).toHaveLength(src.community.length - 1);
        expect(parsed.finalHeat === null).toBe(src.finalHeat === null);
      }),
      runs(150)
    );
  });

  test('17.13 parsePostData rejects every malformed field without throwing', () => {
    const good = buildPostData({
      day: '2026-11-16',
      dayNumber: 1,
      seed: true,
      status: 'live',
      active: 0,
      builds: new Map([
        [
          0,
          {
            maze: must(encodeMaze(gen('2026-11-16', 0).maze)),
            par: 30,
            budget: 48,
          },
        ],
      ]),
      community: null,
      prevHeat: heat(11, 0),
      finalHeat: null,
    });
    expect(parsePostData(good).ok).toBe(true);
    const cases: [unknown, string][] = [
      [null, 'object'],
      [[good], 'object'],
      ['x', 'object'],
      [{ ...good, v: 2 }, 'v'],
      [{ ...good, day: '2026-02-30' }, 'day'],
      [{ ...good, var: -1 }, 'var'],
      [{ ...good, n: 0 }, 'n'],
      [{ ...good, budget: 1.5 }, 'budget'],
      [{ ...good, par: 49 }, 'par'],
      [{ ...good, status: 'open' }, 'status'],
      [{ ...good, seed: 'yes' }, 'seed'],
      [{ ...good, seed: 1 }, 'seed'],
      [{ ...good, maze: 'AAA' }, 'grid-size'],
      [{ ...good, heat: heat(9, 0) }, 'heat'],
      [{ ...good, finalHeat: 7 }, 'finalHeat'],
      [{ ...good, finalHeat: heat(9, 0) }, 'finalHeat'],
      [{ ...good, route: 'AAAB' }, 'moves'],
      [{ ...good, route: undefined }, 'route'],
    ];
    for (const [x, field] of cases) {
      let r: ReturnType<typeof parsePostData> | undefined;
      expect(() => {
        r = parsePostData(x);
      }).not.toThrow();
      expect(r?.ok).toBe(false);
      if (r && !r.ok) expect(r.error.field).toBe(field);
    }
  });

  test('17.13 a route that leaves the grid is rejected', () => {
    const m = gen('2026-11-16', 0).maze; // Start_Cell is a corner
    const pd = buildPostData({
      day: '2026-11-16',
      dayNumber: 1,
      seed: true,
      status: 'live',
      active: 0,
      builds: new Map([
        [0, { maze: must(encodeMaze(m)), par: 30, budget: 48 }],
      ]),
      community: null,
      prevHeat: heat(11, 0),
      finalHeat: null,
    });
    const r = m.start % 11 === 0 ? 'AAABw' : 'AAABQ'; // one Move: Left (11) or Right (01)
    expect(parsePostData({ ...pd, route: r })).toMatchObject({
      ok: false,
      error: { kind: 'postdata', field: 'route' },
    });
  });
});
