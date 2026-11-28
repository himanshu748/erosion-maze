import type { RedisClient, TxClientLike } from '@devvit/web/server';
import { moveBudget } from '../../shared/budget';
import { encodeHeatmap } from '../../shared/codec/heatmap';
import { encodeMaze } from '../../shared/codec/maze';
import { communityRoute } from '../../shared/community';
import {
  addDays,
  cutoffMs,
  dayNumber,
  mondayOf,
  parsePuzzleDay,
  puzzleDayFromMs,
  weekday,
  type PuzzleDay,
} from '../../shared/date';
import { evolve, validateSnapshot } from '../../shared/erosion';
import { generateDetailed } from '../../shared/generator';
import { quantize } from '../../shared/heatmap';
import { postTitle, selectHook } from '../../shared/hooks';
import type { Maze } from '../../shared/maze';
import {
  buildPostData,
  parsePostData,
  POST_DATA_MAX_BYTES,
  type ParsedPostData,
  type PostDataV1,
} from '../../shared/postdata';
import { solve } from '../../shared/solver';
import type { Clock } from './clock';
import { systemClock } from './clock';
import {
  DAYS,
  META,
  POSTS,
  countersKey,
  dayKey,
  parseStateValue,
  puzzleKey,
  retentionSeconds,
  stateKey,
  stateValue,
} from './keys';

const VARIANT = 0;
const FIRST_DAY = 'firstDay';
const LAST_ACTIVE_DAY = 'lastActiveDay';
const CREATING = 'creating';
const MAX_CONFLICT_RETRIES = 4;
type PostId = `t3_${string}`;

export interface DailyDeps {
  readonly redis: RedisClient;
  /** Only return 'not-submitted' when the Reddit submission was never sent. */
  readonly publish: (
    title: string,
    data: PostDataV1
  ) => Promise<PostId | 'not-submitted'>;
  readonly updatePostData: (id: PostId, data: PostDataV1) => Promise<void>;
}

export type DailyResult =
  | { readonly status: 'posted'; readonly postId: PostId }
  | { readonly status: 'pending' | 'retryable' | 'closed' };

type StoredDay = { readonly post: ParsedPostData; readonly title: string };
type FrozenDay = {
  readonly maze: Maze;
  readonly counts: readonly number[];
  readonly heat: string;
};

function parseRecord(raw: Record<string, string>): StoredDay | null {
  if (raw.postData === undefined) return null;
  const parsed = parsePostData(JSON.parse(raw.postData));
  if (!parsed.ok || !raw.title) throw new Error('Invalid daily maze record');
  return { post: parsed.value, title: raw.title };
}

function asPostId(value: string): PostId {
  if (!/^t3_[a-z0-9]+$/i.test(value)) throw new Error('Invalid daily post ID');
  return value as PostId;
}

function encodedHeat(counts: readonly number[], side: number): string {
  const heat = encodeHeatmap(quantize(counts, side));
  if (!heat.ok) throw new Error('Cannot encode daily heatmap');
  return heat.value;
}

function buildDay(
  day: PuzzleDay,
  firstDay: PuzzleDay,
  prior: FrozenDay | null
): { readonly data: PostDataV1; readonly title: string } {
  const priorForEvolution = weekday(day) === 0 ? null : prior;
  const seed = priorForEvolution === null;
  let maze: Maze;
  let par: number;
  let wallsRemoved = 0;
  let newlyOvergrown = 0;
  if (priorForEvolution) {
    const evolved = evolve(
      priorForEvolution.maze,
      priorForEvolution.counts,
      day,
      VARIANT
    );
    if (!evolved.ok) throw new Error('Invalid frozen erosion counters');
    maze = evolved.value.maze;
    const solution = solve(maze);
    if (solution.kind !== 'solved')
      throw new Error('Eroded maze has no solution');
    par = solution.par;
    wallsRemoved = evolved.value.report.wallsRemoved.length;
    newlyOvergrown = evolved.value.report.newlyOvergrown.length;
  } else {
    const generated = generateDetailed(day, VARIANT);
    if (!generated.ok) throw new Error('Cannot generate the daily maze');
    ({ maze, par } = generated.value);
  }
  const encoded = encodeMaze(maze);
  if (!encoded.ok) throw new Error('Cannot encode the daily maze');
  const n = dayNumber(firstDay, day);
  const compatiblePrior = prior?.maze.side === maze.side ? prior : null;
  const data = buildPostData({
    day,
    dayNumber: n,
    seed,
    status: 'live',
    active: VARIANT,
    builds: new Map([
      [
        VARIANT,
        { maze: encoded.value, par, budget: moveBudget(par, weekday(day)) },
      ],
    ]),
    community: priorForEvolution
      ? communityRoute(maze, priorForEvolution.counts)
      : null,
    prevHeat: compatiblePrior?.heat ?? encodedHeat([], maze.side),
    finalHeat: null,
  });
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > POST_DATA_MAX_BYTES) {
    throw new Error('Daily maze post data is too large');
  }
  return {
    data,
    title: postTitle(
      n,
      selectHook(day, { seed, wallsRemoved, newlyOvergrown }).text
    ),
  };
}

