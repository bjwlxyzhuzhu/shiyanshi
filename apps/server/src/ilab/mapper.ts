import type { StepDefinition } from '@zhian/shared';
import type { IlabMode, ScorePolicy, TimeExportPolicy } from './config.js';
import { STEP_EXPORT_META } from './stepMeta.js';
import type { AttemptRow, EvidenceQuality } from './telemetry.js';
import { validateResultPayload } from './validate.js';

/**
 * 24 步 → 实验空间回传结构。纯函数：不读库、不发请求，便于测试。
 * 缺失/不合规的数据一律变成阻断项，不补造时间、不改学生分数。
 */
export interface MapperIssue {
  code: string;
  message: string;
  stepId?: string;
  /** 属于“口径待确认”类：mock 环境降级为提示，测试/正式环境阻断 */
  policyPending?: boolean;
}

export interface MapperInput {
  status: 1 | 2;
  environment: IlabMode;
  synthetic: boolean;
  username: string;
  appid: string;
  originId: string;
  title: string;
  sessionStartMs: number | null;
  nowMs: number;
  steps: StepDefinition[];
  records: Map<string, { score: number; maxScore: number; feedback: string }>;
  attempts: Map<string, AttemptRow[]>;
  expectTimes: Record<string, number | null>;
  syntheticExpectTimeSec: number;
  scorePolicy: ScorePolicy;
  timePolicy: TimeExportPolicy;
  aiData?: Record<string, unknown>;
  aiBlockers?: string[];
}

export interface StepAudit {
  stepId: string;
  rawScore: number;
  rawMaxScore: number;
  exportScore: number;
  exportMaxScore: number;
  attempts: number;
  evidence: EvidenceQuality | 'none';
  activeMs: number | null;
  wallStartMs: number | null;
  wallEndMs: number | null;
}

export interface MapperOutput {
  payload: Record<string, unknown>;
  blockers: MapperIssue[];
  warnings: MapperIssue[];
  audit: {
    scorePolicy: Exclude<ScorePolicy, 'unconfirmed'>;
    scorePolicyConfirmed: boolean;
    timePolicyConfirmed: boolean;
    rawTotal: number;
    exportTotal: number;
    exportStepSum: number;
    interactionVerified: number;
    interactionCandidates: number;
    steps: StepAudit[];
  };
}

/** 一位小数的原始分先规整再四舍五入，避免 0.1 浮点误差 */
export function roundScore(value: number): number {
  return Math.round(Math.round(value * 10) / 10);
}

export function exportStepScore(policy: Exclude<ScorePolicy, 'unconfirmed'>, raw: number, rawMax: number): { score: number; maxScore: number } {
  if (policy === 'normalize_step_percent') {
    // 先规整到 6 位小数，避免 2.3/4*100=57.4999… 这类浮点误差导致少给 1 分
    const score = rawMax > 0 ? Math.round(Number(((raw / rawMax) * 100).toFixed(6))) : 0;
    return { score: Math.min(100, Math.max(0, score)), maxScore: 100 };
  }
  return { score: Math.min(roundScore(rawMax), Math.max(0, roundScore(raw))), maxScore: roundScore(rawMax) };
}

