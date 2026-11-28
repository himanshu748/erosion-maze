import { context } from '@devvit/web/server';
import { Router, type Request, type Response } from 'express';
import type {
  ApiRejection,
  AttemptRequest,
  FinishResponse,
  ProgressResponse,
  StateResponse,
} from '../../shared/api';
import { finishAttempt, loadState, saveProgress } from '../core/attempts';

export const api = Router();

api.get('/state', async (req, res: Response<StateResponse>) => {
  const { postId, userId } = context;
  const result: StateResponse = postId
    ? await loadState(userId, postId, req.query.first === '1')
    : { status: 'maze_unavailable' };
  res.status(200).json(result);
});

function parseAttempt(body: unknown): AttemptRequest | null {
  if (
    !body ||
    typeof body !== 'object' ||
    !('variant' in body) ||
    typeof body.variant !== 'number' ||
    !Number.isSafeInteger(body.variant) ||
    body.variant < 0 ||
    !('moves' in body) ||
    typeof body.moves !== 'string'
  ) {
    return null;
  }
  return { variant: body.variant, moves: body.moves };
}

type AttemptHandler = typeof saveProgress | typeof finishAttempt;

function submit(handler: AttemptHandler) {
  return async (req: Request, res: Response<ProgressResponse | FinishResponse>) => {
    const { postId, userId } = context;
    if (!userId) {
      res.status(200).json({ status: 'sign_in_required' });
      return;
    }
    if (!postId) {
      res.status(200).json({ status: 'maze_unavailable' });
      return;
    }

    const attempt = parseAttempt(req.body);
    const result = attempt
      ? await handler(userId, postId, attempt)
      : { status: 'invalid_moves' } as const;
    res.status(200).json(result);
  };
}

api.post('/progress', submit(saveProgress));
api.post('/finish', submit(finishAttempt));

api.use((_req, res) => {
  const body: ApiRejection<'error'> = { status: 'error' };
  res.status(200).json(body);
});
