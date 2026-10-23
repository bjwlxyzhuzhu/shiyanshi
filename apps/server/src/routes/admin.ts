import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { BANK_VERSION, STEPS, defaultTerm, termLabel, type Role, type Term } from '@zhian/shared';
import { PRESETS, SettingsError, publicModelSettings, saveModelSettings } from '../ai/modelSettings.js';
import { authRequired, roleRequired, type AuthedRequest } from '../auth.js';
import { db, hashPassword, nowIso } from '../db.js';
import { callModelAudited } from '../ilab/aiAudit.js';
import { TEACHER_GRADES } from './learning.js';

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

function cleanCell(value: string | undefined, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

type ImportKind = 'student' | 'teacher';

interface ImportRowResult {
  line: number;
  username: string;
  name: string;
  /** 学生：班级、专业；教师：职称、院系 */
  col3: string;
  col4: string;
  status: 'create' | 'update' | 'skip' | 'error';
  message: string;
}

/** 导入学生或教师（分开导入，角色由导入类型决定，不能导入管理员） */
adminRouter.post('/users/import', adminOnly, (req: AuthedRequest, res) => {
  const kind: ImportKind | null = req.body?.kind === 'student' || req.body?.kind === 'teacher' ? req.body.kind : null;
  if (!kind) {
    res.status(400).json({ code: 'BAD_KIND', message: '请指定导入学生还是教师' });
    return;
  }
  const label = kind === 'student' ? '学号' : '工号';
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
      col3: cleanCell(cells[2], 40),
      col4: cleanCell(cells[3], 40),
      status: 'create',
      message: ''
    };
    if (!ACCOUNT_RE.test(result.username)) return { ...result, status: 'error', message: `${label}须为 3–32 位字母、数字或 _ . -` };
    if (!result.name) return { ...result, status: 'error', message: '缺少姓名' };
    if (kind === 'student' && !result.col3) return { ...result, status: 'error', message: '缺少班级（学生通过班级关联到课程）' };
    const key = result.username.toLowerCase();
    if (seen.has(key)) return { ...result, status: 'error', message: `文件内${label}重复` };
    seen.add(key);
    const existing = findUser.get(result.username) as { id: number; role: Role; external: number } | undefined;
    if (existing) {
      if (existing.external || existing.role !== kind) return { ...result, status: 'skip', message: '账号已存在且角色或来源不同，未改动' };
      return updateExisting
        ? { ...result, status: 'update', message: kind === 'student' ? '已存在：更新姓名、班级、专业（不改密码）' : '已存在：更新姓名、职称、院系（不改密码）' }
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
    res.json({ dryRun: true, kind, summary, rows });
    return;
  }

  const credentials: Array<{ username: string; name: string; role: string; password: string }> = [];
  const insert = kind === 'student'
    ? db.prepare(`INSERT INTO users (username, password_hash, role, points, created_at, display_name, class_name, major, must_change_password) VALUES (?, ?, 'student', 100, ?, ?, ?, ?, 1)`)
    : db.prepare(`INSERT INTO users (username, password_hash, role, points, created_at, display_name, title, department, must_change_password) VALUES (?, ?, 'teacher', 0, ?, ?, ?, ?, 1)`);
  const update = kind === 'student'
    ? db.prepare('UPDATE users SET display_name = ?, class_name = ?, major = ? WHERE username = ?')
    : db.prepare('UPDATE users SET display_name = ?, title = ?, department = ? WHERE username = ?');
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      if (row.status === 'create') {
        const password = generateInitialPassword();
        insert.run(row.username, hashPassword(password), nowIso(), row.name, row.col3 || null, row.col4 || null);
        credentials.push({ username: row.username, name: row.name, role: kind, password });
      } else if (row.status === 'update') {
        update.run(row.name, row.col3 || null, row.col4 || null, row.username);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  // 审计只记数量，不记姓名与密码
  audit(req.user!.id, `users.import.${kind}`, null, summary);
  res.json({ dryRun: false, kind, summary, rows, credentials });
});

// ---------------- 账号管理 ----------------

adminRouter.get('/users', adminOnly, (req, res) => {
  const role = String(req.query.role ?? '');
  const q = String(req.query.q ?? '').trim();
  const where: string[] = [];
  const params: string[] = [];
  if (['student', 'teacher', 'admin'].includes(role)) { where.push('role = ?'); params.push(role); }
  if (q) { where.push('(username LIKE ? OR display_name LIKE ? OR class_name LIKE ? OR department LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const users = db.prepare(`
    SELECT id, username, display_name AS name, role, class_name AS className, major, title, department, disabled, must_change_password AS mustChangePassword, external, last_login_at AS lastLoginAt, created_at AS createdAt
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

/** 教师能看到的教学班：所授课程关联的班级；管理员不受限（返回 null） */
function visibleClasses(user: { id: number; role: Role }, courseId: number | null): string[] | null {
  if (user.role === 'admin' && courseId === null) return null;
  const rows = courseId === null
    ? db.prepare('SELECT DISTINCT cc.class_name AS c FROM course_classes cc JOIN course_teachers ct ON ct.course_id = cc.course_id WHERE ct.user_id = ?').all(user.id)
    : user.role === 'admin'
      ? db.prepare('SELECT class_name AS c FROM course_classes WHERE course_id = ?').all(courseId)
      : db.prepare('SELECT cc.class_name AS c FROM course_classes cc JOIN course_teachers ct ON ct.course_id = cc.course_id WHERE ct.user_id = ? AND cc.course_id = ?').all(user.id, courseId);
  return (rows as Array<{ c: string }>).map((row) => row.c);
}

adminRouter.get('/results', roleRequired('teacher', 'admin'), (req: AuthedRequest, res) => {
  const className = String(req.query.className ?? '').trim();
  const courseId = Number(req.query.courseId) > 0 ? Number(req.query.courseId) : null;
  const allowed = visibleClasses(req.user!, courseId);
  const classFilter = className ? (allowed === null || allowed.includes(className) ? [className] : []) : allowed;
  if (classFilter !== null && classFilter.length === 0) {
    res.json({ bankVersion: BANK_VERSION, totalSteps: STEPS.length, classes: allowed ?? [], results: [] });
    return;
  }
  const rows = db.prepare(`
    SELECT s.id AS sessionId, u.username, COALESCE(u.display_name, u.username) AS name, u.class_name AS className, u.major,
           s.source, s.started_at AS startedAt, s.finished_at AS finishedAt, s.total_score AS totalScore,
           (SELECT COUNT(*) FROM step_records r WHERE r.session_id = s.id) AS stepsDone,
           (SELECT COUNT(*) FROM step_records r WHERE r.session_id = s.id AND (r.bank_version IS NULL OR r.bank_version <> ?)) AS legacySteps,
           (SELECT MAX(p.correct) FROM prelab_attempts p WHERE p.user_id = u.id) AS prelabBest,
           tr.grade AS teacherGrade, tr.comment AS teacherComment
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN teacher_reviews tr ON tr.session_id = s.id
    WHERE u.role = 'student' ${classFilter === null ? '' : `AND u.class_name IN (${classFilter.map(() => '?').join(', ')})`}
    ORDER BY u.class_name, u.username, s.id DESC LIMIT 5000
  `).all(BANK_VERSION, ...(classFilter ?? []));
  const classes = allowed ?? (db.prepare("SELECT DISTINCT class_name AS c FROM users WHERE role = 'student' AND class_name IS NOT NULL ORDER BY c").all() as Array<{ c: string }>).map((row) => row.c);
  res.json({ bankVersion: BANK_VERSION, totalSteps: STEPS.length, classes, results: rows });
});

/** 教师评价（成绩类型“教师评价报告”）：等级 + 评语，按会话保存，可修改 */
adminRouter.put('/results/:sessionId/review', roleRequired('teacher', 'admin'), (req: AuthedRequest, res) => {
  const sessionId = Number(req.params.sessionId);
  const exists = db.prepare("SELECT s.id, u.class_name AS className FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND u.role = 'student'").get(sessionId) as { id: number; className: string | null } | undefined;
  const allowed = exists ? visibleClasses(req.user!, null) : null;
  if (!exists || (allowed !== null && !allowed.includes(exists.className ?? ''))) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  const grade = String(req.body?.grade ?? '');
  if (!(TEACHER_GRADES as readonly string[]).includes(grade)) {
    res.status(400).json({ code: 'BAD_GRADE', message: `评价等级只能是：${TEACHER_GRADES.join('、')}` });
    return;
  }
  const comment = cleanCell(String(req.body?.comment ?? ''), 500);
  db.prepare(`
    INSERT INTO teacher_reviews (session_id, teacher_id, grade, comment, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET teacher_id = excluded.teacher_id, grade = excluded.grade, comment = excluded.comment, updated_at = excluded.updated_at
  `).run(sessionId, req.user!.id, grade, comment, nowIso());
  audit(req.user!.id, 'results.review', String(sessionId), { grade });
  res.json({ ok: true, grade, comment });
});

// ---------------- AI 审计与伦理（管理员） ----------------

/**
 * 伦理与可信可控的运行证据：模型调用与兜底情况、输出过滤命中、算法公平性监测。
 * 公平性监测：按专业比较已完成实验的平均分，样本足够（每组 ≥10）且差距 >10 分时提示复核评分规则与题目表述。
 */
adminRouter.get('/ai-audit', adminOnly, (_req, res) => {
  const byScenario = db.prepare(`
    SELECT COALESCE(scenario, '') AS scenario, COUNT(DISTINCT invocation_id) AS calls,
           SUM(CASE WHEN dispatch_state = 'response_received' THEN 1 ELSE 0 END) AS received,
           SUM(CASE WHEN dispatch_state IN ('http_error', 'timeout', 'network_error', 'bad_body') THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN dispatch_state = 'not_configured' THEN 1 ELSE 0 END) AS notConfigured,
           SUM(CASE WHEN final_source = 'rule' THEN 1 ELSE 0 END) AS ruleFallback,
           SUM(COALESCE(prompt_tokens, 0)) AS promptTokens, SUM(COALESCE(completion_tokens, 0)) AS completionTokens
    FROM ai_invocations GROUP BY scenario ORDER BY calls DESC
  `).all();
  const notes = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN text LIKE '%[已过滤]%' THEN 1 ELSE 0 END) AS filtered, SUM(CASE WHEN source = 'model' THEN 1 ELSE 0 END) AS model FROM tutor_notes").get() as { total: number; filtered: number | null; model: number | null };
  const groups = db.prepare(`
    SELECT COALESCE(u.major, '未填写专业') AS major, COUNT(*) AS n, AVG(s.total_score) AS mean
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE u.role = 'student' AND s.finished_at IS NOT NULL GROUP BY major ORDER BY n DESC
  `).all() as Array<{ major: string; n: number; mean: number }>;
  const eligible = groups.filter((group) => group.n >= 10);
  const gap = eligible.length >= 2 ? Math.max(...eligible.map((g) => g.mean)) - Math.min(...eligible.map((g) => g.mean)) : null;
  res.json({
    byScenario,
    tutor: { total: Number(notes.total), filtered: Number(notes.filtered ?? 0), fromModel: Number(notes.model ?? 0) },
    fairness: {
      groups: groups.map((group) => ({ major: group.major, n: group.n, mean: Number(Number(group.mean).toFixed(1)) })),
      gap: gap === null ? null : Number(gap.toFixed(1)),
      threshold: 10,
      minGroupSize: 10,
      flagged: gap !== null && gap > 10
    }
  });
});

// ---------------- 学期与课程 ----------------

const TERM_KEY = 'current_term';

export function currentTerm(): Term {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(TERM_KEY) as { value_json: string } | undefined;
  if (row) {
    try {
      const term = JSON.parse(row.value_json) as Term;
      if (Number.isInteger(term.startYear) && (term.termNo === 1 || term.termNo === 2)) return term;
    } catch {
      // 配置损坏时回退到按日期推算
    }
  }
  return defaultTerm();
}

function parseTerm(body: Record<string, unknown> | undefined): Term | null {
  const startYear = Number(body?.startYear);
  const termNo = Number(body?.termNo);
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100 || (termNo !== 1 && termNo !== 2)) return null;
  return { startYear, termNo };
}

adminRouter.get('/term', roleRequired('teacher', 'admin'), (_req, res) => {
  const term = currentTerm();
  res.json({ term, label: termLabel(term) });
});

adminRouter.put('/term', adminOnly, (req: AuthedRequest, res) => {
  const term = parseTerm(req.body);
  if (!term) {
    res.status(400).json({ code: 'BAD_TERM', message: '学期格式不正确：起始年份 2000–2100，第一或第二学期' });
    return;
  }
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(TERM_KEY, JSON.stringify(term), req.user!.id, nowIso());
  audit(req.user!.id, 'term.update', termLabel(term));
  res.json({ term, label: termLabel(term) });
});

interface CourseRow {
  id: number;
  code: string;
  name: string;
  category: string;
  termStartYear: number;
  termNo: 1 | 2;
  totalHours: number | null;
  credits: number | null;
}

function courseView(row: CourseRow) {
  const teachers = db.prepare(`SELECT u.id, u.username, COALESCE(u.display_name, u.username) AS name FROM course_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.course_id = ? ORDER BY u.username`).all(row.id);
  const classes = (db.prepare('SELECT class_name AS c FROM course_classes WHERE course_id = ? ORDER BY class_name').all(row.id) as Array<{ c: string }>).map((item) => item.c);
  const students = classes.length
    ? Number((db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND class_name IN (${classes.map(() => '?').join(', ')})`).get(...classes) as { n: number }).n)
    : 0;
  return { ...row, termLabel: termLabel({ startYear: row.termStartYear, termNo: row.termNo }), teachers, classes, students };
}

const COURSE_COLUMNS = 'id, code, name, category, term_start_year AS termStartYear, term_no AS termNo, total_hours AS totalHours, credits';

/** 课程列表：管理员看全部，教师只看自己任课的课程；默认当前学期 */
adminRouter.get('/courses', roleRequired('teacher', 'admin'), (req: AuthedRequest, res) => {
  const term = parseTerm({ startYear: req.query.startYear, termNo: req.query.termNo }) ?? currentTerm();
  const rows = (req.user!.role === 'admin'
    ? db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses WHERE term_start_year = ? AND term_no = ? ORDER BY name, code`).all(term.startYear, term.termNo)
    : db.prepare(`SELECT ${COURSE_COLUMNS.split(', ').map((col) => `c.${col}`).join(', ')} FROM courses c JOIN course_teachers ct ON ct.course_id = c.id WHERE ct.user_id = ? AND c.term_start_year = ? AND c.term_no = ? ORDER BY c.name, c.code`).all(req.user!.id, term.startYear, term.termNo)) as unknown as CourseRow[];
  res.json({ term, label: termLabel(term), courses: rows.map(courseView) });
});

function parseCourse(body: Record<string, unknown> | undefined): { course: Omit<CourseRow, 'id'>; teacherIds: number[]; classes: string[] } | { error: string; field: string } {
  const code = cleanCell(String(body?.code ?? ''), 40);
  const name = cleanCell(String(body?.name ?? ''), 60);
  const term = parseTerm({ startYear: body?.termStartYear, termNo: body?.termNo });
  if (!code) return { error: '请填写课程序号', field: 'code' };
  if (!name) return { error: '请填写课程名称', field: 'name' };
  if (!term) return { error: '请选择学期', field: 'term' };
  const hours = body?.totalHours === '' || body?.totalHours === null || body?.totalHours === undefined ? null : Number(body.totalHours);
  const credits = body?.credits === '' || body?.credits === null || body?.credits === undefined ? null : Number(body.credits);
  if (hours !== null && (!Number.isInteger(hours) || hours < 0 || hours > 1000)) return { error: '总课时应为 0–1000 的整数', field: 'totalHours' };
  if (credits !== null && (!Number.isFinite(credits) || credits < 0 || credits > 30)) return { error: '学分应在 0–30 之间', field: 'credits' };
  const teacherIds = [...new Set((Array.isArray(body?.teacherIds) ? body!.teacherIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!teacherIds.length) return { error: '请至少选择一位任课教师', field: 'teacherIds' };
  const valid = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'teacher' AND id IN (${teacherIds.map(() => '?').join(', ')})`).get(...teacherIds) as { n: number };
  if (Number(valid.n) !== teacherIds.length) return { error: '任课教师须为已导入的教师账号', field: 'teacherIds' };
  const classes = [...new Set((Array.isArray(body?.classes) ? body!.classes : String(body?.classes ?? '').split(/[,，、\n]/))
    .map((item) => cleanCell(String(item), 40)).filter(Boolean))];
  if (!classes.length) return { error: '请至少填写一个教学班', field: 'classes' };
  return {
    course: { code, name, category: cleanCell(String(body?.category ?? ''), 30), termStartYear: term.startYear, termNo: term.termNo, totalHours: hours, credits },
    teacherIds,
    classes
  };
}

function saveLinks(courseId: number, teacherIds: number[], classes: string[]): void {
  db.prepare('DELETE FROM course_teachers WHERE course_id = ?').run(courseId);
  db.prepare('DELETE FROM course_classes WHERE course_id = ?').run(courseId);
  const addTeacher = db.prepare('INSERT INTO course_teachers (course_id, user_id) VALUES (?, ?)');
  const addClass = db.prepare('INSERT INTO course_classes (course_id, class_name) VALUES (?, ?)');
  for (const id of teacherIds) addTeacher.run(courseId, id);
  for (const name of classes) addClass.run(courseId, name);
}

adminRouter.post('/courses', adminOnly, (req: AuthedRequest, res) => {
  const parsed = parseCourse(req.body);
  if ('error' in parsed) {
    res.status(400).json({ code: 'BAD_COURSE', field: parsed.field, message: parsed.error });
    return;
  }
  const { course, teacherIds, classes } = parsed;
  const duplicate = db.prepare('SELECT id FROM courses WHERE code = ? AND term_start_year = ? AND term_no = ?').get(course.code, course.termStartYear, course.termNo);
  if (duplicate) {
    res.status(409).json({ code: 'DUPLICATE', field: 'code', message: '该学期已有相同课程序号' });
    return;
  }
  db.exec('BEGIN');
  try {
    const id = Number(db.prepare('INSERT INTO courses (code, name, category, term_start_year, term_no, total_hours, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(course.code, course.name, course.category, course.termStartYear, course.termNo, course.totalHours, course.credits, nowIso()).lastInsertRowid);
    saveLinks(id, teacherIds, classes);
    db.exec('COMMIT');
    audit(req.user!.id, 'courses.create', String(id));
    res.json({ course: courseView({ id, ...course }) });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

adminRouter.put('/courses/:id', adminOnly, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM courses WHERE id = ?').get(id)) {
    res.status(404).json({ code: 'NO_COURSE', message: '课程不存在' });
    return;
  }
  const parsed = parseCourse(req.body);
  if ('error' in parsed) {
    res.status(400).json({ code: 'BAD_COURSE', field: parsed.field, message: parsed.error });
    return;
  }
  const { course, teacherIds, classes } = parsed;
  const duplicate = db.prepare('SELECT id FROM courses WHERE code = ? AND term_start_year = ? AND term_no = ? AND id <> ?').get(course.code, course.termStartYear, course.termNo, id);
  if (duplicate) {
    res.status(409).json({ code: 'DUPLICATE', field: 'code', message: '该学期已有相同课程序号' });
    return;
  }
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE courses SET code = ?, name = ?, category = ?, term_start_year = ?, term_no = ?, total_hours = ?, credits = ? WHERE id = ?')
      .run(course.code, course.name, course.category, course.termStartYear, course.termNo, course.totalHours, course.credits, id);
    saveLinks(id, teacherIds, classes);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  audit(req.user!.id, 'courses.update', String(id));
  res.json({ course: courseView({ id, ...course }) });
});

adminRouter.delete('/courses/:id', adminOnly, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM course_teachers WHERE course_id = ?').run(id);
  db.prepare('DELETE FROM course_classes WHERE course_id = ?').run(id);
  const info = db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  if (!info.changes) {
    res.status(404).json({ code: 'NO_COURSE', message: '课程不存在' });
    return;
  }
  audit(req.user!.id, 'courses.delete', String(id));
  res.json({ ok: true });
});
