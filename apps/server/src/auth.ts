import type { NextFunction, Request, Response } from 'express';
import type { User } from '@zhian/shared';
import { db } from './db.js';

export interface AuthedRequest extends Request {
  user?: User;
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ code: 'NO_TOKEN', message: '未登录' });
    return;
  }
  const row = db
    // 外部身份用户的 username 是内部键，对外展示显示名
    .prepare('SELECT u.id, COALESCE(u.display_name, u.username) AS username, u.role FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?')
    .get(token) as { id: number; username: string; role: User['role'] } | undefined;
  if (!row) {
    res.status(401).json({ code: 'BAD_TOKEN', message: '登录已失效' });
    return;
  }
  req.user = { id: row.id, username: row.username, role: row.role };
  next();
}
