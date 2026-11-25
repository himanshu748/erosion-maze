import { redis } from '@devvit/web/server';
import { createDevvitTest } from '@devvit/test/server/vitest';
import fc from 'fast-check';
import { describe, expect, vi } from 'vitest';
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
  returnNextKey,
  shareCommentKey,
  shareKey,
  shareUrlKey,
  stateKey,
  stateValue,
  statsKey,
} from '../server/core/keys';
import { fixedClock } from '../server/core/clock';
import { createAttempts, type FinishFollowup } from '../server/core/attempts';
import { encodeMaze } from '../shared/codec/maze';
import { encodeMoves } from '../shared/codec/moves';
import { canonicalize, routeToMoves } from '../shared/canonical';
import { DAY_RETENTION, GRID_SIDE, RATE_LIMIT } from '../shared/constants';
import { MS_PER_DAY, cutoffMs } from '../shared/date';
import { serpentine } from '../shared/generator';
import type { Move } from '../shared/maze';
import { solve } from '../shared/solver';
import { FC_SEED, day } from './maze-fixtures';

const test = createDevvitTest();
const DAY = day('2026-11-16');
const POST_ID = 't3_post';
const NOOP_FOLLOWUP: FinishFollowup = () => {};

function service() {
  return createAttempts({
    redis,
    username: 'testuser',
    followup: NOOP_FOLLOWUP,
  });
}

function nowMs(): number {
  return cutoffMs(DAY) - MS_PER_DAY + 60_000;
}

function clock() {
  return fixedClock(nowMs());
}

function seedMaze() {
  const maze = serpentine(GRID_SIDE, 0, GRID_SIDE * GRID_SIDE - 1);
  const encoded = encodeMaze(maze);
  if (!encoded.ok) throw new Error('fixture maze does not encode');
  const solved = solve(maze);
  if (solved.kind !== 'solved') throw new Error('fixture maze is unsolvable');
  const budget = solved.par + 2;
  const pathMoves = routeToMoves(maze.side, solved.path);
  return {
    maze,
    encoded: encoded.value,
    par: solved.par,
    budget,
    path: solved.path,
    pathMoves,
    solution: encodeMoves(pathMoves),
  };
}

async function seedVariant(postId: string, variant: number) {
  const fx = seedMaze();
  await redis.hSet(POSTS, { [postId]: DAY });
  await redis.hSet(dayKey(DAY), {
    active: String(variant),
    dayNumber: '1',
    [`maze:${variant}`]: fx.encoded,
    [`par:${variant}`]: String(fx.par),
    [`budget:${variant}`]: String(fx.budget),
  });
  await redis.set(stateKey(DAY), stateValue('live', variant));
  return fx;
}

const seedDay = () => seedVariant(POST_ID, 0);

const opposite = (mv: Move): Move => ((mv + 2) % 4) as Move;

function oomMoves(fx: ReturnType<typeof seedMaze>): string {
  const first = fx.pathMoves[0];
  if (first === undefined) throw new Error('empty fixture path');
  const back = opposite(first);
  const moves = [first, back, first, back, ...fx.pathMoves.slice(0, -2)];
  return encodeMoves(moves);
}

function detourSolution(fx: ReturnType<typeof seedMaze>): string {
  const first = fx.pathMoves[0];
  if (first === undefined) throw new Error('empty fixture path');
  return encodeMoves([first, opposite(first), ...fx.pathMoves]);
}

