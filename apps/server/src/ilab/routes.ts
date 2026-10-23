import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { User } from '@zhian/shared';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db, nowIso } from '../db.js';
import { effectiveModelMeta } from '../ai/modelSettings.js';
import { ilabConfig, productionReadiness } from './config.js';
import { bindIdentity, clientFor, consumeHandoff, createContext, createHandoff, getContext, markTicketSeen } from './identity.js';
import { mockIlab } from './mockClient.js';
import { finalizeSession, getSession, latestReport, reconcile, retryAttachment, sessionSyncStatus, uploadSnapshot } from './outbox.js';
import { newOriginId, rawQueryParam, redactUrl } from './signature.js';

const HANDOFF_COOKIE = 'zhian_ilab_handoff';

/** 创建绑定外部上下文的新实验会话：服务端记录真实开始时间与唯一 originId */
export function createBoundSession(userId: number, contextId: number): number {
  const context = getContext(contextId)!;
  const info = db.prepare(`
    INSERT INTO sessions (user_id, started_at, current_step_id, source, ilab_context_id, origin_id, started_ms)
    VALUES (?, ?, 'S01', ?, ?, ?, ?)
  `).run(userId, nowIso(), context.synthetic ? 'synthetic' : 'ilab', contextId, newOriginId(context.environment), Date.now());
  return Number(info.lastInsertRowid);
}

function redirectWithError(res: Response, reason: string): void {
  const config = ilabConfig();
  res.redirect(303, `${config.publicOrigin}${config.postLaunchPath}?ilab_error=${encodeURIComponent(reason)}`);
}

/**
 * 实验空间入口：GET /ilab/launch?ticket=...
 * 收到 ticket 立即换票（约 2 分钟有效），不等待前端资源；完成后 303 到不含 ticket 的地址。
 */
export const launchRouter = Router();

