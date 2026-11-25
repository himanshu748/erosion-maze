// Day_Record types shared by the Game_Server and postData. The full DayRecord interface (hook,
// facts, moderator log) is added with the Hook module.
export type DayStatus = 'live' | 'closed' | 'skipped';

export interface VariantBuild {
  /** Maze_Codec string. */
  readonly maze: string;
  readonly par: number;
  readonly budget: number;
}
