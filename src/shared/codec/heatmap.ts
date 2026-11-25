// Heatmap_Codec, version 1: `A`, a side character (side - 9), then 3 bits per Cell, MSB-first.
import { HEAT_LEVELS } from '../constants';
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
} from './alphabet';
import { MAX_SIDE, MIN_SIDE } from './maze';

/** One level from 0 to HEAT_LEVELS - 1 per Cell, row-major. */
export interface Heatmap {
  readonly side: number;
  readonly levels: Uint8Array;
}

const LEVEL_BITS = 3;

export const encodedHeatmapLength = (side: number): number =>
  2 + Math.ceil((side * side * LEVEL_BITS) / 6);

export function encodeHeatmap(h: Heatmap): Result<string, CodecError> {
  const n = h.side;
  if (
    !Number.isInteger(n) ||
    n < MIN_SIDE ||
    n > MAX_SIDE ||
    h.levels.length !== n * n
  ) {
    return err(codecError('grid-size', 'side or level count out of range'));
  }
  if (h.levels.some((l) => l >= HEAT_LEVELS)) {
    return err(codecError('heatmap-levels', 'level out of range'));
  }
  const w = new BitWriter();
  for (const l of h.levels) w.write(l, LEVEL_BITS);
  return ok(VERSION_1 + (ALPHABET[n - MIN_SIDE] ?? '') + w.finish());
}

export function decodeHeatmap(s: string): Result<Heatmap, CodecError> {
  if (typeof s !== 'string' || s.length < 2 || s[0] !== VERSION_1) {
    return err(codecError('grid-size', 'missing or unknown version'));
  }
  const sideValue = charValue(s, 1);
  if (sideValue < 0 || sideValue > MAX_SIDE - MIN_SIDE) {
    return err(codecError('grid-size', 'side out of range'));
  }
  const n = sideValue + MIN_SIDE;
  if (s.length !== encodedHeatmapLength(n)) {
    return err(codecError('grid-size', 'length does not match the side'));
  }
  const bad = firstBadChar(s, 2);
  if (bad >= 0)
    return err(
      codecError('heatmap-levels', `character ${bad} outside alphabet`)
    );
  const r = new BitReader(s, 2);
  const levels = new Uint8Array(n * n);
  for (let i = 0; i < levels.length; i++) {
    const v = r.read(LEVEL_BITS);
    if (v >= HEAT_LEVELS)
      return err(codecError('heatmap-levels', `Cell ${i} level ${v}`));
    levels[i] = v;
  }
  if (!r.paddingIsZero())
    return err(codecError('heatmap-levels', 'nonzero padding'));
  return ok({ side: n, levels });
}
