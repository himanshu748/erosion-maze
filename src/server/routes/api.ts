import { Router } from 'express';
import type { ApiStatus } from '../../shared/api';

export const api = Router();

api.use((_req, res) => {
  const body: { status: ApiStatus } = { status: 'error' };
  res.json(body);
});