describe('server core keys and clock', () => {
  test('builds the Redis key schema exactly', () => {
    const pk = puzzleKey(DAY, 2);
    expect(pk).toBe('2026-11-16:2');
    expect(POSTS).toBe('em:posts');
    expect(dayKey(DAY)).toBe('em:day:2026-11-16');
    expect(stateKey(DAY)).toBe('em:state:2026-11-16');
    expect(countersKey(pk)).toBe('em:cnt:2026-11-16:2');
    expect(attemptKey(pk, 't2_u')).toBe('em:att:2026-11-16:2:t2_u');
    expect(leaderboardKey(pk)).toBe('em:lb:2026-11-16:2');
    expect(statsKey(pk)).toBe('em:stats:2026-11-16:2');
    expect(costsKey(pk)).toBe('em:costs:2026-11-16:2');
    expect(fingerprintsKey(pk)).toBe('em:fp:2026-11-16:2');
    expect(shareKey(pk)).toBe('em:share:2026-11-16:2');
    expect(shareUrlKey(pk)).toBe('em:shareurl:2026-11-16:2');
    expect(shareCommentKey('t1_c')).toBe('em:sharecmt:t1_c');
    expect(returnNextKey(DAY)).toBe('em:rnd:2026-11-16');
    expect(rateKey('t2_u', 12)).toBe('em:rate:t2_u:12');
    expect(funnelKey(DAY)).toBe('em:funnel:2026-11-16');
    expect(parseStateValue(stateValue('closed', 2))).toEqual({
      status: 'closed',
      variant: 2,
    });
    expect(parseStateValue('bogus')).toBeNull();
  });

  test('computes retention from the injected time and fixed clocks are injectable', () => {
    const atDayStart = cutoffMs(DAY) - MS_PER_DAY;
    expect(retentionSeconds(DAY, atDayStart)).toBe(
      (DAY_RETENTION + 1) * 86_400
    );
    expect(fixedClock(123)()).toBe(123);
  });
});

describe('attempt pre-checks', () => {
  test('requires a signed-in user before touching state', async () => {
    await seedDay();
    const response = await service().saveProgress(undefined, POST_ID, {
      variant: 0,
      moves: 'A',
    });
    expect(response).toEqual({ status: 'sign_in_required' });
  });

  test('returns maze_unavailable for an unmapped post', async () => {
    const response = await service().saveProgress('t2_u', 't3_missing', {
      variant: 0,
      moves: 'A',
    });
    expect(response).toEqual({ status: 'maze_unavailable' });
  });

  test('rate limits after the configured threshold and counts rejected calls', async () => {
    await seedDay();
    const minute = Math.floor(nowMs() / 60000);
    await redis.set(rateKey('t2_u', minute), String(RATE_LIMIT));
    const response = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: 'not valid',
      },
      clock()
    );
    expect(response).toEqual({ status: 'rate_limited' });
    expect(await redis.get(rateKey('t2_u', minute))).toBe(
      String(RATE_LIMIT + 1)
    );
  });

  test('reports maze_changed before move validation', async () => {
    await seedDay();
    const response = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 9,
        moves: 'not valid',
      },
      clock()
    );
    expect(response).toEqual({ status: 'maze_changed' });
  });

  test('reports invalid move encoding and invalid length in order', async () => {
    await seedDay();
    const bad = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: 'not valid',
      },
      clock()
    );
    expect(bad).toEqual({ status: 'invalid_moves' });
    const empty = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: encodeMoves([]),
      },
      clock()
    );
    expect(empty).toEqual({ status: 'invalid_length' });
  });

  test('a live day at the cutoff is closed by the injected server clock', async () => {
    const fx = await seedDay();
    const response = await service().finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      fixedClock(cutoffMs(DAY))
    );
    expect(response.status).toBe('day_closed');
    expect(await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).toEqual({});
  });
});