async function changeDay<T>(
  client: RedisClient,
  day: PuzzleDay,
  plan: () => Promise<{
    readonly value: T;
    readonly write?: (tx: TxClientLike) => Promise<void>;
    readonly confirm?: (results: readonly unknown[]) => boolean;
  }>,
  extraKeys: readonly string[] = []
): Promise<T> {
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    const tx = await client.watch(dayKey(day), stateKey(day), ...extraKeys);
    let queued = false;
    let executing = false;
    try {
      const change = await plan();
      if (!change.write) {
        await tx.unwatch();
        return change.value;
      }
      await tx.multi();
      queued = true;
      await change.write(tx);
      executing = true;
      const result: unknown = await tx.exec();
      if (
        Array.isArray(result) &&
        result.length > 0 &&
        (!change.confirm || change.confirm(result))
      ) {
        return change.value;
      }
    } catch (error) {
      if (!executing) {
        if (queued) await tx.discard();
        else await tx.unwatch();
      }
      const conflict =
        executing &&
        error instanceof Error &&
        /EXECABORT|watched keys? .*modified|changed watched key/i.test(
          error.message
        );
      if (!conflict) throw error;
    }
  }
  throw new Error('Daily maze record changed during rollover');
}

async function prepareDay(
  client: RedisClient,
  day: PuzzleDay,
  firstDay: PuzzleDay,
  prior: FrozenDay | null,
  nowMs: number
): Promise<StoredDay> {
  return changeDay(client, day, async () => {
    const key = dayKey(day);
    const storedState = await client.get(stateKey(day));
    const raw = await client.hGetAll(key);
    const existing = parseRecord(raw);
    if (existing) return { value: existing };
    if (Object.keys(raw).length > 0 || storedState) {
      throw new Error('Cannot replace an incomplete daily maze record');
    }
    const { data, title } = buildDay(day, firstDay, prior);
    const post = parsePostData(data);
    if (!post.ok) throw new Error('Generated daily maze has invalid post data');
    const retention = retentionSeconds(day, nowMs);
    return {
      value: { post: post.value, title },
      write: async (tx) => {
        await tx.hSet(key, {
          active: String(data.var),
          dayNumber: String(data.n),
          [`maze:${data.var}`]: data.maze,
          [`par:${data.var}`]: String(data.par),
          [`budget:${data.var}`]: String(data.budget),
          postData: JSON.stringify(data),
          title,
        });
        await tx.expire(key, retention);
        await tx.set(stateKey(day), stateValue('live', data.var));
        await tx.expire(stateKey(day), retention);
      },
    };
  });
}

async function reservePost(
  client: RedisClient,
  day: PuzzleDay,
  now: Clock
): Promise<boolean> {
  return changeDay(
    client,
    day,
    async () => {
      const key = dayKey(day);
      const [storedState, intent, lastActive] = await Promise.all([
        client.get(stateKey(day)),
        client.hGet(key, 'postIntent'),
        client.hGet(META, LAST_ACTIVE_DAY),
      ]);
      if (
        parseStateValue(storedState)?.status !== 'live' ||
        intent ||
        (lastActive !== undefined && lastActive > day) ||
        now() >= cutoffMs(day)
      ) {
        return { value: false };
      }
      return {
        value: true,
        confirm: ([claimed]) => claimed === 1,
        write: async (tx) => {
          await tx.hSetNX(key, 'postIntent', CREATING);
          await tx.hSet(META, { [LAST_ACTIVE_DAY]: day });
        },
      };
    },
    [META]
  );
}

async function bindPost(
  client: RedisClient,
  day: PuzzleDay,
  postId: PostId
): Promise<void> {
  await changeDay(client, day, async () => {
    const key = dayKey(day);
    const raw = await client.hGetAll(key);
    if (raw.postId === postId) return { value: undefined };
    const state = parseStateValue(await client.get(stateKey(day)));
    if (!state || raw.postIntent !== postId || raw.postId)
      throw new Error('Daily post receipt mismatch');
    return {
      value: undefined,
      write: async (tx) => {
        await tx.hSet(POSTS, { [postId]: day });
        await tx.hSet(DAYS, { [day]: state.status === 'skipped' ? 's' : 'p' });
        await tx.hSet(key, { postId });
      },
    };
  });
}

