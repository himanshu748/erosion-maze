import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { ALPHABET } from '../shared/codec/alphabet';
import {
  decodeHeatmap,
  encodeHeatmap,
  encodedHeatmapLength,
  type Heatmap,
} from '../shared/codec/heatmap';
import {
  decodeMaze,
  encodeMaze,
  encodedMazeLength,
} from '../shared/codec/maze';
import { decodeMoves, encodeMoves } from '../shared/codec/moves';
import { HEAT_LEVELS } from '../shared/constants';
import { closedMaze, mazeEquals, type Maze, type Move } from '../shared/maze';
import { HEATMAP_V1, MAZE_V1 } from './fixtures/codec-v1';
import { interiorSlots, runs } from './maze-fixtures';

const inAlphabet = (s: string): boolean =>
  [...s].every((ch) => ALPHABET.includes(ch));

/** Any Maze at 9 x 9 to 15 x 15: closed boundary, any interior Walls, distinct endpoints, any states. */
const anyMazeArb: fc.Arbitrary<Maze> = fc
  .integer({ min: 9, max: 15 })
  .chain((side) => {
    const cells = side * side;
    const slots = interiorSlots(side);
    return fc
      .record({
        walls: fc.array(fc.boolean(), {
          minLength: slots.length,
          maxLength: slots.length,
        }),
        states: fc.array(fc.constantFrom(0, 1, 2), {
          minLength: cells,
          maxLength: cells,
        }),
        start: fc.nat(cells - 1),
        offset: fc.integer({ min: 1, max: cells - 1 }),
      })
      .map(({ walls, states, start, offset }) => {
        const m = closedMaze(side, start, (start + offset) % cells);
        slots.forEach((s, k) => {
          (s.h ? m.hWalls : m.vWalls)[s.i] = walls[k] ? 1 : 0;
        });
        m.states.set(states);
        return m;
      });
  });

const heatmapArb: fc.Arbitrary<Heatmap> = fc
  .integer({ min: 9, max: 15 })
  .chain((side) =>
    fc
      .oneof(
        fc.array(fc.nat(HEAT_LEVELS - 1), {
          minLength: side * side,
          maxLength: side * side,
        }),
        fc.constant(new Array<number>(side * side).fill(0)),
        fc.constant(new Array<number>(side * side).fill(HEAT_LEVELS - 1))
      )
      .map((levels) => ({ side, levels: Uint8Array.from(levels) }))
  );

describe('Maze_Codec', () => {
  // Property 18: Maze_Codec round trip.
  test('7.1 and 7.2 round-trip property at 9 x 9 to 15 x 15', () => {
    fc.assert(
      fc.property(anyMazeArb, (m) => {
        const e = encodeMaze(m);
        if (!e.ok) throw new Error(e.error.detail);
        expect(inAlphabet(e.value)).toBe(true);
        expect(e.value.length).toBe(encodedMazeLength(m.side));
        const d = decodeMaze(e.value);
        if (!d.ok) throw new Error(d.error.detail);
        expect(mazeEquals(d.value, m)).toBe(true);
        expect(encodeMaze(d.value)).toEqual({ ok: true, value: e.value });
      }),
      runs(200)
    );
    expect(encodedMazeLength(11)).toBe(82);
    expect(encodedMazeLength(15)).toBe(150);
  });

  test('7.5 malformed Maze strings name the failing field', () => {
    const base = MAZE_V1[0]!.encoded;
    const at = (i: number, ch: string) =>
      base.slice(0, i) + ch + base.slice(i + 1);
    const field = (s: string) => {
      const r = decodeMaze(s);
      return r.ok ? 'ok' : r.error.field;
    };
    expect(field(base)).toBe('ok');
    expect(field('')).toBe('grid-size');
    expect(field(at(0, 'B'))).toBe('grid-size');
    expect(field(at(1, 'H'))).toBe('grid-size'); // side 16
    expect(field(at(1, '='))).toBe('grid-size');
    expect(field(base + 'A')).toBe('grid-size');
    expect(field(base.slice(0, -1))).toBe('grid-size');
    expect(field(at(2, '='))).toBe('start');
    expect(field(at(3, '='))).toBe('start'); // bits 6..11 begin inside the Start_Cell field
    expect(field(at(4, '='))).toBe('exit');
    expect(field(at(10, '='))).toBe('walls');
    expect(field(at(40, '='))).toBe('cell-states');
    expect(field(at(2, '_'))).toBe('start'); // start 111111.. >= 81
    expect(field('AAAAA' + base.slice(5))).toBe('exit'); // start 0, exit 0
    expect(field(base.slice(0, 30) + '_' + base.slice(31))).toBe('cell-states'); // state 3
    expect(field(base.slice(0, -1) + 'B')).toBe('cell-states'); // nonzero padding

    // Side 16 at its own exact length, otherwise valid (start 0, exit 1).
    const side16 = 'AHAA' + ALPHABET[4] + 'A'.repeat(encodedMazeLength(16) - 5);
    expect(field(side16)).toBe('grid-size');
    // Start_Cell exactly 81 on a 9 x 9 grid: 17 = 000100|01, 81 = 010100|01.
    const s17 = encodeMaze(closedMaze(9, 17, 80));
    if (!s17.ok) throw new Error(s17.error.detail);
    expect(s17.value[2]).toBe(ALPHABET[4]);
    expect(
      field(s17.value.slice(0, 2) + ALPHABET[20] + s17.value.slice(3))
    ).toBe('start');
  });

  test('7.2 encodeMaze refuses Mazes outside the format', () => {
    const m = closedMaze(9, 0, 80);
    expect(encodeMaze({ ...m, side: 8 })).toMatchObject({
      ok: false,
      error: { field: 'grid-size' },
    });
    // One gap in each side of the outer boundary: top, bottom, left, right.
    for (const [h, i] of [
      [true, 4],
      [true, 81 + 4],
      [false, 4 * 10],
      [false, 4 * 10 + 9],
    ] as const) {
      const open = closedMaze(9, 0, 80);
      (h ? open.hWalls : open.vWalls)[i] = 0;
      expect(encodeMaze(open)).toMatchObject({
        ok: false,
        error: { field: 'walls' },
      });
    }
    expect(encodeMaze({ ...m, exit: 0 })).toMatchObject({
      ok: false,
      error: { field: 'exit' },
    });
    expect(encodeMaze({ ...m, start: 81 })).toMatchObject({
      ok: false,
      error: { field: 'start' },
    });
    const bad = closedMaze(9, 0, 80);
    bad.states[3] = 3;
    expect(encodeMaze(bad)).toMatchObject({
      ok: false,
      error: { field: 'cell-states' },
    });
  });
});

