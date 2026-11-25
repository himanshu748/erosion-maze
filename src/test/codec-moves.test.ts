import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { ALPHABET } from '../shared/codec/alphabet';
import { decodeMoves, encodeMoves } from '../shared/codec/moves';
import type { Move } from '../shared/maze';
import { MOVES_V1 } from './fixtures/codec-v1';
import { refDecodeMoves, runs } from './maze-fixtures';

const moveArb = fc.constantFrom<Move>(0, 1, 2, 3);

describe('Move_Codec', () => {
  test('7.1 the alphabet is 64 printable ASCII characters without quote or backslash', () => {
    expect(new Set(ALPHABET).size).toBe(64);
    for (const ch of ALPHABET) {
      const c = ch.charCodeAt(0);
      expect(c >= 0x20 && c <= 0x7e && ch !== '"' && ch !== '\\').toBe(true);
    }
  });

  // Property 19: Move_Codec round trip.
  test('7.3 round-trip property for 0 to 1,000 Moves', () => {
    fc.assert(
      fc.property(fc.array(moveArb, { maxLength: 1000 }), (moves) => {
        const s = encodeMoves(moves);
        expect([...s].every((ch) => ALPHABET.includes(ch))).toBe(true);
        expect(s.length).toBe(4 + Math.ceil(moves.length / 3));
        const back = decodeMoves(s);
        expect(back).toEqual({ ok: true, value: moves });
        expect(refDecodeMoves(s)).toEqual(moves);
        if (back.ok) expect(encodeMoves(back.value)).toBe(s);
      }),
      runs(300)
    );
    expect(encodeMoves([])).toBe('AAAA');
    expect(encodeMoves(new Array<Move>(1000).fill(0)).length).toBe(338);
  });

  test('7.5 and 7.8 decoding never throws and agrees with the reference decoder', () => {
    const valid = fc.array(moveArb, { maxLength: 300 }).map(encodeMoves);
    const mutated = fc
      .tuple(valid, fc.nat(), fc.string({ minLength: 1, maxLength: 1 }))
      .map(([s, i, ch]) => {
        const k = i % s.length;
        return s.slice(0, k) + ch + s.slice(k + 1);
      });
    const truncated = fc
      .tuple(valid, fc.nat())
      .map(([s, i]) => s.slice(0, i % (s.length + 1)));
    const anything = fc.string({ maxLength: 4096, unit: 'binary' });
    fc.assert(
      fc.property(fc.oneof(mutated, truncated, anything), (s) => {
        let r: ReturnType<typeof decodeMoves> | undefined;
        expect(() => {
          r = decodeMoves(s);
        }).not.toThrow();
        const ref = refDecodeMoves(s);
        if (ref === null) {
          expect(r).toMatchObject({
            ok: false,
            error: { kind: 'codec', field: 'moves' },
          });
        } else {
          expect(r).toEqual({ ok: true, value: ref });
        }
      }),
      runs(500)
    );
  });

  test('7.9 version-1 fixtures still decode to their recorded Moves', () => {
    for (const f of MOVES_V1)
      expect(decodeMoves(f.encoded)).toEqual({ ok: true, value: f.moves });
  });
});