async function freezeDay(
  deps: DailyDeps,
  day: PuzzleDay,
  nowMs: number
): Promise<FrozenDay | null> {
  if (nowMs < cutoffMs(day)) return null;
  const client = deps.redis;
  const key = dayKey(day);
  const state = await changeDay(client, day, async () => {
    const state = parseStateValue(await client.get(stateKey(day)));
    if (!state || state.status !== 'live') return { value: state };
    return {
      value: { ...state, status: 'closed' as const },
      write: async (tx) => {
        await tx.set(stateKey(day), stateValue('closed', state.variant));
        await tx.expire(stateKey(day), retentionSeconds(day, nowMs));
      },
    };
  });
  if (!state) return null;
  const raw = await client.hGetAll(key);
  const record = parseRecord(raw);
  if (!record || record.post.data.var !== state.variant)
    throw new Error('Cannot freeze an unknown daily maze');
  const { maze, data } = record.post;
  const counts: number[] = new Array<number>(maze.side ** 2).fill(0);
  if (state.status === 'closed') {
    // A finish watches the same gate we closed. Once closed commits, no later
    // finish can change these counters, including clients already in flight.
    const counters = await client.hGetAll(
      countersKey(puzzleKey(day, state.variant))
    );
    for (const [cell, count] of Object.entries(counters)) {
      if (
        !/^(0|[1-9][0-9]*)$/.test(cell) ||
        Number(cell) >= counts.length ||
        !/^[0-9]+$/.test(count)
      ) {
        throw new Error('Invalid stored erosion counter');
      }
      counts[Number(cell)] = Number(count);
    }
    if (validateSnapshot(counts, counts.length))
      throw new Error('Invalid stored erosion snapshot');
  }
  const heat = encodedHeat(counts, maze.side);
  const finalData: PostDataV1 = {
    ...data,
    status: state.status,
    finalHeat: heat,
  };
  if (raw.postData !== JSON.stringify(finalData)) {
    await client.hSet(key, { postData: JSON.stringify(finalData) });
  }
  const knownPost =
    raw.postId ?? (raw.postIntent === CREATING ? undefined : raw.postIntent);
  if (knownPost && !raw.finalPostData) {
    const postId = asPostId(knownPost);
    if (!raw.postId) await bindPost(client, day, postId);
    try {
      await deps.updatePostData(postId, finalData);
      await client.hSet(key, { finalPostData: '1' });
    } catch {
      // An old post may be removed; its Redis gate is already closed and the
      // next day's availability must not depend on updating old Reddit UI.
      console.warn('Could not refresh final daily maze post data');
    }
  }
  return { maze, counts, heat };
}

export async function runDaily(
  deps: DailyDeps,
  now: Clock = systemClock
): Promise<DailyResult> {
  const client = deps.redis;
  const nowMs = now();
  const today = puzzleDayFromMs(nowMs);
  await client.hSetNX(META, FIRST_DAY, today);
  const first = parsePuzzleDay((await client.hGet(META, FIRST_DAY)) ?? '');
  if (!first.ok) throw new Error('Missing first daily maze date');
  if (first.value > today) return { status: 'closed' };

  const monday = mondayOf(today);
  const start = first.value > monday ? first.value : monday;
  const previous = addDays(start, -1);
  const lastActive = parsePuzzleDay(
    (await client.hGet(META, LAST_ACTIVE_DAY)) ?? ''
  );
  if (
    lastActive.ok &&
    lastActive.value < previous &&
    retentionSeconds(lastActive.value, nowMs) > 0
  ) {
    // A week reset still closes the last played maze after a longer outage.
    await freezeDay(deps, lastActive.value, nowMs);
  }
  let prior = await freezeDay(deps, previous, nowMs);
  for (let day = start; day < today; day = addDays(day, 1)) {
    await prepareDay(client, day, first.value, prior, nowMs);
    // Rebuild missed days within this week without publishing stale posts.
    prior = await freezeDay(deps, day, nowMs);
  }
  const current = await prepareDay(client, today, first.value, prior, nowMs);
  const key = dayKey(today);
  const raw = await client.hGetAll(key);
  const state = parseStateValue(await client.get(stateKey(today)));
  if (state?.status !== 'live' || now() >= cutoffMs(today))
    return { status: 'closed' };
  if (raw.postId) return { status: 'posted', postId: asPostId(raw.postId) };
  if (raw.postIntent === CREATING) return { status: 'pending' };
  let postId: PostId;
  if (raw.postIntent) {
    postId = asPostId(raw.postIntent);
  } else {
    // The durable per-day reservation precedes the external side effect. An
    // ambiguous reply stays pending for inspection instead of reposting.
    if (!(await reservePost(client, today, now))) return { status: 'pending' };
    const receipt = await deps.publish(current.title, current.post.data);
    if (receipt === 'not-submitted') {
      // Only this invocation owns the reservation, and no Reddit request ran.
      await client.hDel(key, ['postIntent']);
      return { status: 'retryable' };
    }
    postId = asPostId(receipt);
    await client.hSet(key, { postIntent: postId });
  }
  await bindPost(client, today, postId);
  const postedAt = now();
  if (postedAt >= cutoffMs(today)) await freezeDay(deps, today, postedAt);
  return { status: 'posted', postId };
}
