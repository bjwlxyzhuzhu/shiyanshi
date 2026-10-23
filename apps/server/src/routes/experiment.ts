import { Router } from 'express';
import { BANK_VERSION, getStep, nextStepId, STEPS, type SessionState, type StepInput } from '@zhian/shared';
import { buildProfile, evaluateStep } from '@zhian/scoring';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db, nowIso } from '../db.js';
import { ilabConfig } from '../ilab/config.js';
import { latestContextForUser } from '../ilab/identity.js';
import { createBoundSession } from '../ilab/routes.js';
import { EVENT_TYPES, attemptByRequest, recordAttempt, recordEvent, type StepEventType } from '../ilab/telemetry.js';
import { sha256Hex } from '../ilab/signature.js';

export const experimentRouter = Router();

interface SessionRow {
  id: number;
  user_id: number;
  total_score: number;
  current_step_id: string;
  finished_at: string | null;
  locked: number;
  ilab_context_id: number | null;
}

interface RecordRow {
  step_id: string;
  score: number;
  max_score: number;
}

function records(sessionId: number): Array<{ stepId: string; score: number; maxScore: number }> {
  const rows = db
    .prepare('SELECT step_id, score, max_score FROM step_records WHERE session_id = ? ORDER BY id')
    .all(sessionId) as unknown as RecordRow[];
  return rows.map((row) => ({ stepId: row.step_id, score: Number(row.score), maxScore: Number(row.max_score) }));
}

