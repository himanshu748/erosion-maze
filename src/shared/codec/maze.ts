// Maze_Codec, version 1: `A`, a side character (side - 9), then MSB-first bits: Start_Cell (8),
// Exit_Cell (8), interior horizontal Walls row-major, interior vertical Walls row-major (1 = Wall),
// Cell_States (2 bits each). The outer boundary is always closed, so it is not stored.
import type { Maze } from '../maze';
import { err, ok, type Result } from '../result';
import {
  ALPHABET,
  BitReader,
  BitWriter,
  VERSION_1,
  charValue,
  codecError,
  firstBadChar,
  type CodecError,
  type CodecField,
} from './alphabet';

export const MIN_SIDE = 9;
export const MAX_SIDE = 15;

const wallBits = (side: number): number => 2 * side * (side - 1);

export const encodedMazeLength = (side: number): number =>
  2 + Math.ceil((16 + wallBits(side) + 2 * side * side) / 6);

function boundaryClosed(m: Maze): boolean {
  const n = m.side;
  for (let i = 0; i < n; i++) {
    if (
      !m.hWalls[i] ||
      !m.hWalls[n * n + i] ||
      !m.vWalls[i * (n + 1)] ||
      !m.vWalls[i * (n + 1) + n]
    ) {
      return false;
    }
  }
  return true;
}

export function encodeMaze(m: Maze): Result<string, CodecError> {
  const n = m.side;
  const cells = n * n;
  if (
    !Number.isInteger(n) ||
    n < MIN_SIDE ||
    n > MAX_SIDE ||
    m.hWalls.length !== (n + 1) * n ||
    m.vWalls.length !== n * (n + 1) ||
    m.states.length !== cells
  ) {
    return err(codecError('grid-size', 'side or array sizes out of range'));
  }
  if (!boundaryClosed(m))
    return err(codecError('walls', 'outer boundary open'));
  if (!Number.isInteger(m.start) || m.start < 0 || m.start >= cells) {
    return err(codecError('start', 'outside the grid'));
  }
  if (
    !Number.isInteger(m.exit) ||
    m.exit < 0 ||
    m.exit >= cells ||
    m.exit === m.start
  ) {
    return err(
      codecError('exit', 'outside the grid or equal to the Start_Cell')
    );
  }
  if (m.states.some((s) => s > 2)) {
    return err(codecError('cell-states', 'unknown Cell_State'));
  }
  const w = new BitWriter();
  w.write(m.start, 8);
  w.write(m.exit, 8);
  for (let r = 1; r < n; r++) {
    for (let c = 0; c < n; c++) w.write(m.hWalls[r * n + c] ? 1 : 0, 1);
  }
  for (let r = 0; r < n; r++) {
    for (let c = 1; c < n; c++) w.write(m.vWalls[r * (n + 1) + c] ? 1 : 0, 1);
  }
  for (const s of m.states) w.write(s, 2);
  return ok(VERSION_1 + (ALPHABET[n - MIN_SIDE] ?? '') + w.finish());
}

/** The field whose bits start the character at string index `i` (i >= 2). */
function fieldAt(side: number, i: number): CodecField {
  const bit = (i - 2) * 6;
  if (bit < 8) return 'start';
  if (bit < 16) return 'exit';
  if (bit < 16 + wallBits(side)) return 'walls';
  return 'cell-states';
}

export function decodeMaze(s: string): Result<Maze, CodecError> {
  if (typeof s !== 'string' || s.length < 2 || s[0] !== VERSION_1) {
    return err(codecError('grid-size', 'missing or unknown version'));
  }
  const sideValue = charValue(s, 1);
  if (sideValue < 0 || sideValue > MAX_SIDE - MIN_SIDE) {
    return err(codecError('grid-size', 'side out of range'));
  }
  const n = sideValue + MIN_SIDE;
  if (s.length !== encodedMazeLength(n)) {
    return err(codecError('grid-size', 'length does not match the side'));
  }
  const bad = firstBadChar(s, 2);
  if (bad >= 0)
    return err(
      codecError(fieldAt(n, bad), `character ${bad} outside alphabet`)
    );

  const cells = n * n;
  const r = new BitReader(s, 2);
  const start = r.read(8);
  if (start >= cells) return err(codecError('start', 'outside the grid'));
  const exit = r.read(8);
  if (exit >= cells || exit === start) {
    return err(
      codecError('exit', 'outside the grid or equal to the Start_Cell')
    );
  }
  const hWalls = new Uint8Array((n + 1) * n).fill(1);
  const vWalls = new Uint8Array(n * (n + 1)).fill(1);
  for (let row = 1; row < n; row++) {
    for (let c = 0; c < n; c++) hWalls[row * n + c] = r.read(1);
  }
  for (let row = 0; row < n; row++) {
    for (let c = 1; c < n; c++) vWalls[row * (n + 1) + c] = r.read(1);
  }
  const states = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    const v = r.read(2);
    if (v > 2) return err(codecError('cell-states', `Cell ${i} has state 3`));
    states[i] = v;
  }
  if (!r.paddingIsZero())
    return err(codecError('cell-states', 'nonzero padding'));
  return ok({ side: n, hWalls, vWalls, start, exit, states });
}
