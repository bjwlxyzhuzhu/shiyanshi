import { Router } from 'express';
import { COURSES, KNOWLEDGE_POINTS, buildLadder, buildProfile } from '@zhian/shared';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db } from '../db.js';

/**
 * 过程评价与成长档案。过程指标只描述学习过程，不改变 100 分制成绩；
 * 成长档案汇总同一账号的历次实验，形成动态能力画像。
 */
export const learningRouter = Router();

export interface ProcessSummary {
  submittedSteps: number;
  interactionSteps: number;
  totalAttempts: number;
  retriedSteps: string[];
  activeMinutes: number | null;
  wallMinutes: number | null;
  hintsUsed: number;
  tutorRequests: number;
  reviewRequests: number;
  legacySteps: number;
}

export function processSummary(sessionId: number): ProcessSummary {
  const attempts = db.prepare('SELECT step_id, observed_start_ms, observed_end_ms, active_ms, evidence_quality FROM step_attempts WHERE session_id = ?').all(sessionId) as unknown as Array<{ step_id: string; observed_start_ms: number | null; observed_end_ms: number; active_ms: number | null; evidence_quality: string }>;
  const records = db.prepare('SELECT step_id FROM step_records WHERE session_id = ?').all(sessionId) as Array<{ step_id: string }>;
  const perStep = new Map<string, number>();
  for (const attempt of attempts) perStep.set(attempt.step_id, (perStep.get(attempt.step_id) ?? 0) + 1);
  const starts = attempts.map((attempt) => attempt.observed_start_ms).filter((value): value is number => value !== null);
  const ends = attempts.map((attempt) => attempt.observed_end_ms);
  const activeKnown = attempts.filter((attempt) => attempt.active_ms !== null);
  const count = (sql: string) => Number((db.prepare(sql).get(sessionId) as { c: number }).c);
  return {
    submittedSteps: records.length,
    interactionSteps: new Set(attempts.filter((attempt) => attempt.evidence_quality === 'observed_interaction').map((attempt) => attempt.step_id)).size,
    totalAttempts: attempts.length,
    retriedSteps: [...perStep.entries()].filter(([, n]) => n > 1).map(([stepId]) => stepId).sort(),
    activeMinutes: activeKnown.length ? Math.round(activeKnown.reduce((sum, attempt) => sum + attempt.active_ms!, 0) / 6000) / 10 : null,
    wallMinutes: starts.length ? Math.round((Math.max(...ends) - Math.min(...starts)) / 6000) / 10 : null,
    hintsUsed: count("SELECT COUNT(*) AS c FROM step_events WHERE session_id = ? AND type = 'hint'"),
    tutorRequests: count('SELECT COUNT(*) AS c FROM tutor_notes WHERE session_id = ?'),
    reviewRequests: count("SELECT COUNT(*) AS c FROM ai_logs WHERE session_id = ? AND agent LIKE 'review:%'"),
    legacySteps: records.filter((record) => !perStep.has(record.step_id)).length
  };
}

learningRouter.get('/sessions/:id/process', authRequired, (req: AuthedRequest, res) => {
  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user!.id);
  if (!session) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }
  res.json(processSummary(Number(req.params.id)));
});

/** 成长档案：本人历次实验（只读，不含他人数据） */
learningRouter.get('/archive', authRequired, (req: AuthedRequest, res) => {
  const sessions = db.prepare('SELECT id, started_at, finished_at, total_score, source, origin_id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.user!.id) as unknown as Array<{ id: number; started_at: string; finished_at: string | null; total_score: number; source: string; origin_id: string | null }>;
  const items = sessions.map((session) => {
    const rows = db.prepare('SELECT step_id, score, max_score FROM step_records WHERE session_id = ?').all(session.id) as unknown as Array<{ step_id: string; score: number; max_score: number }>;
    const records = rows.map((row) => ({ stepId: row.step_id, score: Number(row.score), maxScore: Number(row.max_score) }));
    return {
      sessionId: session.id,
      startedAt: session.started_at,
      finished: session.finished_at !== null,
      totalScore: Number(Number(session.total_score).toFixed(1)),
      submittedSteps: records.length,
      source: session.source,
      profile: buildProfile(records),
      ladder: buildLadder(records)
    };
  });
  res.json({ sessions: items });
});

/** 报告共用：阶梯能力、过程评价、课程覆盖、导师反思（均为模板文字，不调用模型） */
export function reportSections(sessionId: number): string[] {
  const rows = db.prepare('SELECT step_id, score, max_score FROM step_records WHERE session_id = ?').all(sessionId) as unknown as Array<{ step_id: string; score: number; max_score: number }>;
  const records = rows.map((row) => ({ stepId: row.step_id, score: Number(row.score), maxScore: Number(row.max_score) }));
  const ladder = buildLadder(records);
  const process = processSummary(sessionId);
  const courses = COURSES.map((course) => {
    const points = KNOWLEDGE_POINTS.filter((point) => point.course === course.id);
    const covered = points.filter((point) => point.steps.some((stepId) => records.some((record) => record.stepId === stepId)));
    return `${course.name}：覆盖知识点 ${covered.length}/${points.length}`;
  });
  const reflection = db.prepare("SELECT text, source FROM tutor_notes WHERE session_id = ? AND phase = 'post' ORDER BY id DESC LIMIT 1").get(sessionId) as { text: string; source: string } | undefined;
  return [
    '## 阶梯能力达成',
    ...ladder.map((level) => `- ${level.id} ${level.name}：${level.score}/${level.max}（${Math.round(level.ratio * 100)}%），${level.status}（已提交 ${level.submitted}/${level.total} 步）`),
    '',
    '## 过程评价（不计入成绩）',
    `- 有实际交互证据的步骤：${process.interactionSteps}；提交总次数：${process.totalAttempts}；重复尝试的步骤：${process.retriedSteps.join('、') || '无'}`,
    `- 有效操作时长：${process.activeMinutes ?? '—'} 分钟；起止跨度：${process.wallMinutes ?? '—'} 分钟`,
    `- 使用提示 ${process.hintsUsed} 次；请求 AI 实验导师 ${process.tutorRequests} 次；请求安全助手评审 ${process.reviewRequests} 次`,
    ...(process.legacySteps ? [`- 有 ${process.legacySteps} 步为过程采集上线前的历史记录，无过程数据`] : []),
    '',
    '## 多课程知识点覆盖',
    ...courses.map((line) => `- ${line}`),
    '',
    '## AI 实验导师反思建议',
    reflection ? `（来源：${reflection.source === 'model' ? '大模型' : '知识库规则'}）` : '尚未生成；可在 S24 请求“实验后反思与改进建议”。',
    ...(reflection ? reflection.text.split(/\r?\n/) : [])
  ];
}