describe('Heatmap_Codec', () => {
  // Property 20: Heatmap_Codec round trip.
  test('7.4 round-trip property, all-zero and all-maximum included', () => {
    fc.assert(
      fc.property(heatmapArb, (h) => {
        const e = encodeHeatmap(h);
        if (!e.ok) throw new Error(e.error.detail);
        expect(inAlphabet(e.value)).toBe(true);
        expect(e.value.length).toBe(encodedHeatmapLength(h.side));
        expect(decodeHeatmap(e.value)).toEqual({ ok: true, value: h });
        expect(encodeHeatmap(h)).toEqual(e);
      }),
      runs(200)
    );
    expect(encodedHeatmapLength(11)).toBe(63);
    expect(encodedHeatmapLength(15)).toBe(115);
  });

  test('7.5 malformed Heatmap strings name the failing field', () => {
    const base = HEATMAP_V1[0]!.encoded;
    const field = (s: string) => {
      const r = decodeHeatmap(s);
      return r.ok ? 'ok' : r.error.field;
    };
    expect(field(base)).toBe('ok');
    expect(field('X' + base.slice(1))).toBe('grid-size');
    expect(field(base.slice(0, -1))).toBe('grid-size');
    expect(field(base.slice(0, 5) + '!' + base.slice(6))).toBe(
      'heatmap-levels'
    );
    expect(field(base.slice(0, -1) + 'B')).toBe('heatmap-levels'); // nonzero padding
    expect(
      encodeHeatmap({ side: 9, levels: new Uint8Array(81).fill(8) })
    ).toMatchObject({
      ok: false,
      error: { field: 'heatmap-levels' },
    });
  });
});

describe('codec fixtures and robustness', () => {
  test('7.9 version-1 Maze and Heatmap fixtures decode to their recorded values', () => {
    for (const f of MAZE_V1) {
      const want = closedMaze(f.side, f.start, f.exit);
      for (const i of f.openH) want.hWalls[i] = 0;
      for (const i of f.openV) want.vWalls[i] = 0;
      for (const [cell, st] of Object.entries(f.states))
        want.states[Number(cell)] = st;
      const got = decodeMaze(f.encoded);
      if (!got.ok) throw new Error(`${f.encoded}: ${got.error.detail}`);
      expect(mazeEquals(got.value, want)).toBe(true);
      expect(encodeMaze(want)).toEqual({ ok: true, value: f.encoded });
    }
    for (const f of HEATMAP_V1) {
      const levels = new Uint8Array(f.side * f.side).fill(f.fill ?? 0);
      for (const [cell, l] of Object.entries(f.levels))
        levels[Number(cell)] = l;
      expect(decodeHeatmap(f.encoded)).toEqual({
        ok: true,
        value: { side: f.side, levels },
      });
    }
  });

  // Property 21: Codec robustness, all three decoders.
  test('7.8 robustness property: decoders return a value or a CodecError and never throw', () => {
    const valid = fc.oneof(
      anyMazeArb.map((m) => {
        const e = encodeMaze(m);
        return e.ok ? e.value : '';
      }),
      heatmapArb.map((h) => {
        const e = encodeHeatmap(h);
        return e.ok ? e.value : '';
      }),
      fc
        .array(fc.constantFrom<Move>(0, 1, 2, 3), { maxLength: 400 })
        .map(encodeMoves)
    );
    const input = fc.oneof(
      fc.string({ maxLength: 4096, unit: 'binary' }),
      fc.tuple(valid, fc.nat()).map(([s, i]) => s.slice(0, i % (s.length + 1))),
      fc
        .tuple(
          valid,
          fc.nat(),
          fc.string({ minLength: 1, maxLength: 1, unit: 'binary' })
        )
        .map(([s, i, ch]) => {
          const k = i % Math.max(1, s.length);
          return s.slice(0, k) + ch + s.slice(k + 1);
        })
    );
    fc.assert(
      fc.property(input, (s) => {
        for (const decode of [
          decodeMaze,
          decodeHeatmap,
          decodeMoves,
        ] as const) {
          let r: { ok: boolean; error?: unknown } | undefined;
          expect(() => {
            r = decode(s);
          }).not.toThrow();
          if (r && !r.ok) expect(r.error).toMatchObject({ kind: 'codec' });
        }
      }),
      runs(500)
    );
  });
});
