// Share_Formatter (Req 15.4 to 15.7, 7.7). The grid reveals only which blocks the Route
// touched: never Walls, Cell coordinates, Start_Cell, Exit_Cell or Moves (Req 15.6, 15.7).
import { SHARE_GRID_MAX } from './constants';
import type { Outcome } from './engine';
import { STRINGS } from './strings';

/**
 * Band widths per axis: B = min(SHARE_GRID_MAX, floor(n / 2)); with q = floor(n / B) and
 * r = n mod B, the first r bands have q + 1 Cells and the rest q (Req 15.5).
 */
export function shareBands(side: number): readonly number[] {
  const b = Math.min(SHARE_GRID_MAX, Math.floor(side / 2));
  const q = Math.floor(side / b);
  const r = side % b;
  return Array.from({ length: b }, (_, i) => (i < r ? q + 1 : q));
}

export interface ShareInput {
  readonly dayNumber: number;
  readonly outcome: Outcome;
  readonly cost: number;
  readonly par: number;
  readonly side: number;
  /** Visited_Cell_Set of the finished attempt. */
  readonly visited: readonly number[];
  /** Current_Streak recorded when the Scored_Attempt finished. */
  readonly streak: number;
}

const HIT = '🟩';
const MISS = '⬜';

/** Header, one spoiler-wrapped row per band row, streak line; blank lines between (Req 15.4). */
export function formatShare(i: ShareInput): string {
  const bands = shareBands(i.side);
  const seen = new Set(i.visited);
  const rows: string[] = [];
  let rowAt = 0;
  for (const height of bands) {
    let row = '';
    let colAt = 0;
    for (const width of bands) {
      let hit = false;
      for (let dr = 0; dr < height && !hit; dr++) {
        for (let dc = 0; dc < width; dc++) {
          if (seen.has((rowAt + dr) * i.side + colAt + dc)) {
            hit = true;
            break;
          }
        }
      }
      row += hit ? HIT : MISS;
      colAt += width;
    }
    rows.push(`>!${row}!<`);
    rowAt += height;
  }
  return [
    STRINGS.shareHeader(i.dayNumber, i.outcome, i.cost, i.par),
    ...rows,
    STRINGS.shareStreak(i.streak),
  ].join('\n\n');
}
