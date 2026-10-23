import { Router } from 'express';
import { EXPLORATIONS, MIN_EXPLORE_TRIALS, type Exploration } from '@zhian/shared';
import { evaluateStep } from '@zhian/scoring';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db, nowIso } from '../db.js';
import { sanitize } from '../ai/tutor.js';

/** 研究探索：只取仿真数据，不评分；试验与结论计入过程评价与实验报告 */
export const exploreRouter = Router();
exploreRouter.use(authRequired);

function metricsOf(exp: Exploration, result: Record<string, unknown>): Record<string, number> {
  const num = (value: unknown) => Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  switch (exp.id) {
    case 'E1': return { peakC: num(result.峰值温度), powerW: num(result.功耗) };
    case 'E2': return { identifiability: Number(result.人脸高频细节残留), taskUtility: Number(result.护目镜信息保留) };
    default: return { precision: Number(result.精确率), recall: Number(result.召回率), f1: Number(result.F1) };
  }
}

function findExp(id: string): Exploration | undefined {
  return EXPLORATIONS.find((item) => item.id === id);
}

interface TrialRow { params_json: string; metrics_json: string }

function trials(userId: number, expId: string): Array<{ params: Record<string, number>; metrics: Record<string, number> }> {
  return (db.prepare('SELECT params_json, metrics_json FROM explore_trials WHERE user_id = ? AND exp_id = ? ORDER BY id').all(userId, expId) as unknown as TrialRow[])
    .map((row) => ({ params: JSON.parse(row.params_json), metrics: JSON.parse(row.metrics_json) }));
}

exploreRouter.get('/', (req: AuthedRequest, res) => {
  res.json({
    explorations: EXPLORATIONS,
    minTrials: MIN_EXPLORE_TRIALS,
    progress: EXPLORATIONS.map((exp) => {
      const report = db.prepare('SELECT hypothesis, conclusion, feedback, created_at FROM explore_reports WHERE user_id = ? AND exp_id = ? ORDER BY id DESC LIMIT 1').get(req.user!.id, exp.id) as Record<string, string> | undefined;
      return { id: exp.id, trials: trials(req.user!.id, exp.id), report: report ?? null };
    })
  });
});

exploreRouter.post('/:id/run', (req: AuthedRequest, res) => {
  const exp = findExp(String(req.params.id));
  if (!exp) {
    res.status(404).json({ code: 'NO_EXPLORE', message: '探究任务不存在' });
    return;
  }
  const params: Record<string, number> = {};
  for (const variable of exp.variables) {
    const raw = Number(req.body?.params?.[variable.key]);
    const value = Number.isFinite(raw) ? raw : variable.default;
    params[variable.key] = Math.min(variable.max, Math.max(variable.min, value));
  }
  const { result } = evaluateStep(exp.stepId, { ...exp.fixed, ...params });
  const metrics = metricsOf(exp, result);
  db.prepare('INSERT INTO explore_trials (user_id, session_id, exp_id, params_json, metrics_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user!.id, Number(req.body?.sessionId) || null, exp.id, JSON.stringify(params), JSON.stringify(metrics), nowIso());
  res.json({ params, metrics, trials: trials(req.user!.id, exp.id) });
});

/** 依据试验数据给出趋势：对每个改变过的变量，比较该变量取最小值与最大值时各指标的变化方向 */
export function trendFeedback(exp: Exploration, rows: Array<{ params: Record<string, number>; metrics: Record<string, number> }>): string[] {
  const lines: string[] = [];
  for (const variable of exp.variables) {
    const values = [...new Set(rows.map((row) => row.params[variable.key]))];
    if (values.length < 2) continue;
    const low = rows.reduce((a, b) => (b.params[variable.key]! < a.params[variable.key]! ? b : a));
    const high = rows.reduce((a, b) => (b.params[variable.key]! > a.params[variable.key]! ? b : a));
    for (const metric of exp.metrics) {
      const delta = high.metrics[metric.key]! - low.metrics[metric.key]!;
      const dir = Math.abs(delta) < 1e-6 ? '基本不变' : delta > 0 ? '上升' : '下降';
      lines.push(`${variable.label}从 ${low.params[variable.key]}${variable.unit ?? ''} 增至 ${high.params[variable.key]}${variable.unit ?? ''}，${metric.label}${dir}（${low.metrics[metric.key]} → ${high.metrics[metric.key]}${metric.unit ? ` ${metric.unit}` : ''}）`);
    }
  }
  return lines;
}

exploreRouter.post('/:id/conclude', (req: AuthedRequest, res) => {
  const exp = findExp(String(req.params.id));
  if (!exp) {
    res.status(404).json({ code: 'NO_EXPLORE', message: '探究任务不存在' });
    return;
  }
  const rows = trials(req.user!.id, exp.id);
  const distinct = new Set(rows.map((row) => JSON.stringify(row.params))).size;
  if (distinct < MIN_EXPLORE_TRIALS) {
    res.status(400).json({ code: 'TOO_FEW_TRIALS', message: `请至少运行 ${MIN_EXPLORE_TRIALS} 组不同的参数后再写结论（当前 ${distinct} 组）` });
    return;
  }
  const hypothesis = sanitize(String(req.body?.hypothesis ?? '').trim()).slice(0, 500);
  const conclusion = sanitize(String(req.body?.conclusion ?? '').trim()).slice(0, 800);
  if (hypothesis.length < 6 || conclusion.length < 10) {
    res.status(400).json({ code: 'TOO_SHORT', message: '请写出假设（至少 6 字）与依据数据的结论（至少 10 字）' });
    return;
  }
  const trend = trendFeedback(exp, rows);
  const feedback = [
    `你共运行了 ${distinct} 组不同参数。数据显示：`,
    ...trend.map((line) => `· ${line}`),
    '请对照上面的变化方向检查你的结论是否与数据一致；若要判断“哪个参数更敏感”，可只改变一个参数、其余保持不变，再比较相同幅度下的指标变化。'
  ].join('\n');
  db.prepare('INSERT INTO explore_reports (user_id, session_id, exp_id, hypothesis, conclusion, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user!.id, Number(req.body?.sessionId) || null, exp.id, hypothesis, conclusion, feedback, nowIso());
  res.json({ feedback, trend });
});

/** 报告用：本人的探究记录摘要 */
export function exploreSummary(userId: number): string[] {
  const lines: string[] = [];
  for (const exp of EXPLORATIONS) {
    const count = Number((db.prepare('SELECT COUNT(*) AS n FROM explore_trials WHERE user_id = ? AND exp_id = ?').get(userId, exp.id) as { n: number }).n);
    const report = db.prepare('SELECT conclusion FROM explore_reports WHERE user_id = ? AND exp_id = ? ORDER BY id DESC LIMIT 1').get(userId, exp.id) as { conclusion: string } | undefined;
    if (count || report) lines.push(`- ${exp.title}：试验 ${count} 组；${report ? `结论：${report.conclusion}` : '尚未提交结论'}`);
  }
  return lines;
}
