import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { internal } from './routes/internal';

const app = express();
app.use(express.json());
app.use('/api', api);
app.use('/internal', internal);

// Crashes still answer HTTP 200: browsers log failed requests at error level (Req 26.8).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.warn(
    'unhandled server error:',
    err instanceof Error ? err.message : String(err)
  );
  if (!res.headersSent) res.status(200).json({ status: 'error' });
});

const server = createServer(app);
server.on('error', (err) => console.warn('server error:', err.message));
server.listen(getServerPort());
