import { GRID_SIDE } from './constants';
import { parsePuzzleDay, type DateError, type PuzzleDay } from './date';
import {
  DOWN,
  MOVES,
  RIGHT,
  adjacent,
  at,
  closedMaze,
  setWall,
  type Maze,
} from './maze';
import { rngFor, shuffled, type Rng } from './prng';
import { err, ok, type Result } from './result';
import { solve } from './solver';

export type GenerateError =
  DateError | { readonly kind: 'invalid-variant'; readonly input: number };

export interface Generated {
  readonly maze: Maze;
  readonly par: number;
  /** Attempt that produced the Maze, or -1 for the serpentine fallback. */
  readonly attempt: number;
}

export const GENERATOR_ATTEMPTS = 32;

function corners(
  side: number,
  rng: Rng
): readonly [start: number, exit: number] {
  const last = side * side - 1;
  const pair: readonly [number, number] =
    rng.nextInt(2) === 0 ? [0, last] : [side - 1, last - (side - 1)];
  return rng.nextInt(2) === 0 ? pair : [pair[1], pair[0]];
}

/** Recursive backtracker (iterative): a spanning tree, so every Cell is reachable (Req 1.4). */
function carve(m: Maze, rng: Rng): void {
  const visited = new Uint8Array(m.side * m.side);
  const stack = [m.start];
  visited[m.start] = 1;
  while (stack.length > 0) {
    const cell = stack[stack.length - 1] ?? 0;
    const options: { cell: number; mv: (typeof MOVES)[number] }[] = [];
    for (const mv of MOVES) {
      const next = adjacent(m.side, cell, mv);
      if (next !== null && at(visited, next) === 0)
        options.push({ cell: next, mv });
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const pick = options[rng.nextInt(options.length)];
    if (!pick) continue;
    setWall(m, cell, pick.mv, false);
    visited[pick.cell] = 1;
    stack.push(pick.cell);
  }
}

/**
 * Interior Walls in ascending edge index: horizontal Walls by `hWalls` index, then vertical
 * Walls by `vWalls` index offset by `hWalls.length`.
 */
function interiorWalls(
  m: Maze
): { readonly cell: number; readonly mv: typeof DOWN | typeof RIGHT }[] {
  const n = m.side;
  const out: { cell: number; mv: typeof DOWN | typeof RIGHT }[] = [];
  for (let r = 1; r < n; r++) {
    for (let c = 0; c < n; c++)
      if (at(m.hWalls, r * n + c) !== 0)
        out.push({ cell: (r - 1) * n + c, mv: DOWN });
  }
  for (let r = 0; r < n; r++) {
    for (let c = 1; c < n; c++) {
      if (at(m.vWalls, r * (n + 1) + c) !== 0)
        out.push({ cell: r * n + c - 1, mv: RIGHT });
    }
  }
  return out;
}

/** Remove floor(n*n/10) random interior Walls so routes can differ. */
function braid(m: Maze, rng: Rng): void {
  const walls = interiorWalls(m);
  const order = shuffled(walls.length, rng);
  const k = Math.min(walls.length, Math.floor((m.side * m.side) / 10));
  for (let i = 0; i < k; i++) {
    const w = walls[order[i] ?? 0];
    if (w) setWall(m, w.cell, w.mv, false);
  }
}

/** Rows joined alternately at the right and left ends; used only if every attempt fails. */
export function serpentine(side: number, start: number, exit: number): Maze {
  const m = closedMaze(side, start, exit);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side - 1; c++) setWall(m, r * side + c, RIGHT, false);
    if (r < side - 1)
      setWall(m, r * side + (r % 2 === 0 ? side - 1 : 0), DOWN, false);
  }
  return m;
}

function build(day: PuzzleDay, variant: number, side: number): Generated {
  const minPar = 2 * side;
  for (let attempt = 0; attempt < GENERATOR_ATTEMPTS; attempt++) {
    const [start, exit] = corners(
      side,
      rngFor(day, variant, `corners:${attempt}`)
    );
    const m = closedMaze(side, start, exit);
    carve(m, rngFor(day, variant, `carve:${attempt}`));
    braid(m, rngFor(day, variant, `braid:${attempt}`));
    const s = solve(m);
    if (s.kind === 'solved' && s.par >= minPar)
      return { maze: m, par: s.par, attempt };
  }
  const [start, exit] = corners(side, rngFor(day, variant, 'corners:0'));
  const m = serpentine(side, start, exit);
  const s = solve(m);
  return { maze: m, par: s.kind === 'solved' ? s.par : 0, attempt: -1 };
}

/** Maze_Generator with an explicit side length (9 to 15); `generate` uses GRID_SIZE. */
export function generateDetailed(
  dateUTC: string,
  variant: number,
  side: number = GRID_SIDE
): Result<Generated, GenerateError> {
  const day = parsePuzzleDay(dateUTC);
  if (!day.ok) return day;
  if (!Number.isSafeInteger(variant) || variant < 0)
    return err({ kind: 'invalid-variant', input: variant });
  return ok(build(day.value, variant, side));
}

export function generate(
  dateUTC: string,
  variant: number
): Result<Maze, GenerateError> {
  const g = generateDetailed(dateUTC, variant);
  return g.ok ? ok(g.value.maze) : g;
}
