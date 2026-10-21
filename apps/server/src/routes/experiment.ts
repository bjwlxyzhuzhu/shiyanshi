import { Router } from 'express';
import { getStep, nextStepId, STEPS, type SessionState, type StepInput } from '@zhian/shared';
import { buildProfile, evaluateStep } from '@zhian/scoring';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db, nowIso } from '../db.js';

export const experimentRouter = Router();

interface SessionRow {
  id: number;
  user_id: number;
  total_score: number;
  current_step_id: string;
  finished_at: string | null;
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
    .prepare('SELECT id, user_id, total_score, current_step_id, finished_at FROM sessions WHERE id = ? AND user_id = ?')
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
  res.json({ chart: result.chart ?? null, preview: result.preview ?? null });
});

experimentRouter.post('/start', authRequired, (req: AuthedRequest, res) => {
  const user = req.user!;
  const info = db
    .prepare('INSERT INTO sessions (user_id, started_at, current_step_id) VALUES (?, ?, ?)')
    .run(user.id, nowIso(), 'S01');
  res.json(loadSession(Number(info.lastInsertRowid), user.id));
});

/** 恢复进度：返回每一步的输入、结果与反馈，刷新页面后可继续实验。 */
experimentRouter.get('/:id/records', authRequired, (req: AuthedRequest, res) => {
  const sessionId = Number(req.params.id);
  if (!findSession(sessionId, req.user!.id)) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  const rows = db
    .prepare('SELECT step_id, input_json, output_json, score, max_score FROM step_records WHERE session_id = ? ORDER BY id')
    .all(sessionId) as unknown as Array<{ step_id: string; input_json: string; output_json: string; score: number; max_score: number }>;
  res.json({
    records: rows.map((row) => {
      const output = JSON.parse(row.output_json) as { result?: Record<string, unknown>; feedback?: string };
      return {
        stepId: row.step_id,
        input: JSON.parse(row.input_json) as StepInput,
        score: Number(row.score),
        maxScore: Number(row.max_score),
        result: output.result ?? {},
        feedback: output.feedback ?? ''
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
  if (!findSession(sessionId, user.id)) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
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

  const input = (req.body?.input ?? {}) as StepInput;
  const startedAt = Date.now();
  const evaluation = evaluateStep(stepId, input);
  const score = Number((step.maxScore * evaluation.ratio).toFixed(1));
  const result = stepId === 'S24'
    ? { ...evaluation.result, profile: buildProfile(records(sessionId)) }
    : evaluation.result;

  db.prepare('DELETE FROM step_records WHERE session_id = ? AND step_id = ?').run(sessionId, stepId);
  db.prepare(`
    INSERT INTO step_records (session_id, step_id, input_json, output_json, score, max_score, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    stepId,
    JSON.stringify(input),
    JSON.stringify({ result, feedback: evaluation.feedback }),
    score,
    step.maxScore,
    Date.now() - startedAt,
    nowIso()
  );

  const totalScore = Number(records(sessionId).reduce((sum, record) => sum + record.score, 0).toFixed(1));
  const next = nextStepId(stepId);
  const finished = next === null;
  db.prepare('UPDATE sessions SET total_score = ?, current_step_id = ?, finished_at = ? WHERE id = ?')
    .run(totalScore, next ?? stepId, finished ? nowIso() : null, sessionId);

  res.json({ stepId, score, maxScore: step.maxScore, result, feedback: evaluation.feedback, nextStepId: next });
});
