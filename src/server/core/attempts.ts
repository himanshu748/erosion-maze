import {
  context,
  redis as devvitRedis,
  type RedisClient,
  type TxClientLike,
} from '@devvit/web/server';
import type {
  AttemptRequest,
  FinishResponse,
  FinishResult,
  ProgressResponse,
  SavedAttempt,
  StateResponse,
} from '../../shared/api';
import { decodeMaze } from '../../shared/codec/maze';
import { decodeMoves } from '../../shared/codec/moves';
import { canonicalize, fingerprint } from '../../shared/canonical';
import { DIST_MAX, RATE_LIMIT } from '../../shared/constants';
import {
  MS_PER_DAY,
  cutoffMs,
  parsePuzzleDay,
  type PuzzleDay,
} from '../../shared/date';
import {
  validateSubmission,
  type Outcome,
  type SubmissionResult,
} from '../../shared/engine';
import type { StreakValue } from '../../shared/streak';
import type { Clock } from './clock';
import { systemClock } from './clock';
import {
  POSTS,
  attemptKey,
  costsKey,
  countersKey,
  dayKey,
  fingerprintsKey,
  funnelKey,
  leaderboardKey,
  parseStateValue,
  puzzleKey,
  rateKey,
  retentionSeconds,
  stateKey,
  statsKey,
} from './keys';
import { queuePlayedDay, readStreakWith } from './streaks';

const TX_ATTEMPTS = 4;

interface UnfinishedAttemptRow {
  readonly status: 'u';
  readonly moves: string;
  readonly username: string;
}

interface FinishedAttemptRow {
  readonly status: 'f';
  readonly moves: string;
  readonly username: string;
  readonly cost: number;
  readonly outcome: Outcome;
  readonly completedAt: number;
  readonly fp: string | null;
}

type AttemptRow = UnfinishedAttemptRow | FinishedAttemptRow;

export interface FinishFollowupInput {
  readonly userId: string;
  readonly username: string;
  readonly day: PuzzleDay;
  readonly puzzleKey: string;
  readonly cost: number;
  readonly outcome: Outcome;
  readonly par: number;
  readonly completedAt: number;
  readonly beforeStreak: StreakValue | null;
  readonly afterStreak: StreakValue | null;
}

export type FinishFollowup = (
  input: FinishFollowupInput
) => void | Promise<unknown>;

export interface AttemptsDeps {
  readonly redis: RedisClient;
  readonly username: string | undefined;
  readonly followup?: FinishFollowup;
}

interface PrecheckOk {
  readonly day: PuzzleDay;
  readonly activeVariant: number;
  readonly pk: string;
  readonly attKey: string;
  readonly stateKey: string;
  readonly nowMs: number;
  readonly retention: number;
  readonly validation: Extract<SubmissionResult, { readonly status: 'ok' }>;
  readonly encoded: string;
  readonly par: number;
  readonly budget: number;
  readonly finish: boolean;
}

type PrecheckResult =
  | { readonly ok: true; readonly value: PrecheckOk }
  | {
      readonly ok: false;
      readonly response: ProgressResponse | FinishResponse;
    };

const keyLocks = new Map<string, Promise<void>>();

async function keyed<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => mine);
  keyLocks.set(key, next);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (keyLocks.get(key) === next) keyLocks.delete(key);
  }
}

const integerField = (
  hash: Record<string, string>,
  field: string
): number | null => {
  const raw = hash[field];
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
};

function parseAttemptRow(hash: Record<string, string>): AttemptRow | null {
  const status = hash.status;
  if (status === undefined) return null;
  const moves = hash.moves;
  const username = hash.username;
  if (
    (status !== 'u' && status !== 'f') ||
    moves === undefined ||
    username === undefined
  ) {
    throw new Error('corrupt attempt record');
  }
  if (status === 'u') {
    return {
      status,
      moves,
      username,
    };
  }
  const cost = integerField(hash, 'cost');
  const completedAt = integerField(hash, 'completedAt');
  const outcomeRaw = hash.outcome;
  const outcome =
    outcomeRaw === 'S' ? 'solved' : outcomeRaw === 'O' ? 'out-of-moves' : null;
  if (cost === null || completedAt === null || outcome === null) {
    throw new Error('corrupt finished attempt record');
  }
  return {
    status,
    moves,
    username: username ?? '',
    cost,
    outcome,
    completedAt,
    fp: hash.fp ?? null,
  };
}

