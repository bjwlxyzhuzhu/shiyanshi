import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { passwordPolicyIssues, type LoginResponse } from '@zhian/shared';
import { authAllowPending, type AuthedRequest } from '../auth.js';
import { db, hashPassword, nowIso, verifyPassword } from '../db.js';

export const authRouter = Router();

interface LoginRow {
  id: number;
  username: string;
  display_name: string | null;
  password_hash: string;
  role: LoginResponse['user']['role'];
  disabled: number;
  must_change_password: number;
  external: number;
}

authRouter.post('/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password) {
    res.status(400).json({ code: 'BAD_INPUT', message: '请输入用户名和密码' });
    return;
  }

  const user = db
    .prepare('SELECT id, username, display_name, password_hash, role, disabled, must_change_password, external FROM users WHERE username = ?')
    .get(username) as LoginRow | undefined;

  // 外部身份（实验空间）用户没有本地密码，不能走本地登录
  if (!user || user.external || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ code: 'BAD_CREDENTIAL', message: '用户名或密码错误' });
    return;
  }
  if (user.disabled) {
    res.status(403).json({ code: 'DISABLED', message: '账号已停用，请联系管理员' });
    return;
  }

  const token = randomUUID();
  db.prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, nowIso());
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);

  const payload: LoginResponse = {
    token,
    user: { id: user.id, username: user.display_name ?? user.username, role: user.role, mustChangePassword: user.must_change_password === 1 }
  };
  res.json(payload);
});

authRouter.get('/me', authAllowPending, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

/** 修改密码：校验原密码与密码策略；成功后注销其他设备上的登录 */
authRouter.post('/change-password', authAllowPending, (req: AuthedRequest, res) => {
  const oldPassword = String(req.body?.oldPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const row = db.prepare('SELECT username, password_hash, external FROM users WHERE id = ?').get(req.user!.id) as { username: string; password_hash: string; external: number } | undefined;
  if (!row || row.external) {
    res.status(400).json({ code: 'NOT_LOCAL', message: '该账号由实验空间登录，无本地密码' });
    return;
  }
  if (!verifyPassword(oldPassword, row.password_hash)) {
    res.status(400).json({ code: 'BAD_OLD_PASSWORD', message: '原密码不正确' });
    return;
  }
  const issues = passwordPolicyIssues(newPassword, row.username);
  if (oldPassword === newPassword) issues.push('不能与原密码相同');
  if (issues.length) {
    res.status(400).json({ code: 'WEAK_PASSWORD', message: `新密码需要：${issues.join('、')}`, issues });
    return;
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(newPassword), req.user!.id);
  const current = req.headers.authorization?.slice(7) ?? '';
  db.prepare('DELETE FROM tokens WHERE user_id = ? AND token <> ?').run(req.user!.id, current);
  res.json({ ok: true, user: { ...req.user, mustChangePassword: false } });
});
