import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { BANK_VERSION, STEPS, type Role } from '@zhian/shared';
import { PRESETS, SettingsError, publicModelSettings, saveModelSettings } from '../ai/modelSettings.js';
import { authRequired, roleRequired, type AuthedRequest } from '../auth.js';
import { db, hashPassword, nowIso } from '../db.js';
import { callModelAudited } from '../ilab/aiAudit.js';

/**
 * 管理员后台：大模型配置、师生名单导入与账号管理；教师可查看学生成绩。
 * 生成的初始密码只在本次响应中返回一次，服务器只保存散列。
 */
export const adminRouter = Router();
adminRouter.use(authRequired);

const adminOnly = roleRequired('admin');

function audit(actorId: number, action: string, target: string | null, detail: Record<string, unknown> = {}): void {
  db.prepare('INSERT INTO admin_audit (actor_id, action, target, detail_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(actorId, action, target, JSON.stringify(detail), nowIso());
}

// ---------------- 大模型配置 ----------------

adminRouter.get('/model', adminOnly, (_req, res) => {
  res.json({ settings: publicModelSettings(), presets: PRESETS });
});

adminRouter.put('/model', adminOnly, (req: AuthedRequest, res) => {
  try {
    res.json({ settings: saveModelSettings(req.body ?? {}, req.user!.id) });
  } catch (error) {
    if (error instanceof SettingsError) {
      res.status(400).json({ code: 'BAD_SETTINGS', field: error.field, message: error.message });
      return;
    }
    throw error;
  }
});

/** 连通性测试：固定的无个人信息提示词；记入 AI 审计但不关联任何实验会话，不计入学生的 AI 调用 */
adminRouter.post('/model/test', adminOnly, async (req: AuthedRequest, res) => {
  const started = Date.now();
  const call = await callModelAudited(
    [
      { role: 'system', content: '这是接口连通性检查。' },
      { role: 'user', content: '请只回复四个字：连接正常' }
    ],
    { sessionId: null, userId: req.user!.id, stepId: '', scenario: 'admin:connectivity_test' },
    { timeoutMs: 20000, maxAttempts: 1 }
  );
  const row = db.prepare('SELECT dispatch_state, upstream_http_status, provider_model, configured_model FROM ai_invocations WHERE invocation_id = ? ORDER BY id DESC LIMIT 1')
    .get(call.invocationId) as { dispatch_state: string; upstream_http_status: number | null; provider_model: string | null; configured_model: string | null } | undefined;
  audit(req.user!.id, 'model_settings.test', null, { state: row?.dispatch_state ?? 'unknown', status: row?.upstream_http_status ?? null });
  res.json({
    ok: Boolean(call.text),
    state: row?.dispatch_state ?? 'unknown',
    httpStatus: row?.upstream_http_status ?? null,
    configuredModel: row?.configured_model ?? null,
    providerModel: row?.provider_model ?? null,
    latencyMs: Date.now() - started,
    reply: call.text ? call.text.slice(0, 60) : null
  });
});

// ---------------- 师生名单导入 ----------------

const ACCOUNT_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const MAX_ROWS = 2000;
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 12 位一次性初始密码：去掉易混字符，保证同时含字母和数字 */
export function generateInitialPassword(): string {
  for (;;) {
    let value = '';
    for (let i = 0; i < 12; i++) value += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) return value;
  }
}

/** 解析 CSV / 制表符 / 中文逗号分隔的文本，支持双引号字段 */
export function parseTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const line = rawLine.includes('\t') ? rawLine : rawLine.replace(/，/g, ',');
    const separator = line.includes('\t') ? '\t' : ',';
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === separator) { cells.push(cell.trim()); cell = ''; }
      else cell += ch;
    }
    cells.push(cell.trim());
    rows.push(cells);
  }
  return rows;
}

function parseRole(value: string): Exclude<Role, 'admin'> | null {
  const v = value.trim().toLowerCase();
  if (['学生', 'student', 's'].includes(v)) return 'student';
  if (['教师', '老师', 'teacher', 't'].includes(v)) return 'teacher';
  return null;
}

