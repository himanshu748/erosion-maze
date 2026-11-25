import { OVERGROWN, at, type Maze } from './maze';
import { solve } from './solver';

export type ValidationRule =
  'boundary' | 'endpoints' | 'unreachable' | 'overgrown-endpoint' | 'budget';
export type Validation =
  | { readonly ok: true; readonly par: number }
  | { readonly ok: false; readonly rule: ValidationRule };

// Structural damage (wrong array sizes, unknown Cell_State values) cannot satisfy rule (a)
// in any meaningful sense, so it is reported as `boundary`, the first rule.
function wellFormed(m: Maze): boolean {
  const n = m.side;
  return (
    Number.isInteger(n) &&
    n >= 2 &&
    m.hWalls.length === (n + 1) * n &&
    m.vWalls.length === n * (n + 1) &&
    m.states.length === n * n &&
    m.states.every((s) => s <= OVERGROWN)
  );
}

function boundaryClosed(m: Maze): boolean {
  const n = m.side;
  for (let c = 0; c < n; c++) {
    if (at(m.hWalls, c) === 0 || at(m.hWalls, n * n + c) === 0) return false;
  }
  for (let r = 0; r < n; r++) {
    if (at(m.vWalls, r * (n + 1)) === 0 || at(m.vWalls, r * (n + 1) + n) === 0)
      return false;
  }
  return true;
}

const inGrid = (cell: number, cells: number): boolean =>
  Number.isInteger(cell) && cell >= 0 && cell < cells;

/** Maze_Validator: rules in the fixed order of Req 2.4; the first failure is named. */
export function validateMaze(m: Maze, budget: number): Validation {
  if (!wellFormed(m) || !boundaryClosed(m))
    return { ok: false, rule: 'boundary' };
  const cells = m.side * m.side;
  if (!inGrid(m.start, cells) || !inGrid(m.exit, cells) || m.start === m.exit) {
    return { ok: false, rule: 'endpoints' };
  }
  const s = solve(m);
  if (s.kind === 'unreachable') return { ok: false, rule: 'unreachable' };
  if (
    at(m.states, m.start) === OVERGROWN ||
    at(m.states, m.exit) === OVERGROWN
  ) {
    return { ok: false, rule: 'overgrown-endpoint' };
  }
  if (!Number.isInteger(budget) || budget < s.par)
    return { ok: false, rule: 'budget' };
  return { ok: true, par: s.par };
}
