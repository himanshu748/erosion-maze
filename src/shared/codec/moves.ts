// Move_Codec, version 1: `A`, the Move count in 18 bits (3 characters), then 2 bits per Move
// (0 Up, 1 Right, 2 Down, 3 Left). Length 4 + ceil(count / 3).
import type { Move } from '../maze';
import { err, ok, type Result } from '../result';
import {
  BitReader,
  BitWriter,
  VERSION_1,
  codecError,
  firstBadChar,
  type CodecError,
} from './alphabet';

export const MAX_ENCODED_MOVES = 2 ** 18 - 1;

export const encodedMovesLength = (count: number): number =>
  4 + Math.ceil(count / 3);

/** Throws RangeError beyond MAX_ENCODED_MOVES Moves; no caller comes near (Move_Budget <= 9,999). */
export function encodeMoves(moves: readonly Move[]): string {
  if (moves.length > MAX_ENCODED_MOVES) {
    throw new RangeError(`at most ${MAX_ENCODED_MOVES} Moves can be encoded`);
  }
  const w = new BitWriter();
  w.write(moves.length, 18);
  for (const mv of moves) w.write(mv, 2);
  return VERSION_1 + w.finish();
}

export function decodeMoves(s: string): Result<Move[], CodecError> {
  if (typeof s !== 'string' || s.length < 4) {
    return err(codecError('moves', 'too short'));
  }
  if (s[0] !== VERSION_1) return err(codecError('moves', 'unknown version'));
  const bad = firstBadChar(s, 1);
  if (bad >= 0)
    return err(codecError('moves', `character ${bad} outside alphabet`));
  const r = new BitReader(s, 1);
  const count = r.read(18);
  if (s.length !== encodedMovesLength(count)) {
    return err(codecError('moves', 'length does not match the Move count'));
  }
  const out: Move[] = [];
  for (let i = 0; i < count; i++) out.push(r.read(2) as Move);
  if (!r.paddingIsZero()) return err(codecError('moves', 'nonzero padding'));
  return ok(out);
}
