import { Router } from 'express';
import { BRAND, STEPS, parseList, type AiReviewResponse, type StepInput } from '@zhian/shared';
import { buildProfile } from '@zhian/scoring';
import { authRequired, type AuthedRequest } from '../auth.js';
import { db, nowIso } from '../db.js';
import { callModel } from '../ai/client.js';

export const aiRouter = Router();

type Risk = AiReviewResponse['risks'][number];

/** 规则兜底：大模型不可用或返回不合法时，按步骤给出确定性的评审意见。 */
function ruleReview(stepId: string, input: StepInput): Risk[] {
  const risks: Risk[] = [];
  if (stepId === 'S10') {
    const sequence = parseList(input.sequence);
    if (sequence[0] !== '立即隔离受影响系统') {
      risks.push({ level: 'high', item: '首要动作', reason: '发现泄露后应先隔离受影响系统，阻断继续外泄，再做评估。' });
    }
    const report = sequence.indexOf('向实验室负责人与学校网信部门报告');
    const notify = sequence.indexOf('通知受影响的个人');
    if (report >= 0 && notify >= 0 && notify < report) {
      risks.push({ level: 'mid', item: '报告与通知顺序', reason: '应先向负责人和网信部门报告，统一口径后再通知受影响个人。' });
    }
    if (sequence[sequence.length - 1] !== '复盘并落实整改') {
      risks.push({ level: 'low', item: '收尾动作', reason: '复盘整改应放在最后，确保处置过程完整留痕。' });
    }
  }
  if (stepId === 'S23') {
    const actions = parseList(input.actions);
    if (actions.includes('关闭所有日志以防泄露')) {
      risks.push({ level: 'high', item: '关闭日志', reason: '日志是追溯依据，应做访问控制与脱敏，而不是关闭。' });
    }
    if (actions.includes('禁止学生使用大模型')) {
      risks.push({ level: 'mid', item: '一刀切禁用', reason: '应通过权限、审批与审计实现可控使用，而非全面禁止。' });
    }
    if (!actions.includes('智能体外发工具改为人工确认')) {
      risks.push({ level: 'high', item: '根因未闭环', reason: '本次事故的直接原因是外发工具自动执行，需改为人工确认。' });
    }
  }
  if (risks.length === 0) {
    risks.push({ level: 'low', item: '方案完整性', reason: '未发现明显问题，建议在报告中补充每项措施的责任人与期限。' });
  }
  return risks.slice(0, 3);
}

function parseRisks(text: string | null): Risk[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { risks?: Risk[] };
    return Array.isArray(parsed.risks) && parsed.risks.length > 0 ? parsed.risks.slice(0, 3) : null;
  } catch {
    return null;
  }
}

aiRouter.post('/review', authRequired, async (req: AuthedRequest, res) => {
  const stepId = String(req.body?.stepId ?? '');
  const input = (req.body?.input ?? {}) as StepInput;
  const sessionId = req.body?.sessionId ? Number(req.body.sessionId) : null;
  const step = STEPS.find((item) => item.id === stepId);
  const startedAt = Date.now();

  const prompt = [
    '你是高校人工智能实验室的安全教学助手。',
    `实验步骤：${step?.name ?? stepId}。`,
    `学生的方案：${JSON.stringify(input)}`,
    '请指出最多 3 条安全风险或不足，只输出 JSON。',
    '格式：{"risks":[{"level":"high|mid|low","item":"...","reason":"..."}]}'
  ].join('\n');

  const modelRisks = parseRisks(await callModel([
    { role: 'system', content: '你只输出合法 JSON，不输出任何个人信息。' },
    { role: 'user', content: prompt }
  ]));
  const risks = modelRisks ?? ruleReview(stepId, input);
  const source: AiReviewResponse['source'] = modelRisks ? 'model' : 'rule';

  db.prepare(`
    INSERT INTO ai_logs (session_id, agent, model, prompt_hash, response, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, `review:${stepId}`, process.env.AI_MODEL ?? null, `len:${prompt.length}`, JSON.stringify(risks), Date.now() - startedAt, nowIso());

  const payload: AiReviewResponse = { risks, source };
  res.json(payload);
});

aiRouter.post('/report', authRequired, (req: AuthedRequest, res) => {
  const user = req.user!;
  const sessionId = Number(req.body?.sessionId ?? 0);
  const session = db
    .prepare('SELECT id, total_score FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, user.id) as { id: number; total_score: number } | undefined;
  if (!session) {
    res.status(404).json({ code: 'NO_SESSION', message: '实验会话不存在' });
    return;
  }

  const rows = db
    .prepare('SELECT step_id, score, max_score FROM step_records WHERE session_id = ? ORDER BY id')
    .all(sessionId) as unknown as Array<{ step_id: string; score: number; max_score: number }>;
  const records = rows.map((row) => ({ stepId: row.step_id, score: Number(row.score), maxScore: Number(row.max_score) }));
  const profile = buildProfile(records);
  const total = records.reduce((sum, record) => sum + record.score, 0);
  const weakest = [...profile].filter((item) => item.max > 0).sort((a, b) => a.percent - b.percent)[0];

  const lines = [
    `# ${BRAND.name} · 实验报告`,
    '',
    `- 实验：${BRAND.fullName}`,
    `- 学生：${user.username}`,
    `- 会话编号：${sessionId}`,
    `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
    `- 总分：${total.toFixed(1)} / 100`,
    '',
    '## 能力画像',
    '',
    '| 维度 | 得分 | 满分 | 达成率 |',
    '| --- | ---: | ---: | ---: |',
    ...profile.map((item) => `| ${item.label} | ${item.score} | ${item.max} | ${item.percent}% |`),
    '',
    '## 步骤记录',
    '',
    '| 步骤 | 名称 | 得分 | 满分 |',
    '| --- | --- | ---: | ---: |',
    ...records.map((record) => {
      const step = STEPS.find((item) => item.id === record.stepId);
      return `| ${record.stepId} | ${step?.name ?? '-'} | ${record.score} | ${record.maxScore} |`;
    }),
    '',
    '## 改进建议',
    '',
    weakest
      ? `本次最薄弱的维度是「${weakest.label}」（达成率 ${weakest.percent}%），建议重做该维度对应步骤并对照反馈修正。`
      : '暂无足够数据形成建议。'
  ];

  const contentMd = lines.join('\n');
  const info = db.prepare('INSERT INTO reports (session_id, content_md, created_at) VALUES (?, ?, ?)').run(sessionId, contentMd, nowIso());
  res.json({ reportId: Number(info.lastInsertRowid), contentMd, profile });
});
