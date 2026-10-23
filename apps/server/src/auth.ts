import type { NextFunction, Request, Response } from 'express';
import type { User } from '@zhian/shared';
import { db } from './db.js';

export interface AuthedRequest extends Request {
  user?: User;
}

function resolveUser(req: AuthedRequest, res: Response): (User & { mustChangePassword: boolean }) | null {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ code: 'NO_TOKEN', message: '未登录' });
    return null;
  }
  const row = db
    // 外部身份用户的 username 是内部键，对外展示显示名
    .prepare('SELECT u.id, COALESCE(u.display_name, u.username) AS username, u.role, u.disabled, u.must_change_password FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?')
    .get(token) as { id: number; username: string; role: User['role']; disabled: number; must_change_password: number } | undefined;
  if (!row || row.disabled) {
    res.status(401).json({ code: 'BAD_TOKEN', message: row ? '账号已停用，请联系管理员' : '登录已失效' });
    return null;
  }
  return { id: row.id, username: row.username, role: row.role, mustChangePassword: row.must_change_password === 1 };
}

/** 一般接口：首次登录或密码被重置后，须先修改密码才能使用 */
export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  const user = resolveUser(req, res);
  if (!user) return;
  if (user.mustChangePassword) {
    res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', message: '请先修改初始密码' });
    return;
  }
  req.user = user;
  next();
}

/** 仅用于 /me 与修改密码：允许尚未修改初始密码的用户访问 */
export function authAllowPending(req: AuthedRequest, res: Response, next: NextFunction): void {
  const user = resolveUser(req, res);
  if (!user) return;
  req.user = user;
  next();
}

export function roleRequired(...roles: User['role'][]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ code: 'FORBIDDEN', message: '没有权限' });
      return;
    }
    next();
  };
}
