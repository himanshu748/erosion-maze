// Route_Canonicalizer and fingerprint (Req 21.1, 21.10).
import { encodeMoves } from './codec/moves';
import { DOWN, LEFT, RIGHT, UP, type Move } from './maze';

/**
 * Chronological loop erasure (Req 21.1): append each Cell, and when a Cell is already in the list,
 * drop every entry after its earlier occurrence instead.
 */
export function canonicalize(route: readonly number[]): number[] {
  const out: number[] = [];
  const pos = new Map<number, number>();
  for (const cell of route) {
    const p = pos.get(cell);
    if (p === undefined) {
      pos.set(cell, out.length);
      out.push(cell);
    } else {
      for (let i = p + 1; i < out.length; i++) pos.delete(out[i] ?? -1);
      out.length = p + 1;
    }
  }
  return out;
}

/**
 * Moves between consecutive Cells of a Route. Every caller passes a Route the Game_Engine or the
 * Community_Route_Builder produced, so a non-adjacent step is a bug and throws RangeError.
 */
export function routeToMoves(side: number, cells: readonly number[]): Move[] {
  const out: Move[] = [];
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1] ?? -1;
    const b = cells[i] ?? -1;
    const sameRow = Math.floor(a / side) === Math.floor(b / side);
    if (b === a - side && a >= side) out.push(UP);
    else if (b === a + side && b < side * side) out.push(DOWN);
    else if (b === a + 1 && sameRow) out.push(RIGHT);
    else if (b === a - 1 && sameRow) out.push(LEFT);
    else throw new RangeError(`Cells ${a} and ${b} are not adjacent`);
  }
  return out;
}

/**
 * Move_Codec string of the Canonical_Route's steps. Every Canonical_Route on one Maze starts at
 * the Start_Cell and the codec is lossless, so fingerprints match exactly when routes match.
 */
export const fingerprint = (
  side: number,
  canonical: readonly number[]
): string => encodeMoves(routeToMoves(side, canonical));
