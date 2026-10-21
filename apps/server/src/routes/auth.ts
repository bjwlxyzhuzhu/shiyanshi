import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { LoginResponse } from '@zhian/shared';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db, nowIso, verifyPassword } from '../db.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password) {
    res.status(400).json({ code: 'BAD_INPUT', message: '请输入用户名和密码' });
    return;
  }

  const user = db
    .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; password_hash: string; role: LoginResponse['user']['role'] } | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ code: 'BAD_CREDENTIAL', message: '用户名或密码错误' });
    return;
  }

  const token = randomUUID();
  db.prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, nowIso());

  const payload: LoginResponse = {
    token,
    user: { id: user.id, username: user.username, role: user.role }
  };
  res.json(payload);
});

authRouter.get('/me', authRequired, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});
