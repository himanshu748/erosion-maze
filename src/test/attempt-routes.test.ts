import type { Request, Response } from 'express';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../server/routes/api';

const mocked = vi.hoisted(() => ({
  identity: {
    postId: 't3_ranked' as string | undefined,
    userId: 't2_player' as string | undefined,
  },
  loadState: vi.fn(),
  saveProgress: vi.fn(),
  finishAttempt: vi.fn(),
}));

vi.mock('@devvit/web/server', () => ({ context: mocked.identity }));
vi.mock('../server/core/attempts', () => ({
  loadState: mocked.loadState,
  saveProgress: mocked.saveProgress,
  finishAttempt: mocked.finishAttempt,
}));

function request(method: 'GET' | 'POST', url: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const query = Object.fromEntries(
      new URL(url, 'http://localhost').searchParams
    );
    const req = { method, url, originalUrl: url, query, body } as Request;
    let status = 200;
    const res = {
      status(value: number) {
        status = value;
        return this;
      },
      json(result: unknown) {
        resolve({ status, body: result });
        return this;
      },
    } as Response;
    api(req, res, (error?: unknown) => {
      reject(error ?? new Error('Request fell through the API router'));
    });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.identity.postId = 't3_ranked';
  mocked.identity.userId = 't2_player';
});

test('state uses Devvit identity and honors the first-load query', async () => {
  mocked.loadState.mockResolvedValue({ status: 'maze_unavailable' });

  expect(
    await request('GET', '/state?first=1&postId=t3_other&userId=t2_other')
  ).toEqual({ status: 200, body: { status: 'maze_unavailable' } });
  expect(mocked.loadState).toHaveBeenCalledExactlyOnceWith(
    't2_player',
    't3_ranked',
    true
  );
});

test('state remains readable signed out and does not invent a missing post', async () => {
  mocked.identity.userId = undefined;
  mocked.loadState.mockResolvedValue({ status: 'maze_unavailable' });

  await request('GET', '/state');
  expect(mocked.loadState).toHaveBeenCalledExactlyOnceWith(
    undefined,
    't3_ranked',
    false
  );

  mocked.loadState.mockClear();
  mocked.identity.postId = undefined;
  expect(await request('GET', '/state?postId=t3_other')).toEqual({
    status: 200,
    body: { status: 'maze_unavailable' },
  });
  expect(mocked.loadState).not.toHaveBeenCalled();
});

test('progress forwards only the move sequence and variant under the Devvit identity', async () => {
  const saved = { status: 'ok', newClaim: true, finished: null };
  mocked.saveProgress.mockResolvedValue(saved);

  expect(
    await request('POST', '/progress', {
      variant: 0,
      moves: 'AAABA',
      userId: 't2_other',
      postId: 't3_other',
      cost: 0,
      outcome: 'solved',
    })
  ).toEqual({ status: 200, body: saved });
  expect(mocked.saveProgress).toHaveBeenCalledExactlyOnceWith(
    't2_player',
    't3_ranked',
    { variant: 0, moves: 'AAABA' }
  );
});

test('finish dispatches to server replay and returns its rejection at HTTP 200', async () => {
  const rejection = { status: 'unfinished' };
  const attempt = { variant: 1, moves: 'AAABA' };
  mocked.finishAttempt.mockResolvedValue(rejection);

  expect(await request('POST', '/finish', attempt)).toEqual({
    status: 200,
    body: rejection,
  });
  expect(mocked.finishAttempt).toHaveBeenCalledExactlyOnceWith(
    't2_player',
    't3_ranked',
    attempt
  );
});

test('mutations require a signed-in user and trusted post context', async () => {
  const attempt = { variant: 0, moves: 'AAABA', userId: 't2_spoof' };
  mocked.identity.userId = undefined;
  expect(await request('POST', '/finish', attempt)).toEqual({
    status: 200,
    body: { status: 'sign_in_required' },
  });
  expect(mocked.finishAttempt).not.toHaveBeenCalled();

  mocked.identity.userId = 't2_player';
  mocked.identity.postId = undefined;
  expect(await request('POST', '/progress?postId=t3_spoof', attempt)).toEqual({
    status: 200,
    body: { status: 'maze_unavailable' },
  });
  expect(mocked.saveProgress).not.toHaveBeenCalled();
});

test.each([
  { body: undefined },
  { body: null },
  { body: { variant: '0', moves: 'AAABA' } },
  { body: { variant: -1, moves: 'AAABA' } },
  { body: { variant: 0.5, moves: 'AAABA' } },
  { body: { variant: 0, moves: ['AAABA'] } },
])('progress rejects malformed body $body at HTTP 200', async ({ body }) => {
  expect(await request('POST', '/progress', body)).toEqual({
    status: 200,
    body: { status: 'invalid_moves' },
  });
  expect(mocked.saveProgress).not.toHaveBeenCalled();
});

test('an unknown API route returns the typed fallback at HTTP 200', async () => {
  expect(await request('GET', '/unknown')).toEqual({
    status: 200,
    body: { status: 'error' },
  });
});