describe('attempt write plans', () => {
  test('claims progress once and accepts an exact saved-move prefix', async () => {
    const fx = await seedDay();
    const firstMoves = encodeMoves(fx.pathMoves.slice(0, 2));
    const longerMoves = encodeMoves(fx.pathMoves.slice(0, 4));
    const first = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: firstMoves,
      },
      clock()
    );
    expect(first).toEqual({ status: 'ok', newClaim: true, finished: null });
    const second = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: longerMoves,
      },
      clock()
    );
    expect(second).toEqual({ status: 'ok', newClaim: false, finished: null });
    const row = await redis.hGetAll(attemptKey(puzzleKey(DAY, 0), 't2_u'));
    expect(row.status).toBe('u');
    expect(row.moves).toBe(longerMoves);
    expect(row.username).toBe('testuser');
  });

  test('rejects a divergent saved-move prefix without changing the attempt', async () => {
    const fx = await seedDay();
    const first = fx.pathMoves[0];
    if (first === undefined) throw new Error('empty fixture path');
    const wrong = encodeMoves([opposite(first)]);
    const key = attemptKey(puzzleKey(DAY, 0), 't2_u');
    await redis.hSet(key, { status: 'u', moves: wrong, username: 'testuser' });
    const response = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: encodeMoves(fx.pathMoves.slice(0, 2)),
      },
      clock()
    );
    expect(response.status).toBe('divergence');
    expect((await redis.hGetAll(key)).moves).toBe(wrong);
  });

  test('finish writes replay-derived attempt, aggregate, erosion and streak state', async () => {
    const fx = await seedDay();
    const response = await service().finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(response.status).toBe('ok');
    if (response.status !== 'ok') throw new Error('finish rejected');
    expect(response.result).toMatchObject({
      cost: fx.par,
      outcome: 'solved',
      par: fx.par,
      budget: fx.budget,
      trailblazer: true,
      completedAt: nowMs(),
    });
    expect(response.result.streak).toEqual({
      current: 1,
      best: 1,
      graceLeft: 1,
    });
    const pk = puzzleKey(DAY, 0);
    const row = await redis.hGetAll(attemptKey(pk, 't2_u'));
    expect(row).toMatchObject({
      status: 'f',
      moves: fx.solution,
      username: 'testuser',
      cost: String(fx.par),
      outcome: 'S',
      completedAt: String(nowMs()),
    });
    const stats = await redis.hGetAll(statsKey(pk));
    expect(stats.field).toBe('1');
    expect(stats.solved).toBe('1');
    expect(stats.b0).toBe('1');
    expect(await redis.hGetAll(costsKey(pk))).toEqual({
      [String(fx.par)]: '1',
    });
    const counters = await redis.hGetAll(countersKey(pk));
    expect(Object.keys(counters)).toHaveLength(new Set(fx.path).size);
    expect(counters[String(fx.path[0])]).toBe('1');
    expect(await redis.hGetAll(`em:streak:t2_u`)).toEqual({ [DAY]: '1' });
    const lb = await redis.zRange(leaderboardKey(pk), 0, -1);
    expect(lb).toHaveLength(1);
    expect(lb[0]?.member).toBe('t2_u');
    const fpKey = canonicalize(fx.path);
    const fp = routeToMoves(fx.maze.side, fpKey);
    expect(fp).toEqual(fx.pathMoves);
    expect(Object.keys(await redis.hGetAll(fingerprintsKey(pk)))).toHaveLength(
      1
    );
  });

  test('same-moves finish retry is idempotent and a different finish is already_finished', async () => {
    const fx = await seedDay();
    const svc = service();
    const first = await svc.finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(first.status).toBe('ok');
    const retry = await svc.finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(retry.status).toBe('ok');
    const stats = await redis.hGetAll(statsKey(puzzleKey(DAY, 0)));
    expect(stats.field).toBe('1');
    expect(stats.solved).toBe('1');
    const different = await svc.finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: detourSolution(fx),
      },
      clock()
    );
    expect(different.status).toBe('already_finished');
    expect((await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).field).toBe('1');
  });

  test('out-of-moves finishes write field, erosion and streak but no solved aggregates', async () => {
    const fx = await seedDay();
    const moves = oomMoves(fx);
    const response = await service().finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves,
      },
      clock()
    );
    expect(response.status).toBe('ok');
    if (response.status !== 'ok') throw new Error('finish rejected');
    expect(response.result.outcome).toBe('out-of-moves');
    expect(response.result.trailblazer).toBe(false);
    const pk = puzzleKey(DAY, 0);
    const stats = await redis.hGetAll(statsKey(pk));
    expect(stats.field).toBe('1');
    expect(stats.oom).toBe('1');
    expect(stats.solved).toBeUndefined();
    expect(await redis.hGetAll(costsKey(pk))).toEqual({});
    expect(await redis.zRange(leaderboardKey(pk), 0, -1)).toEqual([]);
    expect(await redis.hGetAll(fingerprintsKey(pk))).toEqual({});
    expect((await redis.hGetAll(attemptKey(pk, 't2_u'))).fp).toBeUndefined();
    expect(
      Object.keys(await redis.hGetAll(countersKey(pk))).length
    ).toBeGreaterThan(0);
    expect(await redis.hGetAll(`em:streak:t2_u`)).toEqual({ [DAY]: '1' });
  });

  test('finish mode rejects an unfinished replay before any write', async () => {
    const fx = await seedDay();
    const response = await service().finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: encodeMoves(fx.pathMoves.slice(0, 2)),
      },
      clock()
    );
    expect(response.status).toBe('unfinished');
    expect(await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).toEqual({});
  });

  test('a finishing progress submission uses the finish write plan', async () => {
    const fx = await seedDay();
    const response = await service().saveProgress(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(response.status).toBe('ok');
    if (response.status !== 'ok') throw new Error('progress rejected');
    expect(response.finished?.outcome).toBe('solved');
    expect((await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).field).toBe('1');
  });
});