function isPrefix(savedEncoded: string, submitted: readonly number[]): boolean {
  const decoded = decodeMoves(savedEncoded);
  if (!decoded.ok) throw new Error('corrupt saved Moves');
  if (decoded.value.length > submitted.length) return false;
  return decoded.value.every((v, i) => v === submitted[i]);
}

async function trailblazerFor(
  client: RedisClient,
  pk: string,
  fp: string | null,
  userId: string
): Promise<boolean> {
  if (!fp) return false;
  try {
    return (await client.hGet(fingerprintsKey(pk), fp)) === userId;
  } catch {
    return false;
  }
}

async function savedFromRow(
  client: RedisClient,
  pk: string,
  userId: string,
  row: AttemptRow | null
): Promise<SavedAttempt> {
  if (!row) return { kind: 'none' };
  if (row.status === 'u') return { kind: 'unfinished', moves: row.moves };
  if (!row.outcome) throw new Error('corrupt finished attempt record');
  return {
    kind: 'finished',
    moves: row.moves,
    cost: row.cost,
    outcome: row.outcome,
    trailblazer: await trailblazerFor(client, pk, row.fp, userId),
    completedAt: row.completedAt,
  };
}

function abortLike(result: unknown): boolean {
  return result == null || (Array.isArray(result) && result.length === 0);
}

function abortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /EXECABORT/i.test(message) ||
    /watched keys? .*modified/i.test(message) ||
    /changed watched key/i.test(message)
  );
}

const warn = (message: string, error: unknown): void => {
  console.warn(`${message}:`, error);
};

function defaultFollowup(client: RedisClient): FinishFollowup {
  return async ({ day, completedAt }) => {
    const key = funnelKey(day);
    await client.hIncrBy(key, 'attempt_complete', 1);
    await client.expire(key, retentionSeconds(day, completedAt));
  };
}

function fireAndForget(
  followup: FinishFollowup,
  input: FinishFollowupInput
): void {
  void Promise.resolve()
    .then(() => followup(input))
    .catch((error) => warn('finish follow-up failed', error));
}

