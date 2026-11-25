// Seeded integer PRNG: xmur3 string hash seeding sfc32 (Req 1.1, 1.7). Integer-only, so the
// stream is identical on every host. Changing anything here changes every maze ever served.
import type { PuzzleDay } from './date';

export interface Rng {
  nextU32(): number;
  /** Uniform-ish integer in [0, k) for integer k in [1, 2^21]. */
  nextInt(k: number): number;
}

export const SEED_PREFIX = 'erosion-maze/1/';
const MAX_K = 2 ** 21;
const SFC32_WARMUP = 15;

function xmur3(str: string): () => number {
  let h = 1_779_033_703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3_432_918_353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2_246_822_507);
    h = Math.imul(h ^ (h >>> 13), 3_266_489_909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function sfc32(a0: number, b0: number, c0: number, d0: number): () => number {
  let a = a0 >>> 0;
  let b = b0 >>> 0;
  let c = c0 >>> 0;
  let d = d0 >>> 0;
  return () => {
    const t0 = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const t = (t0 + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
}

export function rngFromString(seed: string): Rng {
  const h = xmur3(seed);
  const next = sfc32(h(), h(), h(), h());
  // Discard early outputs so closely related seeds diverge before use.
  for (let i = 0; i < SFC32_WARMUP; i++) next();
  return {
    nextU32: next,
    nextInt(k: number): number {
      if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
        throw new RangeError(
          `nextInt bound must be an integer in [1, ${MAX_K}], got ${k}`
        );
      }
      return Math.floor((next() * k) / 4_294_967_296);
    },
  };
}

export const seedString = (
  day: PuzzleDay,
  variant: number,
  purpose: string
): string => `${SEED_PREFIX}${day}/${String(variant)}/${purpose}`;

export const rngFor = (day: PuzzleDay, variant: number, purpose: string): Rng =>
  rngFromString(seedString(day, variant, purpose));

/** Fisher-Yates shuffle of 0..n-1. */
export function shuffled(n: number, rng: Rng): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