describe('state loading and trailblazer ownership', () => {
  test('loadState returns the active maze and saved attempt state', async () => {
    const fx = await seedDay();
    const svc = service();
    const initial = await svc.loadState('t2_u', POST_ID, false, clock());
    expect(initial).toMatchObject({
      status: 'ok',
      day: DAY,
      dayNumber: 1,
      variant: 0,
      maze: fx.encoded,
      par: fx.par,
      budget: fx.budget,
      dayStatus: 'live',
      loggedIn: true,
      attempt: { kind: 'none' },
    });
    const moves = encodeMoves(fx.pathMoves.slice(0, 2));
    await svc.saveProgress('t2_u', POST_ID, { variant: 0, moves }, clock());
    const resumed = await svc.loadState('t2_u', POST_ID, false, clock());
    expect(resumed.status).toBe('ok');
    if (resumed.status !== 'ok') throw new Error('state load rejected');
    expect(resumed.attempt).toEqual({ kind: 'unfinished', moves });
  });

  test('only the first holder of a canonical route fingerprint is trailblazer', async () => {
    const fx = await seedDay();
    const svc = service();
    const first = await svc.finishAttempt(
      't2_first',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    const second = await svc.finishAttempt(
      't2_second',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    if (first.status !== 'ok' || second.status !== 'ok')
      throw new Error('finish rejected');
    expect(first.result.trailblazer).toBe(true);
    expect(second.result.trailblazer).toBe(false);
    expect(await redis.hLen(fingerprintsKey(puzzleKey(DAY, 0)))).toBe(1);
  });
});

describe('attempt concurrency and transactions', () => {
  test('concurrent same-user finish retries commit once', async () => {
    const fx = await seedDay();
    const svc = service();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        svc.finishAttempt(
          't2_u',
          POST_ID,
          {
            variant: 0,
            moves: fx.solution,
          },
          clock()
        )
      )
    );
    expect(responses.every((r) => r.status === 'ok')).toBe(true);
    expect((await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).field).toBe('1');
  });

  test('concurrent different-move finishes from one user commit at most one route', async () => {
    const fx = await seedDay();
    const svc = service();
    const responses = await Promise.all([
      svc.finishAttempt(
        't2_u',
        POST_ID,
        {
          variant: 0,
          moves: fx.solution,
        },
        clock()
      ),
      svc.finishAttempt(
        't2_u',
        POST_ID,
        {
          variant: 0,
          moves: detourSolution(fx),
        },
        clock()
      ),
    ]);
    expect(responses[0]?.status).toBe('ok');
    expect(responses[1]?.status).toBe('already_finished');
    expect((await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).field).toBe('1');
  });

  test('concurrent multi-user finishes count each distinct user once per cell', async () => {
    const fx = await seedDay();
    const svc = service();
    const users = Array.from({ length: 5 }, (_, i) => `t2_u${i}`);
    const responses = await Promise.all(
      users.map((userId) =>
        svc.finishAttempt(
          userId,
          POST_ID,
          {
            variant: 0,
            moves: fx.solution,
          },
          clock()
        )
      )
    );
    expect(responses.every((r) => r.status === 'ok')).toBe(true);
    const pk = puzzleKey(DAY, 0);
    expect((await redis.hGetAll(statsKey(pk))).field).toBe('5');
    const counters = await redis.hGetAll(countersKey(pk));
    expect(counters[String(fx.path[0])]).toBe('5');
    expect(counters[String(fx.path[fx.path.length - 1])]).toBe('5');
    expect(await redis.zRange(leaderboardKey(pk), 0, -1)).toHaveLength(5);
  });

  test('finish atomicity property over 1 to 50 users with 1 to 5 submissions each', async () => {
    let caseNumber = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 5 }),
        async (userCount, submissions) => {
          const variant = 10 + caseNumber;
          const postId = `t3_post_${variant}`;
          caseNumber += 1;
          const fx = await seedVariant(postId, variant);
          const svc = service();
          const requests = [];
          for (let u = 0; u < userCount; u++) {
            for (let r = 0; r < submissions; r++) {
              requests.push(
                svc.finishAttempt(
                  `t2_p${variant}_${u}`,
                  postId,
                  {
                    variant,
                    moves: fx.solution,
                  },
                  clock()
                )
              );
            }
          }
          const responses = await Promise.all(requests);
          expect(responses.every((r) => r.status === 'ok')).toBe(true);
          const pk = puzzleKey(DAY, variant);
          const stats = await redis.hGetAll(statsKey(pk));
          expect(stats.field).toBe(String(userCount));
          expect(stats.solved).toBe(String(userCount));
          const bucketTotal = Object.entries(stats)
            .filter(([field]) => field === 'oom' || /^b[0-9]+$/.test(field))
            .reduce((sum, [, value]) => sum + Number(value), 0);
          expect(bucketTotal).toBe(userCount);
          const counters = await redis.hGetAll(countersKey(pk));
          expect(counters[String(fx.path[0])]).toBe(String(userCount));
          expect(counters[String(fx.path[fx.path.length - 1])]).toBe(
            String(userCount)
          );
          expect(await redis.zRange(leaderboardKey(pk), 0, -1)).toHaveLength(
            userCount
          );
          expect(await redis.hLen(fingerprintsKey(pk))).toBe(1);
        }
      ),
      { numRuns: 3, seed: FC_SEED }
    );
  }, 30_000);

  test('watch aborts are retried and commit once', async () => {
    const fx = await seedDay();
    let aborts = 1;
    const realWatch = redis.watch.bind(redis);
    const wrapped = new Proxy(redis, {
      get(target, property, receiver) {
        if (property === 'watch') {
          return async (...keys: string[]) => {
            const tx = await realWatch(...keys);
            return new Proxy(tx, {
              get(txTarget, txProperty, txReceiver) {
                if (txProperty === 'exec' && aborts > 0) {
                  aborts -= 1;
                  return async () => [];
                }
                const value = Reflect.get(
                  txTarget,
                  txProperty,
                  txReceiver
                ) as unknown;
                return typeof value === 'function'
                  ? value.bind(txTarget)
                  : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof redis;
    const svc = createAttempts({
      redis: wrapped,
      username: 'testuser',
      followup: NOOP_FOLLOWUP,
    });
    const response = await svc.finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(response.status).toBe('ok');
    expect((await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).field).toBe('1');
  });

  test('an ambiguous finish error after exec is recovered by re-reading the attempt', async () => {
    const fx = await seedDay();
    let broken = true;
    const realWatch = redis.watch.bind(redis);
    const wrapped = new Proxy(redis, {
      get(target, property, receiver) {
        if (property === 'watch') {
          return async (...keys: string[]) => {
            const tx = await realWatch(...keys);
            return new Proxy(tx, {
              get(txTarget, txProperty, txReceiver) {
                const value = Reflect.get(
                  txTarget,
                  txProperty,
                  txReceiver
                ) as unknown;
                if (txProperty === 'exec' && broken) {
                  broken = false;
                  return async () => {
                    await (value as () => Promise<unknown>).call(txTarget);
                    throw new Error('connection lost after commit');
                  };
                }
                return typeof value === 'function'
                  ? value.bind(txTarget)
                  : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof redis;
    const svc = createAttempts({
      redis: wrapped,
      username: 'testuser',
      followup: NOOP_FOLLOWUP,
    });
    const response = await svc.finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(response.status).toBe('ok');
    expect((await redis.hGetAll(statsKey(puzzleKey(DAY, 0)))).field).toBe('1');
  });

  test('the finish follow-up is invoked after commit without changing the result', async () => {
    const fx = await seedDay();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const followup = vi.fn(() => {
      throw new Error('follow-up failed');
    });
    const svc = createAttempts({ redis, username: 'testuser', followup });
    const response = await svc.finishAttempt(
      't2_u',
      POST_ID,
      {
        variant: 0,
        moves: fx.solution,
      },
      clock()
    );
    expect(response.status).toBe('ok');
    expect(followup).toHaveBeenCalledTimes(1);
  });
});
