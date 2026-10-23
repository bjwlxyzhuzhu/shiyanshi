import { Router } from 'express';
import { COURSES, KNOWLEDGE_POINTS, PRELAB_QUESTIONS, buildCourseAttainment, buildLadder, buildProfile } from '@zhian/shared';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db, nowIso } from '../db.js';
import { PRELAB_KEY } from '../prelabKey.js';

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
      ladder: buildLadder(records),
      teacherReview: teacherReview(session.id)
    };
  });
  res.json({ sessions: items });
});

export const TEACHER_GRADES = ['优秀', '良好', '合格', '不合格'] as const;

export function prelabSummary(userId: number): { latest: number | null; best: number | null; attempts: number; total: number } {
  const row = db.prepare('SELECT COUNT(*) AS n, MAX(correct) AS best FROM prelab_attempts WHERE user_id = ?').get(userId) as { n: number; best: number | null };
  const latest = db.prepare('SELECT correct FROM prelab_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) as { correct: number } | undefined;
  return { latest: latest?.correct ?? null, best: row.best, attempts: Number(row.n), total: PRELAB_QUESTIONS.length };
}

export function teacherReview(sessionId: number): { grade: string; comment: string; updatedAt: string } | null {
  const row = db.prepare('SELECT grade, comment, updated_at FROM teacher_reviews WHERE session_id = ?').get(sessionId) as { grade: string; comment: string; updated_at: string } | undefined;
  return row ? { grade: row.grade, comment: row.comment, updatedAt: row.updated_at } : null;
}

/** 预习测验：题目不含答案；提交后返回逐题对错与解析，可重复作答，记录最近与最好成绩 */
learningRouter.get('/prelab', authRequired, (req: AuthedRequest, res) => {
  res.json({ questions: PRELAB_QUESTIONS, summary: prelabSummary(req.user!.id) });
});

learningRouter.post('/prelab', authRequired, (req: AuthedRequest, res) => {
  const answers = (req.body?.answers ?? {}) as Record<string, unknown>;
  const results = PRELAB_QUESTIONS.map((question) => {
    const raw = answers[question.id];
    const chosen = Number.isInteger(raw) && Number(raw) >= 0 && Number(raw) < question.options.length ? Number(raw) : null;
    const key = PRELAB_KEY[question.id]!;
    return { id: question.id, chosen, correct: chosen === key.answer, answer: key.answer, explain: key.explain };
  });
  if (results.some((item) => item.chosen === null)) {
    res.status(400).json({ code: 'INCOMPLETE', message: '请完成全部题目后再提交' });
    return;
  }
  const correct = results.filter((item) => item.correct).length;
  db.prepare('INSERT INTO prelab_attempts (user_id, answers_json, correct, total, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user!.id, JSON.stringify(Object.fromEntries(results.map((item) => [item.id, item.chosen]))), correct, results.length, nowIso());
  res.json({ correct, total: results.length, results, summary: prelabSummary(req.user!.id) });
});

/** 报告共用：阶梯能力、过程评价、课程覆盖、导师反思（均为模板文字，不调用模型） */
export function reportSections(sessionId: number): string[] {
  const rows = db.prepare('SELECT step_id, score, max_score FROM step_records WHERE session_id = ?').all(sessionId) as unknown as Array<{ step_id: string; score: number; max_score: number }>;
  const records = rows.map((row) => ({ stepId: row.step_id, score: Number(row.score), maxScore: Number(row.max_score) }));
  const ladder = buildLadder(records);
  const process = processSummary(sessionId);
  const attainment = buildCourseAttainment(records);
  const courses = COURSES.map((course) => {
    const points = KNOWLEDGE_POINTS.filter((point) => point.course === course.id);
    const covered = points.filter((point) => point.steps.some((stepId) => records.some((record) => record.stepId === stepId)));
    const item = attainment.find((entry) => entry.id === course.id)!;
    return `${course.name}：覆盖知识点 ${covered.length}/${points.length}；关联步骤得分率 ${item.max ? Math.round(item.ratio * 100) : 0}%（${item.stepsDone}/${item.stepsTotal} 步）`;
  });
  const reflection = db.prepare("SELECT text, source FROM tutor_notes WHERE session_id = ? AND phase = 'post' ORDER BY id DESC LIMIT 1").get(sessionId) as { text: string; source: string } | undefined;
  const owner = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionId) as { user_id: number } | undefined;
  const prelab = owner ? prelabSummary(owner.user_id) : null;
  const review = teacherReview(sessionId);
  return [
    '## 成绩构成',
    '- 操作成绩：24 步服务端评分（满分 100）',
    `- 预习成绩：${prelab && prelab.best !== null ? `${prelab.best}/${prelab.total}（最好成绩，共作答 ${prelab.attempts} 次；不计入 100 分）` : '未参加预习测验'}`,
    `- 教师评价：${review ? `${review.grade}${review.comment ? `；${review.comment}` : ''}` : '待教师评价'}`,
    '',
    '## 阶梯能力达成',
    ...ladder.map((level) => `- ${level.id} ${level.name}：${level.score}/${level.max}（${Math.round(level.ratio * 100)}%），${level.status}（已提交 ${level.submitted}/${level.total} 步）`),
    '',
    '## 过程评价（不计入成绩）',
    `- 有实际交互证据的步骤：${process.interactionSteps}；提交总次数：${process.totalAttempts}；重复尝试的步骤：${process.retriedSteps.join('、') || '无'}`,
    `- 有效操作时长：${process.activeMinutes ?? '—'} 分钟；起止跨度：${process.wallMinutes ?? '—'} 分钟`,
    `- 使用提示 ${process.hintsUsed} 次；请求 AI 实验导师 ${process.tutorRequests} 次；请求安全助手评审 ${process.reviewRequests} 次`,
    ...(process.legacySteps ? [`- 有 ${process.legacySteps} 步为过程采集上线前的历史记录，无过程数据`] : []),
    '',
    '## 跨学科学习经历（多课程知识点覆盖与得分率）',
    ...courses.map((line) => `- ${line}`),
    '',
    '## AI 实验导师反思建议',
    reflection ? `（来源：${reflection.source === 'model' ? '大模型' : '知识库规则'}）` : '尚未生成；可在 S24 请求“实验后反思与改进建议”。',
    ...(reflection ? reflection.text.split(/\r?\n/) : [])
  ];
}
