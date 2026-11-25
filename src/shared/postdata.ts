// postData wire format, version 1 (Req 8.8, 20.8). At most 2,048 JSON bytes (Req 7.6).
import { decodeHeatmap, type Heatmap } from './codec/heatmap';
import { decodeMaze } from './codec/maze';
import { decodeMoves, encodeMoves } from './codec/moves';
import type { CodecError } from './codec/alphabet';
import { routeToMoves } from './canonical';
import { parsePuzzleDay } from './date';
import type { DayStatus, VariantBuild } from './dayrecord';
import { adjacent, type Maze, type Move } from './maze';
import { err, ok, type Result } from './result';

export const POST_DATA_MAX_BYTES = 2048;

export interface PostDataV1 {
  readonly v: 1;
  /** Puzzle_Day; with `var`, the Puzzle_Key. */
  readonly day: string;
  /** Active Variant. */
  readonly var: number;
  /** Day_Number. */
  readonly n: number;
  /** Maze_Codec. */
  readonly maze: string;
  readonly budget: number;
  /** Par, so logged-out play needs no request. */
  readonly par: number;
  readonly status: DayStatus;
  readonly seed: boolean;
  /** Community_Route as Move_Codec steps from the Start_Cell; null = no Community_Route. */
  readonly route: string | null;
  /** Previous Puzzle_Day's Heatmap (all level 0 when that day had no Counted_Routes). */
  readonly heat: string;
  /** This Puzzle_Day's final Heatmap, once closed. */
  readonly finalHeat: string | null;
}

/** The Day_Record fields postData is built from. */
export interface PostDataSource {
  readonly day: string;
  readonly dayNumber: number;
  readonly seed: boolean;
  readonly status: DayStatus;
  readonly active: number;
  readonly builds: ReadonlyMap<number, VariantBuild>;
  readonly community: readonly number[] | null;
  readonly prevHeat: string;
  readonly finalHeat: string | null;
}

/**
 * Always the full object, because `post.setPostData()` replaces the whole object. Throws when the
 * record has no build for its active Variant or holds an undecodable Maze: both are bugs in the
 * record writer, never outside input.
 */
export function buildPostData(r: PostDataSource): PostDataV1 {
  const build = r.builds.get(r.active);
  if (!build) throw new RangeError(`no build for active Variant ${r.active}`);
  let route: string | null = null;
  if (r.community !== null) {
    const m = decodeMaze(build.maze);
    if (!m.ok)
      throw new RangeError(`stored Maze undecodable: ${m.error.detail}`);
    route = encodeMoves(routeToMoves(m.value.side, r.community));
  }
  return {
    v: 1,
    day: r.day,
    var: r.active,
    n: r.dayNumber,
    maze: build.maze,
    budget: build.budget,
    par: build.par,
    status: r.status,
    seed: r.seed,
    route,
    heat: r.prevHeat,
    finalHeat: r.finalHeat,
  };
}

export type PostDataError =
  | CodecError
  | {
      readonly kind: 'postdata';
      readonly field: keyof PostDataV1 | 'object';
      readonly detail: string;
    };

export interface ParsedPostData {
  readonly data: PostDataV1;
  readonly maze: Maze;
  readonly heat: Heatmap;
  readonly finalHeat: Heatmap | null;
  readonly route: readonly Move[] | null;
}

const STATUSES: readonly string[] = ['live', 'closed', 'skipped'];

const fieldError = (
  field: keyof PostDataV1 | 'object',
  detail: string
): PostDataError => ({
  kind: 'postdata',
  field,
  detail,
});

const isCount = (x: unknown, min: number): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= min;

/** Checks every field and decodes every codec string; never throws (Req 17.13). */
export function parsePostData(
  x: unknown
): Result<ParsedPostData, PostDataError> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    return err(fieldError('object', 'not an object'));
  }
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return err(fieldError('v', 'unknown version'));
  if (typeof o.day !== 'string' || !parsePuzzleDay(o.day).ok) {
    return err(fieldError('day', 'not a Puzzle_Day'));
  }
  if (!isCount(o.var, 0)) return err(fieldError('var', 'not a Variant'));
  if (!isCount(o.n, 1)) return err(fieldError('n', 'not a Day_Number'));
  if (!isCount(o.budget, 1))
    return err(fieldError('budget', 'not a Move_Budget'));
  if (!isCount(o.par, 1) || o.par > o.budget)
    return err(fieldError('par', 'not a Par'));
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) {
    return err(fieldError('status', 'unknown status'));
  }
  if (typeof o.seed !== 'boolean')
    return err(fieldError('seed', 'not a boolean'));
  if (typeof o.maze !== 'string')
    return err(fieldError('maze', 'not a string'));
  const maze = decodeMaze(o.maze);
  if (!maze.ok) return maze;
  if (typeof o.heat !== 'string')
    return err(fieldError('heat', 'not a string'));
  const heat = decodeHeatmap(o.heat);
  if (!heat.ok) return heat;
  if (heat.value.side !== maze.value.side)
    return err(fieldError('heat', 'side differs'));
  let finalHeat: Heatmap | null = null;
  if (o.finalHeat !== null) {
    if (typeof o.finalHeat !== 'string')
      return err(fieldError('finalHeat', 'not a string'));
    const f = decodeHeatmap(o.finalHeat);
    if (!f.ok) return f;
    if (f.value.side !== maze.value.side)
      return err(fieldError('finalHeat', 'side differs'));
    finalHeat = f.value;
  }
  let route: Move[] | null = null;
  if (o.route !== null) {
    if (typeof o.route !== 'string')
      return err(fieldError('route', 'not a string'));
    const r = decodeMoves(o.route);
    if (!r.ok) return r;
    let cell: number | null = maze.value.start;
    for (const mv of r.value) {
      cell = adjacent(maze.value.side, cell, mv);
      if (cell === null) return err(fieldError('route', 'leaves the grid'));
    }
    route = r.value;
  }
  const data: PostDataV1 = {
    v: 1,
    day: o.day,
    var: o.var,
    n: o.n,
    maze: o.maze,
    budget: o.budget,
    par: o.par,
    status: o.status as DayStatus,
    seed: o.seed,
    route: o.route,
    heat: o.heat,
    finalHeat: o.finalHeat,
  };
  return ok({ data, maze: maze.value, heat: heat.value, finalHeat, route });
}
