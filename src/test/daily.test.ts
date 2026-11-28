import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { expect, vi } from 'vitest';
import { createAttempts } from '../server/core/attempts';
import { fixedClock } from '../server/core/clock';
import { runDaily, type DailyDeps } from '../server/core/daily';
import {
  DAYS,
  POSTS,
  countersKey,
  dayKey,
  puzzleKey,
  stateKey,
} from '../server/core/keys';
import { publishDailyPost } from '../server/routes/internal';
import { routeToMoves } from '../shared/canonical';
import { encodeMoves } from '../shared/codec/moves';
import { addDays, cutoffMs, MS_PER_DAY, type PuzzleDay } from '../shared/date';
import { evolve } from '../shared/erosion';
import { parsePostData } from '../shared/postdata';
import { solve } from '../shared/solver';
import { day } from './maze-fixtures';

const test = createDevvitTest();
const MONDAY = day('2026-11-16');
const POST = 't3_maze1';
const atStart = (puzzleDay: PuzzleDay) =>
  fixedClock(cutoffMs(puzzleDay) - MS_PER_DAY + 60_000);

function setup() {
  let lastId = 0;
  const publish = vi.fn<DailyDeps['publish']>(async () => `t3_maze${++lastId}`);
  const updatePostData = vi.fn<DailyDeps['updatePostData']>(async () => {});
  return { redis, publish, updatePostData };
}

test('overlapping ticks create one Reddit post and bind it to the ranked state', async () => {
  const deps = setup();
  const results = await Promise.all([
    runDaily(deps, atStart(MONDAY)),
    runDaily(deps, atStart(MONDAY)),
  ]);
  expect(results).toContainEqual({ status: 'posted', postId: POST });
  expect(await runDaily(deps, atStart(MONDAY))).toEqual({
    status: 'posted',
    postId: POST,
  });
  expect(deps.publish).toHaveBeenCalledTimes(1);
  expect(await redis.hGet(POSTS, POST)).toBe(MONDAY);
  expect(await redis.hGet(DAYS, MONDAY)).toBe('p');
  const [title, data] = deps.publish.mock.calls[0]!;
  expect(title).toMatch(/^Day 1 /);
  expect(data).toMatchObject({
    day: MONDAY,
    status: 'live',
    seed: true,
    finalHeat: null,
  });
  const attempts = createAttempts({
    redis,
    username: 'solver',
    followup: () => {},
  });
  expect(
    await attempts.loadState('t2_player', POST, true, atStart(MONDAY))
  ).toMatchObject({ status: 'ok', day: MONDAY });
});

test('an ambiguous Reddit submission remains reserved and subsequent jobs do not repost', async () => {
  const deps = setup();
  deps.publish.mockRejectedValueOnce(new Error('No Reddit acknowledgement'));
  await expect(runDaily(deps, atStart(MONDAY))).rejects.toThrow(
    'No Reddit acknowledgement'
  );
  expect(await redis.hGet(dayKey(MONDAY), 'postIntent')).toBe('creating');
  expect(await runDaily(deps, atStart(MONDAY))).toEqual({ status: 'pending' });
  expect(deps.publish).toHaveBeenCalledTimes(1);
  expect(await redis.hGet(DAYS, MONDAY)).toBeUndefined();
});

