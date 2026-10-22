import { STEPS, buildLadder, buildProfile, knowledgeForStep, type ChartData, type StepInput } from '@zhian/shared';
import { evaluateStep } from '@zhian/scoring';
import { detectPii, processPortrait } from '@zhian/sim-core';
import { db } from '../db.js';
import { callModelAudited, markParse } from '../ilab/aiAudit.js';

/**
 * AI 实验导师（智能体）：实验前方案指导与资源推荐、实验中仿真数据分析反馈、实验后反思与创新路径规划。
 * 知识库 = 课程知识点（只含原理，不含标准答案）；模型不可用时用知识库规则生成，并如实标注来源。
 * 发给模型的内容不含个人信息，也不含评分规则与标准答案；模型输出再做一次个人信息过滤。
 */
export type TutorPhase = 'pre' | 'during' | 'post';

export interface TutorResponse {
  phase: TutorPhase;
  text: string;
  source: 'model' | 'knowledge_base';
  knowledgePoints: Array<{ id: string; name: string; course: string }>;
}

/** 这些步骤的预览会产生可分析的仿真数据 */
export const DURING_STEPS = new Set(['S06', 'S08', 'S13', 'S17', 'S19', 'S21']);

const COURSE_NAME: Record<string, string> = { AI: '人工智能概论', DIP: '数字图像处理', NET: '计算机网络', MATH: '数学建模', SAFE: '实验室安全' };

/** 只描述学生在预览中已经能看到的数据特征，不输出评分或正确答案 */
function describeChart(chart: ChartData): string {
  const parts: string[] = [];
  for (const series of chart.series) {
    const values = series.values;
    if (!values.length) continue;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const at = chart.x[values.indexOf(max)];
    parts.push(`“${series.name}”范围 ${min.toFixed(2)}～${max.toFixed(2)}，最高点在 ${String(at)}`);
    if (chart.threshold) {
      const over = values.filter((value) => value > chart.threshold!.value).length;
      parts.push(`有 ${over} 个点高于参考线（${chart.threshold.label} ${chart.threshold.value}）`);
    }
  }
  return `${chart.title}：${parts.join('；')}。`;
}

export function analyzeDuring(stepId: string, input: StepInput): string {
  const { result } = evaluateStep(stepId, input);
  const lines: string[] = [];
  if (stepId === 'S06') {
    const masked = String(result.preview ?? '');
    const hits = detectPii(masked);
    lines.push(hits.length ? `文本中仍能被自动识别出：${[...new Set(hits.map((hit) => hit.type))].join('、')}。` : '文本中已识别不出手机号或身份证号这类直接标识。');
    const image = processPortrait(String(input.photo ?? '保留原图'), Number(input.strength ?? 1));
    if (image.processed === null) lines.push('图像已被整张删除，护目镜信息也随之消失，请思考训练任务还能否完成。');
    else lines.push(`图像人脸区域的高频细节（拉普拉斯能量）约为原图的 ${(image.identifiability * 100).toFixed(0)}%，护目镜与皮肤的亮度对比保留约 ${(image.taskUtility * 100).toFixed(0)}%。`);
  } else if (result.chart) {
    lines.push(describeChart(result.chart as ChartData));
  }
  return lines.join('');
}

function preGuidance(stepId: string): string {
  const step = STEPS.find((item) => item.id === stepId)!;
  const points = knowledgeForStep(stepId);
  const head = `本步任务：${step.description}`;
  const kb = points.map((point) => `【${COURSE_NAME[point.course]}·${point.name}】${point.principle}${point.reference ? `（参考：${point.reference}）` : ''}`).join('\n');
  return `${head}\n建议先阅读任务材料，明确要保护的对象和需要保留的功能，再结合下列知识点设计方案：\n${kb || '本步为自动生成步骤，无需额外准备。'}`;
}

