import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ABILITY_LEVELS, KNOWLEDGE_POINTS, STEPS, buildLadder } from '@zhian/shared';
import { db } from '../src/db.js';
import { buildAiData, setModelFetch } from '../src/ilab/aiAudit.js';
import { sanitize } from '../src/ai/tutor.js';
import { requestSeat, releaseSeat, resetPresence } from '../src/presence.js';
import { api, changedInput, configure, launch, startServer, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startServer();
});
afterAll(() => h.close());
beforeEach(() => {
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.CONCURRENCY_LIMIT;
  configure();
  resetPresence();
});

describe('并发控制与排队提示', () => {
  it('超出承诺并发数时排队，先到先得；席位释放后队首进入', () => {
    process.env.CONCURRENCY_LIMIT = '2';
    expect(requestSeat(1).admitted).toBe(true);
    expect(requestSeat(2).admitted).toBe(true);
    const third = requestSeat(3);
    const fourth = requestSeat(4);
    expect(third).toMatchObject({ admitted: false, position: 1 });
    expect(fourth).toMatchObject({ admitted: false, position: 2 });
    releaseSeat(1);
    expect(requestSeat(4).admitted).toBe(false);
    expect(requestSeat(3).admitted).toBe(true);
  });

  it('实验接口在满员时返回 429 与排队位置，已占席位的用户不受影响', async () => {
    process.env.CONCURRENCY_LIMIT = '1';
    const first = await launch(h.base, 'q_first');
    const second = await launch(h.base, 'q_second');
    const ok = await api(h.base, first.token).get(`/api/experiment/${first.sessionId}`);
    expect(ok.status).toBe(200);
    const blocked = await api(h.base, second.token).get(`/api/experiment/${second.sessionId}`);
    expect(blocked.status).toBe(429);
    expect(blocked.json).toMatchObject({ code: 'QUEUED', position: 1 });
    await api(h.base, first.token).post('/api/presence/leave');
    const entered = await api(h.base, second.token).post('/api/presence/enter');
    expect(entered.json.admitted).toBe(true);
  });

  it('题库列表与负载概况无需席位', async () => {
    const steps = await fetch(`${h.base}/api/experiment/steps`);
    expect(steps.status).toBe(200);
    const status = await fetch(`${h.base}/api/presence/status`).then((r) => r.json());
    expect(status).toHaveProperty('limit');
  });
});

describe('带宽测试服务', () => {
  it('按请求大小返回不缓存的随机数据，并提供延迟探测', async () => {
    const probe = await fetch(`${h.base}/api/net/probe?kb=64`);
    expect(probe.headers.get('cache-control')).toBe('no-store');
    expect((await probe.arrayBuffer()).byteLength).toBe(64 * 1024);
    const capped = await fetch(`${h.base}/api/net/probe?kb=999999`);
    expect((await capped.arrayBuffer()).byteLength).toBe(2048 * 1024);
    expect((await fetch(`${h.base}/api/net/ping`).then((r) => r.json())).now).toBeTypeOf('number');
  });
});

