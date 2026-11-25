import { OVERGROWN_COST } from './constants';

export type CellState = 0 | 1 | 2; // Normal, Worn, Overgrown
export const NORMAL = 0;
export const WORN = 1;
export const OVERGROWN = 2;

export type Move = 0 | 1 | 2 | 3; // Up, Right, Down, Left
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export const MOVES = [UP, RIGHT, DOWN, LEFT] as const;

/**
 * Wall layout: `hWalls[r * side + c]` is the Wall above row r, column c (r = 0..side);
 * `vWalls[r * (side + 1) + c]` is the Wall left of column c, row r (c = 0..side).
 * Non-zero means the Wall is present. Cells are row-major: `r * side + c`.
 */
export interface Maze {
  readonly side: number;
  readonly hWalls: Uint8Array;
  readonly vWalls: Uint8Array;
  readonly start: number;
  readonly exit: number;
  readonly states: Uint8Array;
}

export const at = (a: Uint8Array, i: number): number => a[i] ?? 0;

/** The array and index holding the Wall crossed by moving `mv` from `cell`. */
export function wallSlot(
  side: number,
  cell: number,
  mv: Move
): { readonly h: boolean; readonly i: number } {
  const r = Math.floor(cell / side);
  const c = cell - r * side;
  switch (mv) {
    case UP:
      return { h: true, i: r * side + c };
    case DOWN:
      return { h: true, i: (r + 1) * side + c };
    case LEFT:
      return { h: false, i: r * (side + 1) + c };
    case RIGHT:
      return { h: false, i: r * (side + 1) + c + 1 };
  }
}

function step(side: number, cell: number, mv: Move): number | null {
  const r = Math.floor(cell / side);
  const c = cell - r * side;
  if (mv === UP) return r > 0 ? cell - side : null;
  if (mv === DOWN) return r < side - 1 ? cell + side : null;
  if (mv === LEFT) return c > 0 ? cell - 1 : null;
  return c < side - 1 ? cell + 1 : null;
}

export function hasWall(m: Maze, cell: number, mv: Move): boolean {
  const s = wallSlot(m.side, cell, mv);
  return at(s.h ? m.hWalls : m.vWalls, s.i) !== 0;
}

/** The Cell reached by `mv`, or null when a Wall or the grid edge blocks it. */
export function neighbour(m: Maze, cell: number, mv: Move): number | null {
  const next = step(m.side, cell, mv);
  if (next === null || hasWall(m, cell, mv)) return null;
  return next;
}

/** Adjacent Cell in direction `mv` ignoring Walls, or null off the grid. */
export const adjacent = (side: number, cell: number, mv: Move): number | null =>
  step(side, cell, mv);

export function setWall(
  m: Maze,
  cell: number,
  mv: Move,
  present: boolean
): void {
  const s = wallSlot(m.side, cell, mv);
  (s.h ? m.hWalls : m.vWalls)[s.i] = present ? 1 : 0;
}

export const moveCost = (m: Maze, cell: number): 1 | typeof OVERGROWN_COST =>
  at(m.states, cell) === OVERGROWN ? OVERGROWN_COST : 1;

/** Every Wall present (outer boundary closed), every Cell Normal. */
export function closedMaze(side: number, start: number, exit: number): Maze {
  return {
    side,
    hWalls: new Uint8Array((side + 1) * side).fill(1),
    vWalls: new Uint8Array(side * (side + 1)).fill(1),
    start,
    exit,
    states: new Uint8Array(side * side),
  };
}

export const cloneMaze = (m: Maze): Maze => ({
  side: m.side,
  hWalls: m.hWalls.slice(),
  vWalls: m.vWalls.slice(),
  start: m.start,
  exit: m.exit,
  states: m.states.slice(),
});

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => (v !== 0) === (at(b, i) !== 0));

/** Req 1.2 equality: same GRID_SIZE, Wall set, endpoints and Cell_States. */
export function mazeEquals(a: Maze, b: Maze): boolean {
  return (
    a.side === b.side &&
    a.start === b.start &&
    a.exit === b.exit &&
    bytesEqual(a.hWalls, b.hWalls) &&
    bytesEqual(a.vWalls, b.vWalls) &&
    a.states.length === b.states.length &&
    a.states.every((v, i) => v === at(b.states, i))
  );
}