function postReflection(sessionId: number): string {
  const rows = db.prepare('SELECT step_id, score, max_score FROM step_records WHERE session_id = ?').all(sessionId) as unknown as Array<{ step_id: string; score: number; max_score: number }>;
  const records = rows.map((row) => ({ stepId: row.step_id, score: Number(row.score), maxScore: Number(row.max_score) }));
  if (!records.length) return '还没有提交记录，完成部分步骤后再生成反思建议。';
  const profile = buildProfile(records).filter((item) => item.max > 0).sort((a, b) => a.percent - b.percent);
  const ladder = buildLadder(records);
  const weakSteps = records.filter((record) => record.maxScore > 0 && record.score / record.maxScore < 0.6).map((record) => record.stepId);
  const retried = db.prepare('SELECT step_id, COUNT(*) AS c FROM step_attempts WHERE session_id = ? GROUP BY step_id HAVING c > 1').all(sessionId) as Array<{ step_id: string; c: number }>;
  const weakPoints = [...new Set(weakSteps.flatMap((id) => knowledgeForStep(id).map((point) => `${point.name}（${COURSE_NAME[point.course]}）`)))].slice(0, 6);
  const lines = [
    `能力维度中相对薄弱的是「${profile[0]?.label ?? '—'}」（${profile[0]?.percent ?? 0}%）。`,
    `阶梯能力：${ladder.map((level) => `${level.name}${level.status}`).join('；')}。`,
    weakSteps.length ? `得分率低于 60% 的步骤：${weakSteps.join('、')}，建议回到这些步骤重读反馈并复习：${weakPoints.join('、')}。` : '各步骤得分率均不低于 60%，可尝试在不降低安全性的前提下提升方案的可用性。',
    retried.length ? `你在 ${retried.map((row) => row.step_id).join('、')} 进行了多次尝试，可对比前后方案，总结判断依据的变化。` : '本次没有重复提交，建议对一两个关键步骤尝试不同方案，比较结果差异。',
    '创新探索方向：① 用频率域（如傅里叶变换）方法重新评价人脸去标识化效果；② 为智能体设计基于内容的外发检测，而不只依赖权限开关；③ 把 GPU 热路模型扩展为多台机柜相互影响的模型，研究机房气流组织。'
  ];
  return lines.join('\n');
}

const PII_PATTERNS = [/(?<!\d)1[3-9]\d{9}(?!\d)/g, /(?<![0-9Xx])\d{17}[\dXx](?![0-9Xx])/g];

/** 模型输出的个人信息过滤（伦理与安全兜底） */
export function sanitize(text: string): string {
  let out = text;
  for (const pattern of PII_PATTERNS) out = out.replace(pattern, '[已过滤]');
  return out.slice(0, 800);
}

export async function runTutor(args: { phase: TutorPhase; stepId: string; input: StepInput; sessionId: number | null; userId: number; allowModel: boolean }): Promise<TutorResponse> {
  const { phase, stepId, input, sessionId } = args;
  const points = knowledgeForStep(stepId).map((point) => ({ id: point.id, name: point.name, course: COURSE_NAME[point.course]! }));
  const ruleText = phase === 'pre' ? preGuidance(stepId) : phase === 'during' ? analyzeDuring(stepId, input) : postReflection(sessionId ?? -1);
  if (!args.allowModel) return { phase, text: ruleText, source: 'knowledge_base', knowledgePoints: points };

  const step = STEPS.find((item) => item.id === stepId);
  const task = phase === 'pre'
    ? '请根据知识库，为学生给出本步的方案设计思路和需要复习的知识点（不超过 200 字）。不要直接给出选项答案。'
    : phase === 'during'
      ? '请根据仿真数据分析，解释当前参数下的现象和可能的调整方向（不超过 200 字）。不要直接给出最优参数或标准答案。'
      : '请根据学生的实验表现，给出反思改进建议和一条创新探索路径（不超过 250 字）。';
  const call = await callModelAudited([
    { role: 'system', content: '你是高校“人工智能实验安全”课程的实验导师。只依据提供的知识库与数据回答；不得编造法规条文；不得输出任何个人信息；不得替学生直接作答。' },
    { role: 'user', content: `实验步骤：${step?.name ?? stepId}\n知识库：\n${preGuidance(stepId)}\n数据与分析：\n${ruleText}\n要求：${task}` }
  ], { sessionId, userId: args.userId, stepId, scenario: `tutor:${phase}` });
  const text = call.text?.trim() ? sanitize(call.text.trim()) : null;
  markParse(call.invocationId, Boolean(text), text ? 'model' : 'rule');
  return { phase, text: text ?? ruleText, source: text ? 'model' : 'knowledge_base', knowledgePoints: points };
}
