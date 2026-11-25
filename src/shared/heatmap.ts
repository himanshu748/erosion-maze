// Heatmap quantization (Req 14.5, Glossary Heatmap).
import type { Heatmap } from './codec/heatmap';
import { HEAT_LEVELS } from './constants';
import type { CounterSnapshot } from './erosion';

/**
 * Level 0 for a count of 0, otherwise ceil(count * (HEAT_LEVELS - 1) / M) with M the day's
 * maximum counter, in BigInt so counters up to 2^53 - 1 stay exact. Every walked Cell is at least
 * level 1 and the busiest is HEAT_LEVELS - 1. The snapshot must pass `validateSnapshot`.
 */
export function quantize(s: CounterSnapshot, side: number): Heatmap {
  const cells = side * side;
  const counts = Array.from({ length: cells }, (_, i) => BigInt(s[i] ?? 0));
  let max = 0n;
  for (const c of counts) if (c > max) max = c;
  const levels = new Uint8Array(cells);
  if (max === 0n) return { side, levels };
  const top = BigInt(HEAT_LEVELS - 1);
  counts.forEach((c, i) => {
    if (c > 0n) levels[i] = Number((c * top + max - 1n) / max);
  });
  return { side, levels };
}
