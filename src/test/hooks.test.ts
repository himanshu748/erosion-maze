import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { OVERGROWTH_CAP, WALL_CAP } from '../shared/constants';
import { postTitle, selectHook, type HookFacts } from '../shared/hooks';
import { WINDOW, day, dayArb, runs } from './maze-fixtures';

const factsArb: fc.Arbitrary<HookFacts> = fc.record({
  seed: fc.boolean(),
  wallsRemoved: fc.nat(WALL_CAP),
  newlyOvergrown: fc.nat(OVERGROWTH_CAP),
});

describe('selectHook and postTitle', () => {
  test('8.5 title format: "Day " + decimal Day_Number + middle dot + Hook', () => {
    expect(postTitle(42, 'Find the shortest way through')).toBe(
      'Day 42 \u00B7 Find the shortest way through'
    );
    expect(postTitle(99_999, 'x'.repeat(60)).length).toBeLessThanOrEqual(300);
  });

  // Property 25: Hook applicability and title length (Req 8.6, 8.7).
  test('8.6 and 8.7 every case has an applicable template and a short title', () => {
    fc.assert(
      fc.property(
        dayArb(),
        fc.integer({ min: 1, max: 99_999 }),
        factsArb,
        (d, n, facts) => {
          const hook = selectHook(d, facts);
          // Deterministic pick from the Variant 0 `hook` stream (Req 23.4 keeps the title).
          expect(selectHook(d, facts)).toEqual(hook);
          const { seed, wallsRemoved: w, newlyOvergrown: h } = facts;
          switch (hook.id) {
            case 'seed-a':
            case 'seed-b':
              expect(seed).toBe(true);
              break;
            case 'walls':
              expect([seed, w > 0]).toEqual([false, true]);
              expect(hook.text).toBe(
                `${String(w)} ${w === 1 ? 'wall' : 'walls'} fell overnight`
              );
              break;
            case 'walls-and-hedges':
              expect([seed, w > 0, h > 0]).toEqual([false, true, true]);
              expect(hook.text).toBe(
                `${String(w)} ${w === 1 ? 'wall' : 'walls'} fell, ${String(h)} ${h === 1 ? 'path' : 'paths'} grew over`
              );
              break;
            case 'hedges':
              expect([seed, w, h > 0]).toEqual([false, 0, true]);
              expect(hook.text).toBe(
                `No walls fell; ${String(h)} ${h === 1 ? 'path' : 'paths'} grew over`
              );
              break;
            case 'still':
              expect([seed, w, h]).toEqual([false, 0, 0]);
              break;
            case 'generic':
              break;
            default:
              throw new Error(`unknown Hook id ${hook.id}`);
          }
          const title = postTitle(n, hook.text);
          expect(title.length).toBeLessThanOrEqual(300);
          expect(title.startsWith(`Day ${String(n)} \u00B7 `)).toBe(true);
        }
      ),
      runs(300)
    );
  });

  test('8.6 slots use singular and plural forms', () => {
    const facts = (w: number): HookFacts => ({
      seed: false,
      wallsRemoved: w,
      newlyOvergrown: 0,
    });
    const pick = (w: number) =>
      WINDOW.map((d) => selectHook(d, facts(w))).find((h) => h.id === 'walls');
    expect(pick(1)?.text).toBe('1 wall fell overnight');
    expect(pick(2)?.text).toBe('2 walls fell overnight');
  });

  test('8.6 and 23.4 the pick comes from the Variant 0 hook stream (fixed selections)', () => {
    expect(
      selectHook(day('2026-11-16'), {
        seed: true,
        wallsRemoved: 0,
        newlyOvergrown: 0,
      })
    ).toEqual({ id: 'seed-a', text: 'A fresh maze for a new week' });
    expect(
      selectHook(day('2026-11-16'), {
        seed: false,
        wallsRemoved: 3,
        newlyOvergrown: 2,
      })
    ).toEqual({ id: 'walls', text: '3 walls fell overnight' });
    expect(
      selectHook(day('2026-11-17'), {
        seed: false,
        wallsRemoved: 0,
        newlyOvergrown: 5,
      })
    ).toEqual({ id: 'generic', text: 'Find the shortest way through' });
    expect(
      selectHook(day('2026-11-18'), {
        seed: false,
        wallsRemoved: 0,
        newlyOvergrown: 0,
      })
    ).toEqual({ id: 'generic', text: 'Find the shortest way through' });
  });

  test('8.6 the seeded pick varies across days (both seed templates occur)', () => {
    const seed: HookFacts = { seed: true, wallsRemoved: 0, newlyOvergrown: 0 };
    const ids = new Set(WINDOW.map((d) => selectHook(d, seed).id));
    expect(ids.has('seed-a') && ids.has('seed-b')).toBe(true);
  });
});
