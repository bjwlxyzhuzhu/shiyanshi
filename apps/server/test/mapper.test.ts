import { describe, expect, it } from 'vitest';
import { STEPS } from '@zhian/shared';
import { exportStepScore, mapSession, roundScore, type MapperInput } from '../src/ilab/mapper.js';
import type { AttemptRow, EvidenceQuality } from '../src/ilab/telemetry.js';

const T0 = 1_790_000_000_000;

function attempt(stepId: string, start: number | null, end: number, evidence: EvidenceQuality, score: number, max: number, no = 1): AttemptRow {
  return {
    id: 0, session_id: 1, step_id: stepId, attempt_no: no, request_id: null, observed_start_ms: start, observed_end_ms: end,
    active_ms: start === null ? null : end - start, interaction_count: evidence === 'observed_interaction' ? 2 : 0, input_hash: 'h',
    raw_score: score, raw_max_score: max, evidence_quality: evidence, result_json: '{}'
  };
}

/** 24 步，每步 40 秒，第 i 步得原满分的一半（含一位小数） */
function fullInput(overrides: Partial<MapperInput> = {}): MapperInput {
  const records = new Map<string, { score: number; maxScore: number; feedback: string }>();
  const attempts = new Map<string, AttemptRow[]>();
  STEPS.forEach((step, index) => {
    const start = T0 + 5_000 + index * 40_000 + 250;
    const end = start + 35_400;
    const score = step.maxScore / 2 + 0.3;
    records.set(step.id, { score, maxScore: step.maxScore, feedback: `反馈${step.id}` });
    attempts.set(step.id, [attempt(step.id, start, end, step.id === 'S24' ? 'auto_step' : 'observed_interaction', score, step.maxScore)]);
  });
  const expectTimes = Object.fromEntries(STEPS.map((step) => [step.id, 90]));
  return {
    status: 1, environment: 'test', synthetic: false, username: 'stu01', appid: '10000', originId: 'zhian_test_abc', title: '实验',
    sessionStartMs: T0, nowMs: T0 + 3_600_000, steps: STEPS, records, attempts, expectTimes, syntheticExpectTimeSec: 60,
    scorePolicy: 'preserve_weights_round', timePolicy: 'floor_seconds',
    aiData: { ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [] }, aiBlockers: [],
    ...overrides
  };
}

describe('时间与真实性', () => {
  it('完整真实过程：无阻断，起止向下取整到秒且用时一致', () => {
    const out = mapSession(fullInput());
    expect(out.blockers).toEqual([]);
    const steps = out.payload.steps as Array<Record<string, number>>;
    expect(steps).toHaveLength(24);
    for (const step of steps) {
      expect(step.startTime % 1000).toBe(0);
      expect(step.timeUsed).toBe((step.endTime! - step.startTime!) / 1000);
      expect(step.startTime).toBeGreaterThanOrEqual(out.payload.startTime as number);
      expect(step.endTime).toBeLessThanOrEqual(out.payload.endTime as number);
    }
    expect(out.payload.timeUsed).toBe(((out.payload.endTime as number) - (out.payload.startTime as number)) / 1000);
    expect(out.audit.interactionVerified).toBe(23);
  });

  it('历史记录没有过程证据：legacy_missing 阻断，不推算用时', () => {
    const input = fullInput();
    input.attempts.delete('S05');
    const out = mapSession(input);
    expect(out.blockers.map((b) => b.code)).toContain('legacy_missing');
  });

  it('不足 1 秒、未来时间、早于整体开始都阻断，不补 1 秒或 60 秒', () => {
    const zero = fullInput();
    zero.attempts.set('S03', [attempt('S03', T0 + 90_100, T0 + 90_900, 'observed_interaction', 1.8, 3)]);
    zero.records.set('S03', { score: 1.8, maxScore: 3, feedback: '' });
    expect(mapSession(zero).blockers.map((b) => b.code)).toContain('step_zero_seconds');

    const future = fullInput({ nowMs: T0 + 10_000 });
    expect(mapSession(future).blockers.map((b) => b.code)).toContain('future_time');

    const early = fullInput({ sessionStartMs: T0 + 100_000 });
    expect(mapSession(early).blockers.map((b) => b.code)).toContain('step_before_session');
  });

  it('未观测到开始事件阻断', () => {
    const input = fullInput();
    input.attempts.set('S07', [attempt('S07', null, T0 + 300_000, 'missing_start', 2.3, 4)]);
    expect(mapSession(input).blockers.map((b) => b.code)).toContain('missing_start');
  });

  it('教师未确认 expectTime 时真实会话阻断；合成会话使用合成常量', () => {
    const real = mapSession(fullInput({ expectTimes: {} }));
    expect(real.blockers.find((b) => b.code === 'expect_time_unconfirmed')?.policyPending).toBe(true);
    const synthetic = mapSession(fullInput({ expectTimes: {}, synthetic: true }));
    expect(synthetic.blockers.map((b) => b.code)).not.toContain('expect_time_unconfirmed');
    expect((synthetic.payload.steps as Array<{ expectTime: number }>)[0]!.expectTime).toBe(60);
    expect(synthetic.payload.ext_data).toEqual({ data_source: 'synthetic_mock' });
  });
});

