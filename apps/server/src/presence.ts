import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Response } from 'express';
import { authRequired, type AuthedRequest } from './auth.js';

/**
 * 并发控制与排队提示：承诺并发数以内的实验请求及时响应，超出时排队并提示位置。
 * 席位按用户分配，心跳超时自动释放；排队者需定期轮询，长时间不轮询视为离开。
 * 状态保存在进程内存（单实例部署）；多实例部署需改为共享存储。
 */
const SEAT_TTL_MS = 90_000;
const QUEUE_TTL_MS = 30_000;

interface QueueEntry {
  userId: number;
  joinedMs: number;
  lastPollMs: number;
}

const seats = new Map<number, number>();
let queue: QueueEntry[] = [];

export function concurrencyLimit(): number {
  const value = Number(process.env.CONCURRENCY_LIMIT ?? 200);
  return Number.isInteger(value) && value > 0 ? value : 200;
}

function purge(now: number): void {
  for (const [userId, lastSeen] of seats) if (now - lastSeen > SEAT_TTL_MS) seats.delete(userId);
  queue = queue.filter((entry) => now - entry.lastPollMs <= QUEUE_TTL_MS && !seats.has(entry.userId));
}

export interface SeatStatus {
  admitted: boolean;
  position?: number;
  waiting: number;
  active: number;
  limit: number;
  estimatedWaitSec?: number;
}

/** 申请或刷新席位；排在队首且有空位时才放行，保证先到先得 */
export function requestSeat(userId: number, now = Date.now()): SeatStatus {
  purge(now);
  const limit = concurrencyLimit();
  if (seats.has(userId)) {
    seats.set(userId, now);
    return { admitted: true, waiting: queue.length, active: seats.size, limit };
  }
  let entry = queue.find((item) => item.userId === userId);
  if (!entry) {
    entry = { userId, joinedMs: now, lastPollMs: now };
    queue.push(entry);
  }
  entry.lastPollMs = now;
  const position = queue.indexOf(entry) + 1;
  if (seats.size < limit && position === 1) {
    queue.shift();
    seats.set(userId, now);
    return { admitted: true, waiting: queue.length, active: seats.size, limit };
  }
  // 粗略估计：每个席位平均约 45 分钟完成一次实验，按队列位置折算
  const estimatedWaitSec = Math.round((position / Math.max(1, limit)) * 45 * 60);
  return { admitted: false, position, waiting: queue.length, active: seats.size, limit, estimatedWaitSec };
}

export function releaseSeat(userId: number): void {
  seats.delete(userId);
  queue = queue.filter((entry) => entry.userId !== userId);
}

/** 仅测试使用 */
export function resetPresence(): void {
  seats.clear();
  queue = [];
}

/** 实验接口的并发闸门：已占席位或有空位才放行，否则返回 429 与排队信息 */
export function requireSeat(req: AuthedRequest, res: Response, next: NextFunction): void {
  const status = requestSeat(req.user!.id);
  if (status.admitted) {
    next();
    return;
  }
  res.status(429).json({ code: 'QUEUED', message: `当前在线人数已达上限，您排在第 ${status.position} 位`, ...status });
}

export const presenceRouter = Router();

presenceRouter.post('/enter', authRequired, (req: AuthedRequest, res) => {
  res.json(requestSeat(req.user!.id));
});

presenceRouter.post('/heartbeat', authRequired, (req: AuthedRequest, res) => {
  res.json(requestSeat(req.user!.id));
});

presenceRouter.post('/leave', authRequired, (req: AuthedRequest, res) => {
  releaseSeat(req.user!.id);
  res.json({ released: true });
});

/** 公开的负载概况（不含任何用户信息），供入口页与运维查看 */
presenceRouter.get('/status', (_req, res) => {
  purge(Date.now());
  res.json({ active: seats.size, waiting: queue.length, limit: concurrencyLimit() });
});

/** 带宽测试服务：延迟探测与下载测速，不缓存 */
export const netRouter = Router();

netRouter.get('/ping', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ now: Date.now() });
});

netRouter.get('/probe', (req, res) => {
  const kb = Math.min(2048, Math.max(16, Number(req.query.kb) || 512));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(randomBytes(kb * 1024));
});