test('a pre-dispatch post configuration failure releases the reservation for a later job', async () => {
  const deps = { ...setup(), publish: publishDailyPost };
  vi.spyOn(globalThis.devvit!, 'appConfig', 'get').mockReturnValueOnce(
    undefined
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const post = { id: POST } as unknown as Awaited<
    ReturnType<typeof reddit.submitCustomPost>
  >;
  const submit = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(post);

  expect(await runDaily(deps, atStart(MONDAY))).toEqual({
    status: 'retryable',
  });
  expect(submit).not.toHaveBeenCalled();
  expect(await redis.hGet(dayKey(MONDAY), 'postIntent')).toBeUndefined();
  expect(await redis.hGet(DAYS, MONDAY)).toBeUndefined();

  expect(await runDaily(deps, atStart(MONDAY))).toEqual({
    status: 'posted',
    postId: POST,
  });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(await redis.hGet(POSTS, POST)).toBe(MONDAY);
});

test('SDK errors after dispatch do not release the reservation even with a status code', async () => {
  const deps = { ...setup(), publish: publishDailyPost };
  const failure = Object.assign(new Error('No Reddit acknowledgement'), {
    code: 3,
  });
  const submit = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockRejectedValue(failure);

  await expect(runDaily(deps, atStart(MONDAY))).rejects.toBe(failure);
  expect(await redis.hGet(dayKey(MONDAY), 'postIntent')).toBe('creating');
  expect(await runDaily(deps, atStart(MONDAY))).toEqual({ status: 'pending' });
  expect(submit).toHaveBeenCalledTimes(1);
});

test('a retained post receipt recovers its binding without submitting again', async () => {
  const deps = setup();
  await runDaily(deps, atStart(MONDAY));
  await redis.hDel(dayKey(MONDAY), ['postId']);
  await redis.hDel(POSTS, [POST]);
  await redis.hDel(DAYS, [MONDAY]);
  expect(await runDaily(deps, atStart(MONDAY))).toEqual({
    status: 'posted',
    postId: POST,
  });
  expect(await redis.hGet(POSTS, POST)).toBe(MONDAY);
  expect(await redis.hGet(DAYS, MONDAY)).toBe('p');
  expect(deps.publish).toHaveBeenCalledTimes(1);
});

test('UTC rollover freezes a real ranked finish, evolves its successor, and rejects late finishes', async () => {
  const deps = setup();
  const tuesday = addDays(MONDAY, 1);
  const start = atStart(MONDAY);
  const rollover = fixedClock(cutoffMs(MONDAY));
  await runDaily(deps, start);
  const data = deps.publish.mock.calls[0]![1];
  const parsed = parsePostData(data);
  if (!parsed.ok) throw new Error('Test post data did not decode');
  const { maze } = parsed.value;
  const route = solve(maze);
  if (route.kind !== 'solved') throw new Error('Test maze was not solvable');
  const moves = encodeMoves(routeToMoves(maze.side, route.path));
  const attempts = createAttempts({
    redis,
    username: 'solver',
    followup: () => {},
  });
  expect(
    await attempts.finishAttempt(
      't2_player',
      POST,
      { variant: 0, moves },
      start
    )
  ).toMatchObject({ status: 'ok' });
  const counters = countersKey(puzzleKey(MONDAY, 0));
  const countsBefore = await redis.hGetAll(counters);
  expect(Object.keys(countsBefore).length).toBeGreaterThan(0);

  await runDaily(deps, rollover);
  expect(await redis.get(stateKey(MONDAY))).toBe('closed:0');
  expect(
    await attempts.finishAttempt(
      't2_late',
      POST,
      { variant: 0, moves },
      rollover
    )
  ).toMatchObject({ status: 'day_closed' });
  expect(await redis.hGetAll(counters)).toEqual(countsBefore);

  const [oldPostId, oldPostData] = deps.updatePostData.mock.calls[0]!;
  const todayPostData = deps.publish.mock.calls[1]![1];
  expect(oldPostId).toBe(POST);
  expect(oldPostData).toMatchObject({
    ...data,
    status: 'closed',
    finalHeat: expect.any(String),
  });
  expect(todayPostData).toMatchObject({
    day: tuesday,
    n: 2,
    seed: false,
    heat: oldPostData.finalHeat,
  });
  const next = parsePostData(todayPostData);
  if (!next.ok) throw new Error('Successor post data did not decode');
  const counts = Array.from({ length: maze.side ** 2 }, (_, cell) =>
    Number(countsBefore[String(cell)] ?? 0)
  );
  const evolved = evolve(maze, counts, tuesday, 0);
  if (!evolved.ok) throw new Error('Test snapshot failed to evolve');
  expect(next.value.maze).toEqual(evolved.value.maze);
  expect([...next.value.heat.levels]).toContain(7);

  await runDaily(deps, atStart(tuesday));
  expect(deps.updatePostData).toHaveBeenCalledTimes(1);
});

test('missed dates rebuild without stale posts and the next Monday resets the seed', async () => {
  const deps = setup();
  const tuesday = addDays(MONDAY, 1);
  const wednesday = addDays(MONDAY, 2);
  const nextMonday = addDays(MONDAY, 7);
  await runDaily(deps, atStart(MONDAY));
  await runDaily(deps, atStart(wednesday));
  expect(await redis.get(stateKey(tuesday))).toBe('closed:0');
  expect(await redis.hGet(DAYS, tuesday)).toBeUndefined();
  expect(deps.publish.mock.calls.map(([, data]) => data.day)).toEqual([
    MONDAY,
    wednesday,
  ]);
  await runDaily(deps, atStart(nextMonday));
  expect(deps.publish.mock.calls[2]![1]).toMatchObject({
    day: nextMonday,
    seed: true,
    n: 8,
  });
  expect(deps.publish).toHaveBeenCalledTimes(3);
});

test('a week reset still closes the last actual post after a multi-day outage', async () => {
  const deps = setup();
  const friday = addDays(MONDAY, 4);
  const nextMonday = addDays(MONDAY, 7);
  await runDaily(deps, atStart(friday));
  await runDaily(deps, atStart(nextMonday));
  expect(await redis.get(stateKey(friday))).toBe('closed:0');
  expect(deps.updatePostData).toHaveBeenCalledWith(
    POST,
    expect.objectContaining({ day: friday, status: 'closed' })
  );
  expect(deps.publish.mock.calls.map(([, data]) => data.day)).toEqual([
    friday,
    nextMonday,
  ]);
});

test('an old Reddit post update failure still publishes the successor and is retried', async () => {
  const deps = setup();
  const tuesday = addDays(MONDAY, 1);
  const logged = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await runDaily(deps, atStart(MONDAY));
    deps.updatePostData.mockRejectedValueOnce(
      new Error('Temporary unavailability')
    );
    expect(await runDaily(deps, atStart(tuesday))).toMatchObject({
      status: 'posted',
    });
    expect(await redis.get(stateKey(MONDAY))).toBe('closed:0');
    expect(logged).toHaveBeenCalledTimes(1);
    await runDaily(deps, atStart(tuesday));
    expect(deps.updatePostData).toHaveBeenCalledTimes(2);
    expect(deps.publish).toHaveBeenCalledTimes(2);
  } finally {
    logged.mockRestore();
  }
});
