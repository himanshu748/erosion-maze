import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { PuzzleDay } from '../shared/date';
import { parsePuzzleDay } from '../shared/date';
import { rngFor, rngFromString, seedString, shuffled } from '../shared/prng';

const day = (s: string): PuzzleDay => {
  const r = parsePuzzleDay(s);
  if (!r.ok) throw new Error(`test fixture ${s} is invalid`);
  return r.value;
};
const runs = { numRuns: 200, seed: Number(process.env.FC_SEED ?? 20261120) };

// Independent reference: xmur3 and sfc32 written with BigInt masking, sharing no code with src.
const M32 = 0xffffffffn;
const mul32 = (a: bigint, b: bigint): bigint => (a * b) & M32;
const rotl = (x: bigint, r: bigint): bigint =>
  ((x << r) | (x >> (32n - r))) & M32;
function refStream(seed: string, count: number): number[] {
  let h = (1779033703n ^ BigInt(seed.length)) & M32;
  for (let i = 0; i < seed.length; i++) {
    h = mul32(h ^ BigInt(seed.charCodeAt(i)), 3432918353n);
    h = rotl(h, 13n);
  }
  const hash = (): bigint => {
    h = mul32(h ^ (h >> 16n), 2246822507n);
    h = mul32(h ^ (h >> 13n), 3266489909n);
    h = h ^ (h >> 16n);
    return h;
  };
  let a = hash();
  let b = hash();
  let c = hash();
  let d = hash();
  const step = (): bigint => {
    const t0 = (a + b) & M32;
    a = b ^ (b >> 9n);
    b = (c + (c << 3n)) & M32;
    c = rotl(c, 21n);
    d = (d + 1n) & M32;
    const t = (t0 + d) & M32;
    c = (c + t) & M32;
    return t;
  };
  for (let i = 0; i < 15; i++) step();
  return Array.from({ length: count }, () => Number(step()));
}

describe('prng', () => {
  test('1.1 the stream matches the independent BigInt reference', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (seed) => {
        const rng = rngFromString(seed);
        const got = Array.from({ length: 8 }, () => rng.nextU32());
        expect(got).toEqual(refStream(seed, 8));
      }),
      runs
    );
  });

  test('1.1 seed strings name the day, Variant and purpose only', () => {
    expect(seedString(day('2026-11-16'), 0, 'carve:0')).toBe(
      'erosion-maze/1/2026-11-16/0/carve:0'
    );
  });

  test('1.2 equal inputs give equal streams; any changed input gives a different one', () => {
    const take = (d: string, v: number, p: string) => {
      const r = rngFor(day(d), v, p);
      return Array.from({ length: 4 }, () => r.nextU32());
    };
    const base = take('2026-11-16', 0, 'carve:0');
    expect(take('2026-11-16', 0, 'carve:0')).toEqual(base);
    expect(take('2026-11-17', 0, 'carve:0')).not.toEqual(base);
    expect(take('2026-11-16', 1, 'carve:0')).not.toEqual(base);
    expect(take('2026-11-16', 0, 'carve:1')).not.toEqual(base);
  });

  test('1.7 the stream ignores Math.random', () => {
    const before = Array.from(
      { length: 4 },
      (
        (r) => () =>
          r.nextU32()
      )(rngFromString('x'))
    );
    const original = Math.random;
    Math.random = () => 0.5;
    try {
      const after = Array.from(
        { length: 4 },
        (
          (r) => () =>
            r.nextU32()
        )(rngFromString('x'))
      );
      expect(after).toEqual(before);
    } finally {
      Math.random = original;
    }
  });

  test('nextInt stays in range and equals floor(u32 * k / 2^32)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 1, max: 2 ** 21 }),
        (seed, k) => {
          const a = rngFromString(seed);
          const b = rngFromString(seed);
          for (let i = 0; i < 16; i++) {
            const v = a.nextInt(k);
            expect(v).toBe(Math.floor((b.nextU32() * k) / 2 ** 32));
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(k);
          }
        }
      ),
      runs
    );
  });

  test('nextInt rejects bounds it cannot serve exactly', () => {
    const r = rngFromString('x');
    for (const k of [0, -1, 1.5, 2 ** 21 + 1, Number.NaN])
      expect(() => r.nextInt(k)).toThrow(RangeError);
  });

  test('nextInt is close to uniform', () => {
    const r = rngFromString('uniformity');
    const k = 10;
    const n = 100_000;
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) counts[r.nextInt(k)]! += 1;
    const expected = n / k;
    const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(27.88); // chi-square critical value, 9 dof, p = 0.001
  });

  test('shuffled is a deterministic permutation of 0..n-1', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 300 }), (seed, n) => {
        const a = shuffled(n, rngFromString(seed));
        expect(shuffled(n, rngFromString(seed))).toEqual(a);
        expect([...a].sort((x, y) => x - y)).toEqual(
          Array.from({ length: n }, (_, i) => i)
        );
      }),
      runs
    );
  });
});