describe('交互步数：接口 10 步与课程 20 步分别校验', () => {
  it('24 步齐全但只有 15 步有交互证据：只触发 20 步阻断', () => {
    const input = fullInput();
    STEPS.slice(0, 8).forEach((step) => {
      const list = input.attempts.get(step.id)!;
      input.attempts.set(step.id, list.map((row) => ({ ...row, evidence_quality: 'observed_no_change' as const, interaction_count: 0 })));
    });
    const codes = mapSession(input).blockers.map((b) => b.code);
    expect(codes).toContain('interaction_below_20');
    expect(codes).not.toContain('api_min_steps');
  });

  it('S24 自动报告不计入实际交互', () => {
    expect(mapSession(fullInput()).audit.interactionCandidates).toBe(23);
  });
});

describe('成绩整数导出', () => {
  it('保留原始分；preserve_weights_round 步骤与总分各自取整，差异只提示不调分', () => {
    const input = fullInput();
    const out = mapSession(input);
    expect(input.records.get('S01')!.score).toBe(2.3);
    const s01 = (out.payload.steps as Array<Record<string, unknown>>)[0]!;
    expect(s01.score).toBe(2);
    expect(s01.maxScore).toBe(4);
    expect((s01.ext_data as Record<string, unknown>).raw_score).toBe(2.3);
    expect(out.payload.score).toBe(roundScore(out.audit.rawTotal));
    if (out.audit.exportStepSum !== out.audit.exportTotal) expect(out.warnings.map((w) => w.code)).toContain('rounding_difference');
  });

  it('normalize_step_percent：步骤满分 100、按比例取整', () => {
    expect(exportStepScore('normalize_step_percent', 2.3, 4)).toEqual({ score: 58, maxScore: 100 });
    expect(exportStepScore('preserve_weights_round', 2.5, 5)).toEqual({ score: 3, maxScore: 5 });
    expect(exportStepScore('preserve_weights_round', 0.15, 3)).toEqual({ score: 0, maxScore: 3 });
  });

  it('口径未确认：给出 policyPending 阻断，但仍可预览', () => {
    const out = mapSession(fullInput({ scorePolicy: 'unconfirmed', timePolicy: 'unconfirmed' }));
    const pending = out.blockers.filter((b) => b.policyPending).map((b) => b.code);
    expect(pending).toEqual(expect.arrayContaining(['score_policy_unconfirmed', 'time_policy_unconfirmed']));
    expect(out.audit.scorePolicy).toBe('preserve_weights_round');
  });

  it('重复次数来自真实尝试次数', () => {
    const input = fullInput();
    const first = input.attempts.get('S02')![0]!;
    input.attempts.set('S02', [first, { ...first, attempt_no: 2, observed_start_ms: null, observed_end_ms: first.observed_end_ms + 2000 }]);
    const s02 = (mapSession(input).payload.steps as Array<Record<string, number>>)[1]!;
    expect(s02.repeatCount).toBe(2);
  });
});