export function createAttempts(deps: AttemptsDeps) {
  const client = deps.redis;
  const followup = deps.followup ?? defaultFollowup(client);

  async function finishResultFromRow(
    userId: string,
    pk: string,
    row: FinishedAttemptRow,
    par: number,
    budget: number,
    now: Clock
  ): Promise<FinishResult> {
    const afterStreak = await readStreakWith(client, userId, now);
    return {
      cost: row.cost,
      outcome: row.outcome,
      par,
      budget,
      trailblazer: await trailblazerFor(client, pk, row.fp, userId),
      completedAt: row.completedAt,
      streak: afterStreak,
    };
  }

  async function precheck(
    userId: string,
    postId: string,
    req: AttemptRequest,
    now: Clock
  ): Promise<PrecheckResult> {
    const nowMs = now();
    const minute = Math.floor(nowMs / 60000);
    const rate = rateKey(userId, minute);
    const count = await client.incrBy(rate, 1);
    await client.expire(rate, 120);
    if (count > RATE_LIMIT) {
      return { ok: false, response: { status: 'rate_limited' } };
    }

    const mappedDay = await client.hGet(POSTS, postId);
    const parsedDay = mappedDay
      ? parsePuzzleDay(mappedDay)
      : { ok: false as const };
    if (!parsedDay.ok) {
      return { ok: false, response: { status: 'maze_unavailable' } };
    }
    const day = parsedDay.value;
    const fields = await client.hGetAll(dayKey(day));
    const activeVariant = integerField(fields, 'active');
    const par = integerField(fields, `par:${activeVariant ?? -1}`);
    const budget = integerField(fields, `budget:${activeVariant ?? -1}`);
    const mazeText =
      activeVariant === null ? undefined : fields[`maze:${activeVariant}`];
    const state = parseStateValue(await client.get(stateKey(day)));
    if (
      activeVariant === null ||
      par === null ||
      budget === null ||
      mazeText === undefined ||
      state === null ||
      state.variant !== activeVariant
    ) {
      return { ok: false, response: { status: 'maze_unavailable' } };
    }
    const decodedMaze = decodeMaze(mazeText);
    if (!decodedMaze.ok) {
      return { ok: false, response: { status: 'maze_unavailable' } };
    }
    const pk = puzzleKey(day, activeVariant);
    const attKey = attemptKey(pk, userId);
    if (state.status === 'skipped') {
      return { ok: false, response: { status: 'day_skipped' } };
    }
    if (state.status === 'closed' || nowMs >= cutoffMs(day)) {
      const row = parseAttemptRow(await client.hGetAll(attKey));
      return {
        ok: false,
        response: {
          status: 'day_closed',
          attempt: await savedFromRow(client, pk, userId, row),
        },
      };
    }
    if (req.variant !== activeVariant) {
      return { ok: false, response: { status: 'maze_changed' } };
    }
    const validation = validateSubmission(
      decodedMaze.value,
      budget,
      req.moves,
      'progress'
    );
    if (validation.status !== 'ok') return { ok: false, response: validation };
    return {
      ok: true,
      value: {
        day,
        activeVariant,
        pk,
        attKey,
        stateKey: stateKey(day),
        nowMs,
        retention: retentionSeconds(day, nowMs),
        validation,
        encoded: req.moves,
        par,
        budget,
        finish: validation.state.outcome !== null,
      },
    };
  }

  async function readDecisionData(
    pre: PrecheckOk
  ): Promise<readonly [string | undefined, Record<string, string>]> {
    return Promise.all([client.get(pre.stateKey), client.hGetAll(pre.attKey)]);
  }

  async function rejectAndUnwatch(
    tx: TxClientLike,
    response: ProgressResponse | FinishResponse
  ): Promise<ProgressResponse | FinishResponse> {
    await tx.unwatch();
    return response;
  }

  async function attemptLoop(
    mode: 'progress' | 'finish',
    userId: string,
    pre: PrecheckOk,
    now: Clock
  ): Promise<ProgressResponse | FinishResponse> {
    const username = deps.username ?? '';
    const budget = pre.budget;
    const par = pre.par;
    let beforeStreak: StreakValue | null = null;
    if (pre.finish) {
      beforeStreak = await readStreakWith(client, userId, now);
    }

    for (let tryNumber = 0; tryNumber < TX_ATTEMPTS; tryNumber++) {
      const tx = await client.watch(pre.attKey, pre.stateKey);
      const [stateRaw, attHash] = await readDecisionData(pre);
      const row = parseAttemptRow(attHash);
      const state = parseStateValue(stateRaw);

      if (!state || state.variant !== pre.activeVariant) {
        return rejectAndUnwatch(tx, { status: 'maze_changed' });
      }
      if (state.status === 'skipped') {
        return rejectAndUnwatch(tx, { status: 'day_skipped' });
      }
      if (state.status === 'closed' || pre.nowMs >= cutoffMs(pre.day)) {
        return rejectAndUnwatch(tx, {
          status: 'day_closed',
          attempt: await savedFromRow(client, pre.pk, userId, row),
        });
      }
      if (row?.status === 'f') {
        if (mode === 'finish' && row.moves === pre.encoded) {
          await tx.unwatch();
          const result = await finishResultFromRow(
            userId,
            pre.pk,
            row,
            par,
            budget,
            now
          );
          return mode === 'finish'
            ? { status: 'ok', result }
            : { status: 'ok', newClaim: false, finished: result };
        }
        return rejectAndUnwatch(tx, {
          status: 'already_finished',
          attempt: await savedFromRow(client, pre.pk, userId, row),
        });
      }
      if (row && !isPrefix(row.moves, pre.validation.moves)) {
        return rejectAndUnwatch(tx, {
          status: 'divergence',
          attempt: await savedFromRow(client, pre.pk, userId, row),
        });
      }
      if (mode === 'finish' && !pre.finish) {
        return rejectAndUnwatch(tx, {
          status: 'unfinished',
          attempt: await savedFromRow(client, pre.pk, userId, row),
        });
      }

      await tx.multi();
      if (pre.finish) {
        const outcome = pre.validation.state.outcome;
        if (!outcome) throw new Error('finished replay has no outcome');
        const canonical = canonicalize(pre.validation.state.route);
        const fp =
          outcome === 'solved'
            ? fingerprint(pre.validation.state.maze.side, canonical)
            : null;
        const fields: Record<string, string> = {
          status: 'f',
          moves: pre.encoded,
          username,
          cost: String(pre.validation.state.cost),
          outcome: outcome === 'solved' ? 'S' : 'O',
          completedAt: String(pre.nowMs),
        };
        if (fp) fields.fp = fp;
        await tx.hSet(pre.attKey, fields);
        const stats = statsKey(pre.pk);
        await tx.hIncrBy(stats, 'field', 1);
        const bucket =
          outcome === 'solved'
            ? `b${Math.min(Math.max(pre.validation.state.cost - par, 0), DIST_MAX)}`
            : 'oom';
        await tx.hIncrBy(stats, bucket, 1);
        if (outcome === 'solved' && fp) {
          await tx.hSetNX(fingerprintsKey(pre.pk), fp, userId);
          const score =
            pre.validation.state.cost * 1e8 +
            (pre.nowMs - (cutoffMs(pre.day) - MS_PER_DAY));
          await tx.zAdd(leaderboardKey(pre.pk), {
            member: userId,
            score,
          });
          await tx.hIncrBy(stats, 'solved', 1);
          await tx.hIncrBy(
            costsKey(pre.pk),
            String(pre.validation.state.cost),
            1
          );
        }
        const cnt = countersKey(pre.pk);
        for (const cell of pre.validation.visited) {
          await tx.hIncrBy(cnt, String(cell), 1);
        }
        await queuePlayedDay(tx, userId, pre.day);
        await tx.expire(pre.attKey, pre.retention);
        await tx.expire(stats, pre.retention);
        await tx.expire(cnt, pre.retention);
        if (outcome === 'solved') {
          await tx.expire(fingerprintsKey(pre.pk), pre.retention);
          await tx.expire(leaderboardKey(pre.pk), pre.retention);
          await tx.expire(costsKey(pre.pk), pre.retention);
        }
      } else {
        await tx.hSet(pre.attKey, {
          status: 'u',
          moves: pre.encoded,
          username,
        });
        await tx.expire(pre.attKey, pre.retention);
      }

      let execResult: unknown;
      try {
        execResult = await tx.exec();
      } catch (error) {
        if (abortError(error) && tryNumber + 1 < TX_ATTEMPTS) continue;
        if (!pre.finish) throw error;
        const reread = parseAttemptRow(await client.hGetAll(pre.attKey));
        if (reread?.status === 'f' && reread.moves === pre.encoded) {
          const result = await finishResultFromRow(
            userId,
            pre.pk,
            reread,
            par,
            budget,
            now
          );
          fireAndForget(followup, {
            userId,
            username,
            day: pre.day,
            puzzleKey: pre.pk,
            cost: result.cost,
            outcome: result.outcome,
            par,
            completedAt: result.completedAt,
            beforeStreak,
            afterStreak: result.streak,
          });
          return { status: 'ok', result };
        }
        return { status: 'error' };
      }
      if (abortLike(execResult)) {
        if (tryNumber + 1 < TX_ATTEMPTS) continue;
        return { status: 'error' };
      }

      if (!pre.finish) {
        return {
          status: 'ok',
          newClaim: row === null,
          finished: null,
        };
      }
      const outcome = pre.validation.state.outcome;
      if (!outcome) throw new Error('finished replay has no outcome');
      const canonical = canonicalize(pre.validation.state.route);
      const fp =
        outcome === 'solved'
          ? fingerprint(pre.validation.state.maze.side, canonical)
          : null;
      const afterStreak = await readStreakWith(client, userId, now);
      const result: FinishResult = {
        cost: pre.validation.state.cost,
        outcome,
        par,
        budget,
        trailblazer: await trailblazerFor(client, pre.pk, fp, userId),
        completedAt: pre.nowMs,
        streak: afterStreak,
      };
      fireAndForget(followup, {
        userId,
        username,
        day: pre.day,
        puzzleKey: pre.pk,
        cost: result.cost,
        outcome,
        par,
        completedAt: pre.nowMs,
        beforeStreak,
        afterStreak,
      });
      return mode === 'finish'
        ? { status: 'ok', result }
        : { status: 'ok', newClaim: row === null, finished: result };
    }
    return { status: 'error' };
  }

  async function submit(
    mode: 'progress' | 'finish',
    userId: string | undefined,
    postId: string,
    req: AttemptRequest,
    now: Clock
  ): Promise<ProgressResponse | FinishResponse> {
    if (!userId) return { status: 'sign_in_required' };
    const lockKey = `${postId}:${userId}`;
    return keyed(lockKey, async () => {
      try {
        const pre = await precheck(userId, postId, req, now);
        if (!pre.ok) return pre.response;
        return await attemptLoop(mode, userId, pre.value, now);
      } catch (error) {
        warn('attempt submission failed', error);
        return { status: 'error' };
      }
    });
  }

  return {
    saveProgress: (
      userId: string | undefined,
      postId: string,
      req: AttemptRequest,
      now: Clock = systemClock
    ): Promise<ProgressResponse> =>
      submit('progress', userId, postId, req, now) as Promise<ProgressResponse>,
    finishAttempt: (
      userId: string | undefined,
      postId: string,
      req: AttemptRequest,
      now: Clock = systemClock
    ): Promise<FinishResponse> =>
      submit('finish', userId, postId, req, now) as Promise<FinishResponse>,
    loadState: async (
      userId: string | undefined,
      postId: string,
      firstOfLoad: boolean,
      now: Clock = systemClock
    ): Promise<StateResponse> => {
      void firstOfLoad;
      try {
        const mappedDay = await client.hGet(POSTS, postId);
        const parsedDay = mappedDay
          ? parsePuzzleDay(mappedDay)
          : { ok: false as const };
        if (!parsedDay.ok) return { status: 'maze_unavailable' };
        const day = parsedDay.value;
        const fields = await client.hGetAll(dayKey(day));
        const activeVariant = integerField(fields, 'active');
        const dayNumber = integerField(fields, 'dayNumber');
        const par = integerField(fields, `par:${activeVariant ?? -1}`);
        const budget = integerField(fields, `budget:${activeVariant ?? -1}`);
        const maze =
          activeVariant === null ? undefined : fields[`maze:${activeVariant}`];
        const state = parseStateValue(await client.get(stateKey(day)));
        if (
          activeVariant === null ||
          dayNumber === null ||
          par === null ||
          budget === null ||
          maze === undefined ||
          state === null ||
          state.variant !== activeVariant ||
          !decodeMaze(maze).ok
        ) {
          return { status: 'maze_unavailable' };
        }
        const pk = puzzleKey(day, activeVariant);
        let attempt: SavedAttempt = { kind: 'none' };
        if (userId) {
          attempt = await savedFromRow(
            client,
            pk,
            userId,
            parseAttemptRow(await client.hGetAll(attemptKey(pk, userId)))
          );
        }
        const closed = now() >= cutoffMs(day);
        return {
          status: 'ok',
          day,
          dayNumber,
          variant: activeVariant,
          maze,
          par,
          budget,
          dayStatus:
            state.status === 'live' && closed ? 'closed' : state.status,
          loggedIn: userId !== undefined,
          attempt,
        };
      } catch (error) {
        warn('state load failed', error);
        return { status: 'error' };
      }
    },
  };
}

const defaultService = () =>
  createAttempts({ redis: devvitRedis, username: context.username });

export const saveProgress = (
  userId: string | undefined,
  postId: string,
  req: AttemptRequest,
  now: Clock = systemClock
): Promise<ProgressResponse> =>
  defaultService().saveProgress(userId, postId, req, now);

export const finishAttempt = (
  userId: string | undefined,
  postId: string,
  req: AttemptRequest,
  now: Clock = systemClock
): Promise<FinishResponse> =>
  defaultService().finishAttempt(userId, postId, req, now);

export const loadState = (
  userId: string | undefined,
  postId: string,
  firstOfLoad: boolean,
  now: Clock = systemClock
): Promise<StateResponse> =>
  defaultService().loadState(userId, postId, firstOfLoad, now);