function cleanCell(value: string | undefined, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

interface ImportRowResult {
  line: number;
  username: string;
  name: string;
  role: string;
  className: string;
  major: string;
  status: 'create' | 'update' | 'skip' | 'error';
  message: string;
}

adminRouter.post('/users/import', adminOnly, (req: AuthedRequest, res) => {
  const text = String(req.body?.text ?? '');
  const dryRun = req.body?.dryRun !== false;
  const updateExisting = req.body?.updateExisting === true;
  const table = parseTable(text);
  if (table.length && /账号|学号|工号|username/i.test(table[0]![0] ?? '')) table.shift();
  if (!table.length) {
    res.status(400).json({ code: 'EMPTY', message: '没有可导入的数据行' });
    return;
  }
  if (table.length > MAX_ROWS) {
    res.status(400).json({ code: 'TOO_MANY', message: `一次最多导入 ${MAX_ROWS} 行` });
    return;
  }

  const seen = new Set<string>();
  const findUser = db.prepare('SELECT id, role, external FROM users WHERE username = ?');
  const rows: ImportRowResult[] = table.map((cells, index) => {
    const result: ImportRowResult = {
      line: index + 1,
      username: cleanCell(cells[0], 32),
      name: cleanCell(cells[1], 32),
      role: cleanCell(cells[2], 10),
      className: cleanCell(cells[3], 40),
      major: cleanCell(cells[4], 40),
      status: 'create',
      message: ''
    };
    const role = parseRole(result.role);
    if (!ACCOUNT_RE.test(result.username)) return { ...result, status: 'error', message: '账号须为 3–32 位字母、数字或 _ . -' };
    if (!result.name) return { ...result, status: 'error', message: '缺少姓名' };
    if (!role) return { ...result, status: 'error', message: '角色只能是“学生”或“教师”（管理员不能批量导入）' };
    result.role = role;
    const key = result.username.toLowerCase();
    if (seen.has(key)) return { ...result, status: 'error', message: '文件内账号重复' };
    seen.add(key);
    const existing = findUser.get(result.username) as { id: number; role: Role; external: number } | undefined;
    if (existing) {
      if (existing.external || existing.role !== role) return { ...result, status: 'skip', message: '账号已存在且角色或来源不同，未改动' };
      return updateExisting
        ? { ...result, status: 'update', message: '已存在：更新姓名、班级、专业（不改密码）' }
        : { ...result, status: 'skip', message: '账号已存在，已跳过' };
    }
    return result;
  });

  const summary = {
    create: rows.filter((row) => row.status === 'create').length,
    update: rows.filter((row) => row.status === 'update').length,
    skip: rows.filter((row) => row.status === 'skip').length,
    error: rows.filter((row) => row.status === 'error').length
  };
  if (dryRun) {
    res.json({ dryRun: true, summary, rows });
    return;
  }

  const credentials: Array<{ username: string; name: string; role: string; password: string }> = [];
  const insert = db.prepare(`
    INSERT INTO users (username, password_hash, role, points, created_at, display_name, class_name, major, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const update = db.prepare('UPDATE users SET display_name = ?, class_name = ?, major = ? WHERE username = ?');
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      if (row.status === 'create') {
        const password = generateInitialPassword();
        insert.run(row.username, hashPassword(password), row.role, row.role === 'student' ? 100 : 0, nowIso(), row.name, row.className || null, row.major || null);
        credentials.push({ username: row.username, name: row.name, role: row.role, password });
      } else if (row.status === 'update') {
        update.run(row.name, row.className || null, row.major || null, row.username);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  // 审计只记数量，不记姓名与密码
  audit(req.user!.id, 'users.import', null, summary);
  res.json({ dryRun: false, summary, rows, credentials });
});

// ---------------- 账号管理 ----------------

adminRouter.get('/users', adminOnly, (req, res) => {
  const role = String(req.query.role ?? '');
  const q = String(req.query.q ?? '').trim();
  const where: string[] = [];
  const params: string[] = [];
  if (['student', 'teacher', 'admin'].includes(role)) { where.push('role = ?'); params.push(role); }
  if (q) { where.push('(username LIKE ? OR display_name LIKE ? OR class_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const users = db.prepare(`
    SELECT id, username, display_name AS name, role, class_name AS className, major, disabled, must_change_password AS mustChangePassword, external, last_login_at AS lastLoginAt, created_at AS createdAt
    FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY role, class_name, username LIMIT 1000
  `).all(...params);
  res.json({ users });
});

function targetUser(id: number): { id: number; username: string; role: Role; external: number } | undefined {
  return db.prepare('SELECT id, username, role, external FROM users WHERE id = ?').get(id) as { id: number; username: string; role: Role; external: number } | undefined;
}

adminRouter.post('/users/:id/reset-password', adminOnly, (req: AuthedRequest, res) => {
  const user = targetUser(Number(req.params.id));
  if (!user || user.external) {
    res.status(404).json({ code: 'NO_USER', message: '账号不存在或为实验空间登录账号' });
    return;
  }
  if (user.id === req.user!.id) {
    res.status(400).json({ code: 'SELF', message: '请在“修改密码”中修改自己的密码' });
    return;
  }
  const password = generateInitialPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(password), user.id);
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(user.id);
  audit(req.user!.id, 'users.reset_password', String(user.id));
  res.json({ username: user.username, password });
});

adminRouter.post('/users/:id/status', adminOnly, (req: AuthedRequest, res) => {
  const user = targetUser(Number(req.params.id));
  if (!user) {
    res.status(404).json({ code: 'NO_USER', message: '账号不存在' });
    return;
  }
  if (user.id === req.user!.id || user.role === 'admin') {
    res.status(400).json({ code: 'PROTECTED', message: '不能停用管理员账号' });
    return;
  }
  const disabled = req.body?.disabled === true;
  db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
  if (disabled) db.prepare('DELETE FROM tokens WHERE user_id = ?').run(user.id);
  audit(req.user!.id, disabled ? 'users.disable' : 'users.enable', String(user.id));
  res.json({ ok: true, disabled });
});

// ---------------- 成绩查看（教师、管理员） ----------------

adminRouter.get('/results', roleRequired('teacher', 'admin'), (req, res) => {
  const className = String(req.query.className ?? '').trim();
  const rows = db.prepare(`
    SELECT s.id AS sessionId, u.username, COALESCE(u.display_name, u.username) AS name, u.class_name AS className, u.major,
           s.source, s.started_at AS startedAt, s.finished_at AS finishedAt, s.total_score AS totalScore,
           (SELECT COUNT(*) FROM step_records r WHERE r.session_id = s.id) AS stepsDone,
           (SELECT COUNT(*) FROM step_records r WHERE r.session_id = s.id AND (r.bank_version IS NULL OR r.bank_version <> ?)) AS legacySteps
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE u.role = 'student' ${className ? 'AND u.class_name = ?' : ''}
    ORDER BY u.class_name, u.username, s.id DESC LIMIT 5000
  `).all(...(className ? [BANK_VERSION, className] : [BANK_VERSION]));
  const classes = (db.prepare("SELECT DISTINCT class_name AS c FROM users WHERE role = 'student' AND class_name IS NOT NULL ORDER BY c").all() as Array<{ c: string }>).map((row) => row.c);
  res.json({ bankVersion: BANK_VERSION, totalSteps: STEPS.length, classes, results: rows });
});