function findSession(sessionId: number, userId: number): SessionRow | undefined {
  return db
    .prepare('SELECT id, user_id, total_score, current_step_id, finished_at, locked, ilab_context_id FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId) as SessionRow | undefined;
}

function loadSession(sessionId: number, userId: number): SessionState | null {
  const session = findSession(sessionId, userId);
  if (!session) return null;
  return {
    sessionId: session.id,
    currentStepId: session.current_step_id,
    totalScore: Number(Number(session.total_score).toFixed(1)),
    finished: session.finished_at !== null,
    stepRecords: records(sessionId)
  };
}

experimentRouter.get('/steps', (_req, res) => {
  res.json({ steps: STEPS });
});

/** 实时预览：只返回仿真曲线与脱敏样例，不返回得分与判定，学生可边调参数边观察。 */
experimentRouter.post('/preview/:stepId', authRequired, (req, res) => {
  const stepId = String(req.params.stepId);
  if (!getStep(stepId)) {
    res.status(400).json({ code: 'BAD_STEP', message: '步骤不存在' });
    return;
  }
  const { result } = evaluateStep(stepId, (req.body?.input ?? {}) as StepInput);
  res.json({ chart: result.chart ?? null, preview: result.preview ?? null, image: result.image ?? null });
});

/** 从实验空间进入的用户：新会话绑定其当前环境的外部上下文；本地账号行为不变 */
function boundContextFor(userId: number): number | null {
  const context = latestContextForUser(userId);
  return context && context.environment === ilabConfig().mode ? context.id : null;
}

experimentRouter.post('/start', authRequired, (req: AuthedRequest, res) => {
  const user = req.user!;
  const contextId = boundContextFor(user.id);
  const sessionId = contextId
    ? createBoundSession(user.id, contextId)
    : Number(db
      .prepare('INSERT INTO sessions (user_id, started_at, current_step_id, started_ms) VALUES (?, ?, ?, ?)')
      .run(user.id, nowIso(), 'S01', Date.now()).lastInsertRowid);
  res.json(loadSession(sessionId, user.id));
});

/**
 * 过程事件：打开/关闭设备面板、首次改动输入（前端限频）、页面隐藏/恢复。
 * 时间以服务器收到为准；不逐帧上报。已锁定（已回传）的会话不再记录。
 */
experimentRouter.post('/:id/events', authRequired, (req: AuthedRequest, res) => {
  const session = findSession(Number(req.params.id), req.user!.id);
  if (!session) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  if (session.locked) {
    res.status(409).json({ code: 'LOCKED', message: '该实验记录已提交到实验空间，只读' });
    return;
  }
  const events = Array.isArray(req.body?.events) ? (req.body.events as Array<{ stepId?: unknown; type?: unknown }>).slice(0, 20) : [];
  let accepted = 0;
  const now = Date.now();
  for (const event of events) {
    const stepId = String(event.stepId ?? '');
    const type = String(event.type ?? '') as StepEventType;
    if (!getStep(stepId) || !(EVENT_TYPES as readonly string[]).includes(type)) continue;
    recordEvent(session.id, stepId, type, now);
    accepted += 1;
  }
  res.json({ accepted });
});

/** 恢复进度：返回每一步的输入、结果与反馈，刷新页面后可继续实验。 */
experimentRouter.get('/:id/records', authRequired, (req: AuthedRequest, res) => {
  const sessionId = Number(req.params.id);
  if (!findSession(sessionId, req.user!.id)) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  const rows = db
    .prepare('SELECT step_id, input_json, output_json, score, max_score, bank_version FROM step_records WHERE session_id = ? ORDER BY id')
    .all(sessionId) as unknown as Array<{ step_id: string; input_json: string; output_json: string; score: number; max_score: number; bank_version: string | null }>;
  res.json({
    bankVersion: BANK_VERSION,
    records: rows.map((row) => {
      const output = JSON.parse(row.output_json) as { result?: Record<string, unknown>; feedback?: string };
      return {
        stepId: row.step_id,
        input: JSON.parse(row.input_json) as StepInput,
        score: Number(row.score),
        maxScore: Number(row.max_score),
        result: output.result ?? {},
        feedback: output.feedback ?? '',
        // NULL 为 2026-10-23 产业规程修正前的旧题库记录：只读展示，重新提交按新题库评分
        bankVersion: row.bank_version ?? 'v1'
      };
    })
  });
});

experimentRouter.get('/:id', authRequired, (req: AuthedRequest, res) => {
  const state = loadSession(Number(req.params.id), req.user!.id);
  if (!state) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  res.json(state);
});

experimentRouter.post('/:id/reset', authRequired, (req: AuthedRequest, res) => {
  const user = req.user!;
  const sessionId = Number(req.params.id);
  const existing = findSession(sessionId, user.id);
  if (!existing) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  // 绑定实验空间的会话不清空历史证据：重做时创建新的真实会话与新 originId
  if (existing.ilab_context_id) {
    const contextId = boundContextFor(user.id);
    if (!contextId) {
      res.status(409).json({ code: 'REENTRY_REQUIRED', message: '请从实验空间重新进入后开始新的实验' });
      return;
    }
    res.json(loadSession(createBoundSession(user.id, contextId), user.id));
    return;
  }
  db.prepare('DELETE FROM step_records WHERE session_id = ?').run(sessionId);
  db.prepare('UPDATE sessions SET total_score = 0, current_step_id = ?, finished_at = NULL WHERE id = ?').run('S01', sessionId);
  res.json(loadSession(sessionId, user.id));
});

experimentRouter.post('/:id/step/:stepId', authRequired, (req: AuthedRequest, res) => {
  const user = req.user!;
  const sessionId = Number(req.params.id);
  const stepId = String(req.params.stepId);
  const session = findSession(sessionId, user.id);
  if (!session) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  const step = getStep(stepId);
  if (!step) {
    res.status(400).json({ code: 'BAD_STEP', message: '步骤不存在' });
    return;
  }

  if (session.locked) {
    res.status(409).json({ code: 'LOCKED', message: '该实验记录已提交到实验空间，只读；如需重做请开始新的实验' });
    return;
  }

  const input = (req.body?.input ?? {}) as StepInput;
  const requestId = typeof req.body?.requestId === 'string' && /^[\w-]{8,64}$/.test(req.body.requestId) ? req.body.requestId as string : null;
  // 幂等：同一 requestId 的重复请求直接返回首次结果，不增加尝试次数
  if (requestId) {
    const previous = attemptByRequest(sessionId, requestId);
    if (previous) {
      res.json(JSON.parse(previous.result_json));
      return;
    }
  }
  const startedAt = Date.now();
  const evaluation = evaluateStep(stepId, input);
  const score = Number((step.maxScore * evaluation.ratio).toFixed(1));
  const result = stepId === 'S24'
    ? { ...evaluation.result, profile: buildProfile(records(sessionId)) }
    : evaluation.result;

  db.prepare('DELETE FROM step_records WHERE session_id = ? AND step_id = ?').run(sessionId, stepId);
  db.prepare(`
    INSERT INTO step_records (session_id, step_id, input_json, output_json, score, max_score, duration_ms, created_at, bank_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    stepId,
    JSON.stringify(input),
    JSON.stringify({ result, feedback: evaluation.feedback }),
    score,
    step.maxScore,
    Date.now() - startedAt,
    nowIso(),
    BANK_VERSION
  );

  const totalScore = Number(records(sessionId).reduce((sum, record) => sum + record.score, 0).toFixed(1));
  const next = nextStepId(stepId);
  const finished = next === null;
  db.prepare('UPDATE sessions SET total_score = ?, current_step_id = ?, finished_at = ? WHERE id = ?')
    .run(totalScore, next ?? stepId, finished ? nowIso() : null, sessionId);

  const response = { stepId, score, maxScore: step.maxScore, result, feedback: evaluation.feedback, nextStepId: next };
  // 追加式尝试记录：起止来自服务器观测的过程事件；duration_ms 只是判分耗时，不作为学习用时
  recordAttempt({
    sessionId,
    stepId,
    requestId,
    submitMs: startedAt,
    inputHash: sha256Hex(JSON.stringify(input)),
    rawScore: score,
    rawMaxScore: step.maxScore,
    resultJson: JSON.stringify(response)
  });
  res.json(response);
});
