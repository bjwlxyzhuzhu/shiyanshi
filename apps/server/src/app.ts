import cors from 'cors';
import express from 'express';
import { ilabApiRouter, launchRouter } from './ilab/routes.js';
import { redactUrl } from './ilab/signature.js';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { experimentRouter } from './routes/experiment.js';
import { learningRouter } from './routes/learning.js';
import { authRequired } from './auth.js';
import { netRouter, presenceRouter, requireSeat } from './presence.js';

export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'zhian', now: new Date().toISOString() });
  });

  // 实验空间入口在 /api 之外，由 Vite 与学校反向代理转发到本服务
  app.use('/ilab', launchRouter);
  app.use('/api/ilab', ilabApiRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/presence', presenceRouter);
  app.use('/api/net', netRouter);
  // 实验与 AI 接口受并发闸门保护：超出承诺并发数时返回排队信息（题库列表除外）
  app.use('/api/experiment', (req, res, next) => (req.method === 'GET' && req.path === '/steps' ? next() : authRequired(req, res, () => requireSeat(req, res, next))));
  app.use('/api/experiment', experimentRouter);
  app.use('/api/ai', authRequired, requireSeat);
  app.use('/api/ai', aiRouter);
  app.use('/api/learning', learningRouter);

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // 错误日志只记录脱敏后的路径，不输出 ticket/token
    console.error('[zhian] unhandled error', redactUrl(req.originalUrl), err instanceof Error ? err.message : 'error');
    res.status(500).json({ code: 'INTERNAL', message: '服务器内部错误' });
  });

  return app;
}