const floorSecond = (ms: number) => Math.floor(ms / 1000) * 1000;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`;
}

const EVIDENCE_TEXT: Record<string, string> = {
  legacy_missing: '历史记录没有过程证据（legacy_missing）',
  missing_start: '提交前未观测到打开设备的事件',
  observed_no_change: '打开后未改动输入即提交，不计为实际交互'
};

export function mapSession(input: MapperInput): MapperOutput {
  const blockers: MapperIssue[] = [];
  const warnings: MapperIssue[] = [];
  const scorePolicy = input.scorePolicy === 'unconfirmed' ? 'preserve_weights_round' : input.scorePolicy;
  if (input.scorePolicy === 'unconfirmed') blockers.push({ code: 'score_policy_unconfirmed', message: '整数成绩导出口径未确认（当前按 preserve_weights_round 预览）', policyPending: true });
  if (input.timePolicy === 'unconfirmed') blockers.push({ code: 'time_policy_unconfirmed', message: '时间整秒导出口径未确认（当前按起止向下取整到秒预览）', policyPending: true });
  if (!/^[A-Za-z0-9_]+$/.test(input.originId)) blockers.push({ code: 'origin_id_invalid', message: 'originId 只能包含字母、数字、下划线' });

  const included = input.steps.filter((step) => input.records.has(step.id));
  if (input.status === 1 && included.length !== input.steps.length) {
    blockers.push({ code: 'steps_incomplete', message: `完成记录需要全部 ${input.steps.length} 步都已提交（当前 ${included.length} 步）` });
  }

  const missingExpect: string[] = [];
  const stepPayloads: Array<Record<string, unknown>> = [];
  const audits: StepAudit[] = [];
  let interactionVerified = 0;
  let interactionCandidates = 0;

  for (const step of included) {
    const record = input.records.get(step.id)!;
    const attempts = input.attempts.get(step.id) ?? [];
    const meta = STEP_EXPORT_META[step.id];
    if (meta?.countsAsStudentInteraction) interactionCandidates += 1;
    const exported = exportStepScore(scorePolicy, record.score, record.maxScore);

    if (attempts.length === 0) {
      blockers.push({ code: 'legacy_missing', stepId: step.id, message: `${step.id} ${EVIDENCE_TEXT.legacy_missing}，不能用判分耗时推算学习时间` });
      audits.push({ stepId: step.id, rawScore: record.score, rawMaxScore: record.maxScore, exportScore: exported.score, exportMaxScore: exported.maxScore, attempts: 0, evidence: 'legacy_missing', activeMs: null, wallStartMs: null, wallEndMs: null });
      continue;
    }
    const first = attempts[0]!;
    const last = attempts[attempts.length - 1]!;
    const startMs = attempts.find((attempt) => attempt.observed_start_ms !== null)?.observed_start_ms ?? null;
    const endMs = last.observed_end_ms;
    const verified = attempts.some((attempt) => attempt.evidence_quality === 'observed_interaction');
    if (meta?.countsAsStudentInteraction && verified) interactionVerified += 1;
    if (Math.abs(last.raw_score - record.score) > 1e-6) {
      blockers.push({ code: 'score_mismatch', stepId: step.id, message: `${step.id} 最终成绩与最后一次尝试记录不一致` });
    }
    if (first.observed_start_ms === null) {
      blockers.push({ code: 'missing_start', stepId: step.id, message: `${step.id} ${EVIDENCE_TEXT.missing_start}` });
    }
    if (meta?.countsAsStudentInteraction && !verified) {
      warnings.push({ code: 'no_interaction_evidence', stepId: step.id, message: `${step.id} ${EVIDENCE_TEXT.observed_no_change}` });
    }

    let timeUsed = 0;
    let qStart = 0;
    let qEnd = 0;
    if (startMs !== null) {
      qStart = floorSecond(startMs);
      qEnd = floorSecond(endMs);
      timeUsed = (qEnd - qStart) / 1000;
      if (timeUsed < 1) blockers.push({ code: 'step_zero_seconds', stepId: step.id, message: `${step.id} 用时不足 1 秒，不能补成固定时长` });
      if (endMs > input.nowMs) blockers.push({ code: 'future_time', stepId: step.id, message: `${step.id} 结束时间晚于当前时间` });
      if (input.sessionStartMs !== null && startMs < input.sessionStartMs) blockers.push({ code: 'step_before_session', stepId: step.id, message: `${step.id} 开始早于整体实验开始` });
    }

    const expectTime = input.synthetic ? input.syntheticExpectTimeSec : input.expectTimes[step.id] ?? null;
    if (expectTime === null) missingExpect.push(step.id);

    stepPayloads.push({
      seq: step.seq,
      title: clip(step.name, 100),
      startTime: qStart,
      endTime: qEnd,
      timeUsed,
      expectTime: expectTime ?? 0,
      maxScore: exported.maxScore,
      score: exported.score,
      repeatCount: attempts.length,
      evaluation: clip(record.feedback || '已提交', 200),
      scoringModel: clip(meta?.scoringModel ?? '服务端规则评分', 200),
      remarks: '',
      ext_data: {
        stepId: step.id,
        raw_score: record.score,
        raw_max_score: record.maxScore,
        export_score_policy: scorePolicy,
        evidence_quality: verified ? 'observed_interaction' : last.evidence_quality
      }
    });
    audits.push({ stepId: step.id, rawScore: record.score, rawMaxScore: record.maxScore, exportScore: exported.score, exportMaxScore: exported.maxScore, attempts: attempts.length, evidence: verified ? 'observed_interaction' : last.evidence_quality, activeMs: attempts.reduce((sum, attempt) => sum + (attempt.active_ms ?? 0), 0), wallStartMs: startMs, wallEndMs: endMs });
  }

  if (missingExpect.length) {
    blockers.push({ code: 'expect_time_unconfirmed', message: `教师尚未确认合理用时（expectTime）：${missingExpect.join('、')}`, policyPending: true });
  }

  if (input.status === 1) {
    if (stepPayloads.length < 10) blockers.push({ code: 'api_min_steps', message: '完成记录接口要求至少 10 个步骤' });
    if (interactionVerified < 20) {
      blockers.push({ code: 'interaction_below_20', message: `有实际交互证据的学生操作步骤为 ${interactionVerified} 步，低于 2026 要求的 20 步（S24 自动报告与未改动输入的提交不计入）` });
    }
  }

  const rawTotal = Math.round([...input.records.values()].reduce((sum, record) => sum + record.score, 0) * 10) / 10;
  const exportTotal = Math.min(100, Math.max(0, roundScore(rawTotal)));
  const exportStepSum = stepPayloads.reduce((sum, step) => sum + Number(step.score), 0);
  if (scorePolicy === 'preserve_weights_round' && exportStepSum !== exportTotal) {
    warnings.push({ code: 'rounding_difference', message: `步骤分逐项取整之和为 ${exportStepSum}，总分取整为 ${exportTotal}；二者不同属于取整差异，未调整学生分数` });
  }

  const stepStarts = stepPayloads.map((step) => Number(step.startTime)).filter((value) => value > 0);
  const stepEnds = stepPayloads.map((step) => Number(step.endTime)).filter((value) => value > 0);
  if (input.sessionStartMs === null) blockers.push({ code: 'session_start_missing', message: '整体实验开始时间缺失（历史会话）' });
  const overallStart = input.sessionStartMs !== null ? floorSecond(Math.min(input.sessionStartMs, ...stepStarts)) : 0;
  const overallEnd = stepEnds.length ? Math.max(...stepEnds) : 0;
  const overallUsed = overallStart && overallEnd ? (overallEnd - overallStart) / 1000 : 0;
  if (overallStart && overallEnd && overallUsed < 1) blockers.push({ code: 'session_zero_seconds', message: '整体用时不足 1 秒' });

  const payload: Record<string, unknown> = {
    username: input.username,
    title: clip(input.title, 100),
    status: input.status,
    score: exportTotal,
    startTime: overallStart,
    endTime: overallEnd,
    timeUsed: overallUsed,
    appid: input.appid,
    originId: input.originId,
    steps: stepPayloads
  };
  if (input.synthetic) payload.ext_data = { data_source: 'synthetic_mock' };
  if (input.aiData) payload.ai_data = input.aiData;
  for (const code of input.aiBlockers ?? []) {
    blockers.push({
      code,
      message: code === 'ai_count_policy_unconfirmed' ? 'AI 调用计次口径未确认（当前按“收到模型响应才计数”预览）'
        : code === 'ai_invocation_in_flight' ? '仍有已发出但未结束的模型请求，需等待结束后再冻结'
        : code === 'ai_model_metadata_missing' ? '有计入的模型调用，但模型版本或部署方式未配置，不能捏造'
        : code,
      policyPending: code === 'ai_count_policy_unconfirmed'
    });
  }

  // 结构校验在已知阻断项之外再兜一层；时间为 0 等已报告的问题不重复列出
  if (!blockers.some((issue) => ['legacy_missing', 'missing_start', 'step_zero_seconds', 'session_start_missing', 'expect_time_unconfirmed'].includes(issue.code))) {
    for (const issue of validateResultPayload(payload, input.nowMs)) blockers.push({ code: 'schema', message: `${issue.path}：${issue.message}` });
  }

  return {
    payload,
    blockers,
    warnings,
    audit: {
      scorePolicy,
      scorePolicyConfirmed: input.scorePolicy !== 'unconfirmed',
      timePolicyConfirmed: input.timePolicy !== 'unconfirmed',
      rawTotal,
      exportTotal,
      exportStepSum,
      interactionVerified,
      interactionCandidates,
      steps: audits
    }
  };
}
