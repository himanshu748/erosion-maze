import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { cloneMaze, closedMaze, type Maze } from '../shared/maze';
import { solve } from '../shared/solver';
import { validateMaze, type ValidationRule } from '../shared/validator';
import { bigMazeArb, openSteps, runs } from './maze-fixtures';

const RULES: readonly ValidationRule[] = [
  'boundary',
  'endpoints',
  'unreachable',
  'overgrown-endpoint',
  'budget',
];

/** Open one outer-boundary Wall chosen by `k`. */
function openOuter(m: Maze, k: number): void {
  const n = m.side;
  const slots = [
    ...Array.from({ length: n }, (_, c) => ({ h: true, i: c })),
    ...Array.from({ length: n }, (_, c) => ({ h: true, i: n * n + c })),
    ...Array.from({ length: n }, (_, r) => ({ h: false, i: r * (n + 1) })),
    ...Array.from({ length: n }, (_, r) => ({ h: false, i: r * (n + 1) + n })),
  ];
  const s = slots[k % slots.length]!;
  (s.h ? m.hWalls : m.vWalls)[s.i] = 0;
}

/** Close every interior Wall around the Exit_Cell. */
function sealExit(m: Maze): void {
  const n = m.side;
  const r = Math.floor(m.exit / n);
  const c = m.exit % n;
  m.hWalls[r * n + c] = 1;
  m.hWalls[(r + 1) * n + c] = 1;
  m.vWalls[r * (n + 1) + c] = 1;
  m.vWalls[r * (n + 1) + c + 1] = 1;
}

describe('validator', () => {
  test('2.4 rule order: the first failed rule is named, whatever else fails', () => {
    fc.assert(
      fc.property(
        bigMazeArb,
        fc.subarray([...RULES]),
        fc.nat(1000),
        fc.boolean(),
        fc.boolean(),
        (base, broken, k, exitOnStart, overgrowExit) => {
          const s = solve(base);
          if (s.kind !== 'solved') throw new Error('generated Maze unsolved');
          const m = cloneMaze(base);
          let budget = s.par;
          if (broken.includes('unreachable')) sealExit(m);
          if (broken.includes('overgrown-endpoint'))
            m.states[overgrowExit ? m.exit : m.start] = 2;
          if (broken.includes('budget')) budget = s.par - 1;
          if (broken.includes('boundary')) openOuter(m, k);
          const target: Maze = broken.includes('endpoints')
            ? { ...m, exit: exitOnStart ? m.start : m.side * m.side + (k % 3) }
            : m;
          const first = RULES.find((r) => broken.includes(r));
          const want = first
            ? { ok: false, rule: first }
            : { ok: true, par: s.par };
          expect(validateMaze(target, budget)).toEqual(want);
        }
      ),
      runs(300)
    );
  });

  test('2.4(e) the Move_Budget must be an integer of at least Par', () => {
    const m = closedMaze(2, 0, 3);
    m.hWalls[2] = 0; // open 0 -> 2
    m.vWalls[1 * 3 + 1] = 0; // open 2 -> 3
    expect(openSteps(m, 0).map((x) => x.to)).toEqual([2]);
    expect(validateMaze(m, 2)).toEqual({ ok: true, par: 2 });
    expect(validateMaze(m, 1)).toEqual({ ok: false, rule: 'budget' });
    expect(validateMaze(m, 2.5)).toEqual({ ok: false, rule: 'budget' });
    expect(validateMaze(m, Number.NaN)).toEqual({ ok: false, rule: 'budget' });
    m.states[2] = 2;
    expect(validateMaze(m, 2)).toEqual({ ok: false, rule: 'budget' });
    expect(validateMaze(m, 3)).toEqual({ ok: true, par: 3 });
  });

  test('2.4(a) structurally damaged Mazes are rejected at the first rule', () => {
    const good = closedMaze(3, 0, 8);
    expect(validateMaze({ ...good, states: new Uint8Array(8) }, 99)).toEqual({
      ok: false,
      rule: 'boundary',
    });
    expect(validateMaze({ ...good, hWalls: new Uint8Array(3) }, 99)).toEqual({
      ok: false,
      rule: 'boundary',
    });
    expect(
      validateMaze({ ...good, states: new Uint8Array(9).fill(3) }, 99)
    ).toEqual({ ok: false, rule: 'boundary' });
    expect(validateMaze({ ...good, start: -1 }, 99)).toEqual({
      ok: false,
      rule: 'endpoints',
    });
    expect(validateMaze({ ...good, start: 0.5 }, 99)).toEqual({
      ok: false,
      rule: 'endpoints',
    });
  });
});
