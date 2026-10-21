import './env.js';
import cors from 'cors';
import express from 'express';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { experimentRouter } from './routes/experiment.js';

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'zhian', now: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/experiment', experimentRouter);
app.use('/api/ai', aiRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[zhian] unhandled error', err);
  res.status(500).json({ code: 'INTERNAL', message: '服务器内部错误' });
});

const port = Number(process.env.API_PORT ?? 8788);
app.listen(port, () => {
  console.log(`[zhian] server listening on http://localhost:${port}`);
});
