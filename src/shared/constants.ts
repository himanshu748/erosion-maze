// Tunable Parameters (requirements.md table; design.md "Shared_Core types and functions").
export const GRID_SIDE = 11;
export const OVERGROWN_COST = 2;
export const SLACK_H = [60, 50, 40, 32, 25, 18, 12] as const; // hundredths, Monday..Sunday
export const MIN_PAR = 2 * GRID_SIDE;
export const WALL_CAP = 6;
export const OVERGROWTH_CAP = 8;
export const WORN_RATIO = { num: 1n, den: 2n } as const;
export const HEAT_LEVELS = 8;
export const DIST_MAX = 10;
export const LEADERBOARD_TOP = 10;
export const GRACE_PER_WEEK = 1;
export const FLAIR_TIERS = [
  { name: 'Wanderer', min: 3 },
  { name: 'Pathfinder', min: 7 },
  { name: 'Cartographer', min: 30 },
] as const;
export const SHARE_GRID_MAX = 6;
export const PROGRESS_SYNC_MOVES = 5;
export const RATE_LIMIT = 60;
export const MAX_REGENERATIONS = 3;
export const DAY_RETENTION = 30;

// Gzipped JS + CSS budgets in bytes (1 KB = 1,024 bytes), checked by tools/check-bundle.mjs.
export const INLINE_BUNDLE_MAX = 50 * 1024;
export const GAME_BUNDLE_MAX = 150 * 1024;