launchRouter.get('/launch', async (req: Request, res: Response) => {
  const config = ilabConfig();
  const rawTicket = rawQueryParam(req.originalUrl, 'ticket');
  console.log(`[ilab] launch ${redactUrl(req.originalUrl)} mode=${config.mode}`);
  if (!rawTicket) return redirectWithError(res, 'missing_ticket');
  if (!markTicketSeen(rawTicket)) return redirectWithError(res, 'ticket_replayed');

  const client = clientFor(config.mode);
  let result: Awaited<ReturnType<typeof client.exchangeTicket>>;
  try {
    result = await client.exchangeTicket(rawTicket);
  } catch (error) {
    console.warn('[ilab] exchange unavailable:', error instanceof Error ? error.message : 'error');
    return redirectWithError(res, 'exchange_unavailable');
  }
  if (!('grant' in result)) {
    const error = result.error;
    const reason = error.kind === 'business_error'
      ? ({ 1: 'bad_params', 2: 'bad_signature', 3: 'ticket_expired', 4: 'ticket_invalid' } as Record<number, string>)[error.code] ?? `code_${error.code}`
      : error.kind === 'unknown' ? `network_${error.reason}` : 'unknown';
    console.warn(`[ilab] exchange failed: ${reason}`);
    return redirectWithError(res, reason);
  }
  if (!result.grant.un) return redirectWithError(res, 'missing_un');

  const { identityId, userId } = bindIdentity(config.mode, client.appid, result.grant.un, result.grant.dis);
  const contextId = createContext(identityId, config.mode, client.appid, result.grant);
  const code = createHandoff(contextId, userId);
  const secure = config.publicOrigin.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${HANDOFF_COOKIE}=${code}; HttpOnly; SameSite=Lax; Path=/api/ilab; Max-Age=${config.handoffTtlSeconds}${secure}`);
  res.redirect(303, `${config.publicOrigin}${config.postLaunchPath}?ilab=1`);
});

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

export const ilabApiRouter = Router();

/** handoff → 本系统 Bearer 令牌；浏览器永远拿不到 ILAB access_token 或 SECRET */
ilabApiRouter.post('/bootstrap', (req: Request, res: Response) => {
  const code = readCookie(req, HANDOFF_COOKIE);
  res.setHeader('Set-Cookie', `${HANDOFF_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/ilab; Max-Age=0`);
  const handoff = code ? consumeHandoff(code) : null;
  if (!handoff) {
    res.status(401).json({ code: 'HANDOFF_INVALID', message: '实验空间登录信息已失效，请从实验空间重新进入' });
    return;
  }
  const context = getContext(handoff.contextId)!;
  const user = db.prepare('SELECT id, role, display_name FROM users WHERE id = ?').get(handoff.userId) as { id: number; role: User['role']; display_name: string | null };
  const token = randomUUID();
  db.prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, nowIso());
  const sessionId = createBoundSession(user.id, context.id);
  res.json({
    token,
    user: { id: user.id, username: user.display_name ?? context.un, role: user.role },
    sessionId,
    ilab: { environment: context.environment, synthetic: context.synthetic === 1 }
  });
});

function ownedSession(req: AuthedRequest, res: Response) {
  const session = getSession(Number(req.params.id));
  if (!session || session.user_id !== req.user!.id) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return null;
  }
  return session;
}

ilabApiRouter.get('/sessions/:id/status', authRequired, (req: AuthedRequest, res) => {
  const session = ownedSession(req, res);
  if (session) res.json(sessionSyncStatus(session.id));
});

ilabApiRouter.post('/sessions/:id/finalize', authRequired, async (req: AuthedRequest, res, next) => {
  const session = ownedSession(req, res);
  if (!session) return;
  if (req.body?.confirm !== true) {
    res.status(400).json({ code: 'CONFIRM_REQUIRED', message: '请确认结束实验后再提交' });
    return;
  }
  try {
    res.json(await finalizeSession(session.id));
  } catch (error) {
    next(error);
  }
});

ilabApiRouter.post('/sessions/:id/reconcile', authRequired, async (req: AuthedRequest, res, next) => {
  const session = ownedSession(req, res);
  if (!session) return;
  try {
    res.json(await reconcile(session.id));
  } catch (error) {
    next(error);
  }
});

ilabApiRouter.post('/sessions/:id/attachment/retry', authRequired, async (req: AuthedRequest, res, next) => {
  const session = ownedSession(req, res);
  if (!session) return;
  try {
    res.json(await retryAttachment(session.id));
  } catch (error) {
    next(error);
  }
});

ilabApiRouter.post('/sessions/:id/snapshot', authRequired, async (req: AuthedRequest, res, next) => {
  const session = ownedSession(req, res);
  if (!session) return;
  try {
    res.json(await uploadSnapshot(session.id));
  } catch (error) {
    next(error);
  }
});

ilabApiRouter.get('/sessions/:id/report.pdf', authRequired, (req: AuthedRequest, res) => {
  const session = ownedSession(req, res);
  if (!session) return;
  const report = latestReport(session.id);
  if (!report) {
    res.status(404).json({ code: 'NO_REPORT', message: '报告文件尚未生成' });
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${report.filename}"`);
  res.send(Buffer.from(report.bytes));
});

/** 生产就绪清单（教师/管理员）：只显示是否已配置/已确认，不含任何密钥值 */
ilabApiRouter.get('/readiness', authRequired, (req: AuthedRequest, res) => {
  if (req.user!.role === 'student') {
    res.status(403).json({ code: 'FORBIDDEN', message: '仅教师或管理员可查看' });
    return;
  }
  const config = ilabConfig();
  // 模型元数据以管理员配置为准（其次是环境变量）
  res.json({ mode: config.mode, networkEnabled: config.networkEnabled, items: productionReadiness({ ...config, aiModel: effectiveModelMeta() ?? config.aiModel }) });
});

/** 仅 mock 模式：生成合成 ticket 的入口地址，用于本地演示完整进入流程 */
ilabApiRouter.post('/mock/launch-url', (req: Request, res: Response) => {
  const config = ilabConfig();
  if (config.mode !== 'mock') {
    res.status(404).json({ code: 'NOT_MOCK', message: '仅模拟模式可用' });
    return;
  }
  const un = String(req.body?.un ?? 'synthetic_student_01').replace(/[^\w.-]/g, '').slice(0, 40) || 'synthetic_student_01';
  const ticket = mockIlab.issueTicket(un, `合成学生 ${un.slice(-2)}`);
  res.json({ url: `/ilab/launch?ticket=${encodeURIComponent(ticket)}`, synthetic: true });
});