describe('AI 实验导师', () => {
  it('未配置模型：知识库规则作答并如实标注，不计 AI 调用', async () => {
    const { token, sessionId } = await launch(h.base, 'tutor_kb');
    const res = await api(h.base, token).post('/api/ai/tutor', { phase: 'pre', stepId: 'S16', sessionId });
    expect(res.json.source).toBe('knowledge_base');
    expect(res.json.knowledgePoints.map((p: { course: string }) => p.course)).toEqual(expect.arrayContaining(['数学建模', '实验室安全']));
    expect(buildAiData(sessionId, 'response_received').aiData.ai_call_count).toBe(0);
  });

  it('实验中分析只描述学生已看到的仿真数据', async () => {
    const { token, sessionId } = await launch(h.base, 'tutor_during');
    const res = await api(h.base, token).post('/api/ai/tutor', { phase: 'during', stepId: 'S06', sessionId, input: { name: '保留', phone: '保留', idCard: '保留', health: '保留', photo: '人脸区域涂黑', strength: 1 } });
    expect(res.json.text).toContain('手机号');
    expect(res.json.text).toContain('护目镜');
    const bad = await api(h.base, token).post('/api/ai/tutor', { phase: 'during', stepId: 'S01', sessionId });
    expect(bad.status).toBe(400);
  });

  it('真实模型调用按场景计入 ai_data，输出中的个人信息被过滤', async () => {
    process.env.AI_BASE_URL = 'https://model.example.invalid/v1';
    process.env.AI_API_KEY = 'test-only';
    process.env.AI_MODEL = 'm';
    configure({ aiModel: { model: 'm', version: 'v2026', deployment: '私有化部署', provider: '' } });
    setModelFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: '先复习热路模型。联系 13812345678' } }], usage: { prompt_tokens: 50, completion_tokens: 20 } }), { status: 200 }));
    const { token, sessionId } = await launch(h.base, 'tutor_model');
    const res = await api(h.base, token).post('/api/ai/tutor', { phase: 'pre', stepId: 'S16', sessionId });
    expect(res.json.source).toBe('model');
    expect(res.json.text).not.toContain('13812345678');
    const ai = buildAiData(sessionId, 'response_received');
    expect(ai.aiData.ai_call_count).toBe(1);
    expect(ai.aiData.ai_usage_scenarios).toEqual(['实验前方案设计指导与资源推荐']);
  });

  it('已提交到实验空间（锁定）的会话不再发起模型调用', async () => {
    process.env.AI_BASE_URL = 'https://model.example.invalid/v1';
    process.env.AI_API_KEY = 'test-only';
    process.env.AI_MODEL = 'm';
    let called = 0;
    setModelFetch(async () => {
      called += 1;
      return new Response('{}', { status: 200 });
    });
    const { token, sessionId } = await launch(h.base, 'tutor_locked');
    db.prepare('UPDATE sessions SET locked = 1 WHERE id = ?').run(sessionId);
    const res = await api(h.base, token).post('/api/ai/tutor', { phase: 'post', stepId: 'S24', sessionId });
    expect(res.json.source).toBe('knowledge_base');
    expect(called).toBe(0);
  });

  it('知识库原理不包含所属步骤的选项原文（只讲原理，不给答案）', () => {
    for (const point of KNOWLEDGE_POINTS) {
      for (const stepId of point.steps) {
        const step = STEPS.find((item) => item.id === stepId)!;
        const options = step.fields.flatMap((field) => field.options ?? []).filter((option) => option.length >= 4 && !step.material?.includes(option) && !step.description.includes(option));
        for (const option of options) expect(point.principle.includes(option), `${point.id} 泄露 ${stepId} 选项「${option}」`).toBe(false);
      }
    }
  });

  it('输出过滤身份证号与手机号', () => {
    expect(sanitize('身份证 610303200201015678 手机 13900001111')).toBe('身份证 [已过滤] 手机 [已过滤]');
  });
});

describe('阶梯能力、过程评价与成长档案', () => {
  it('三个层级覆盖 S01–S23 且互不重叠', () => {
    const all = ABILITY_LEVELS.flatMap((level) => level.steps);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(STEPS.filter((step) => step.id !== 'S24').map((step) => step.id).sort());
    const ladder = buildLadder([{ stepId: 'S01', score: 4, maxScore: 4 }]);
    expect(ladder[0]!.status).toBe('未完成');
  });

  it('过程评价统计尝试、提示与导师使用；档案只返回本人会话', async () => {
    const { token, sessionId } = await launch(h.base, 'proc_user');
    const client = api(h.base, token);
    const step = STEPS[0]!;
    await client.post(`/api/experiment/${sessionId}/events`, { events: [{ stepId: 'S01', type: 'open' }, { stepId: 'S01', type: 'hint' }, { stepId: 'S01', type: 'interact' }] });
    await client.post(`/api/experiment/${sessionId}/step/S01`, { input: changedInput(step), requestId: 'proc_req_00001' });
    await client.post(`/api/experiment/${sessionId}/step/S01`, { input: changedInput(step), requestId: 'proc_req_00002' });
    await client.post('/api/ai/tutor', { phase: 'pre', stepId: 'S02', sessionId });
    const process = await client.get(`/api/learning/sessions/${sessionId}/process`);
    expect(process.json).toMatchObject({ submittedSteps: 1, totalAttempts: 2, retriedSteps: ['S01'], hintsUsed: 1, tutorRequests: 1 });
    const other = await launch(h.base, 'proc_other');
    expect((await api(h.base, other.token).get(`/api/learning/sessions/${sessionId}/process`)).status).toBe(404);
    const archive = await client.get('/api/learning/archive');
    expect(archive.json.sessions.every((item: { sessionId: number }) => item.sessionId !== other.sessionId)).toBe(true);
    expect(archive.json.sessions[0].ladder).toHaveLength(3);
    const report = await client.post('/api/ai/report', { sessionId });
    expect(report.json.contentMd).toContain('阶梯能力达成');
    expect(report.json.contentMd).toContain('过程评价');
  });
});
