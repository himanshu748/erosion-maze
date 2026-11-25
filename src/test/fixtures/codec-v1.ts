// Req 7.9 fixtures: strings in each codec's version-1 format, worked out by hand from the
// layout in design.md "Codec formats". Never edit an entry once written; add new ones instead.
import type { Move } from '../../shared/maze';

export const MOVES_V1: readonly {
  readonly encoded: string;
  readonly moves: readonly Move[];
}[] = [
  // count 0: 18 zero bits -> "AAA"
  { encoded: 'AAAA', moves: [] },
  // count 3 -> 000000 000000 000011 = "AAD"; Moves 00 00 00 -> "A"
  { encoded: 'AAADA', moves: [0, 0, 0] },
  // count 3; Moves 11 11 11 -> 63 = "_"
  { encoded: 'AAAD_', moves: [3, 3, 3] },
  // count 4 -> "AAE"; Moves 01 10 10 | 11 0000 -> 26 "a", 48 "w"
  { encoded: 'AAAEaw', moves: [1, 2, 2, 3] },
];

/**
 * Side 9, Start_Cell 0, Exit_Cell 80, every interior Wall present. Bits: start 00000000, exit
 * 01010000, 144 Wall bits of 1, 162 state bits, 2 padding bits. Characters after "AA": 000000 A,
 * 000101 F, 000011 D, 23 x 111111 _, 111100 8, then states.
 */
const ALL_WALLS_9 = 'AAAFD' + '_'.repeat(23) + '8';

export interface MazeFixture {
  readonly encoded: string;
  readonly side: number;
  readonly start: number;
  readonly exit: number;
  /** Interior Walls absent, as `hWalls` / `vWalls` indices. */
  readonly openH: readonly number[];
  readonly openV: readonly number[];
  /** Cells that are not Normal. */
  readonly states: Readonly<Record<number, 1 | 2>>;
}

export const MAZE_V1: readonly MazeFixture[] = [
  // all states Normal: 27 x 000000
  {
    encoded: ALL_WALLS_9 + 'A'.repeat(27),
    side: 9,
    start: 0,
    exit: 80,
    openH: [],
    openV: [],
    states: {},
  },
  // Cell 1 Worn (01), Cell 2 Overgrown (10): 01 10 00 = 011000 = Y
  {
    encoded: ALL_WALLS_9 + 'Y' + 'A'.repeat(26),
    side: 9,
    start: 0,
    exit: 80,
    openH: [],
    openV: [],
    states: { 1: 1, 2: 2 },
  },
  // Start_Cell 8, Exit_Cell 72: 000010 C, 00 0100 E, 1000 11 j; the first interior horizontal
  // Wall (hWalls[9]) open: bits 16.. = 0 then ones, so the third character is 1000 01 = h
  {
    encoded: 'AACEh' + '_'.repeat(23) + '8' + 'A'.repeat(27),
    side: 9,
    start: 8,
    exit: 72,
    openH: [9],
    openV: [],
    states: {},
  },
];

export const HEATMAP_V1: readonly {
  readonly encoded: string;
  readonly side: number;
  /** Non-zero levels by Cell. */
  readonly levels: Readonly<Record<number, number>>;
  readonly fill?: number;
}[] = [
  // side 9: 81 x 3 bits = 243 bits, 41 characters. Cell 0 level 7, Cell 1 level 1: 111 001 = 5
  { encoded: 'AA5' + 'A'.repeat(40), side: 9, levels: { 0: 7, 1: 1 } },
  // every level 7: 40 x 111111, then 111 + 000 padding = 111000 = 4
  { encoded: 'AA' + '_'.repeat(40) + '4', side: 9, levels: {}, fill: 7 },
  // side 15 (side character G), all zero: 225 x 3 = 675 bits, 113 characters
  { encoded: 'AG' + 'A'.repeat(113), side: 15, levels: {} },
];
