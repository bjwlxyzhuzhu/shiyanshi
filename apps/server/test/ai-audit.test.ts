import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { buildAiData, setModelFetch } from '../src/ilab/aiAudit.js';
import { validateAiData } from '../src/ilab/validate.js';
import { api, configure, launch, startServer, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startServer();
});
afterAll(() => h.close());

function useModel(meta: { version?: string; deployment?: string } = {}) {
  process.env.AI_BASE_URL = 'https://model.example.invalid/v1';
  process.env.AI_API_KEY = 'test-only-key';
  process.env.AI_MODEL = 'test-model';
  configure({ aiModel: { model: 'test-model', version: meta.version ?? '', deployment: meta.deployment ?? '', provider: '' } });
}

function noModel() {
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  configure();
}

const reply = (content: string, usage?: object) =>
  async () => new Response(JSON.stringify({ model: 'test-model-2026', choices: [{ message: { content } }], ...(usage ? { usage } : {}) }), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function review(token: string, sessionId: number) {
  return api(h.base, token).post('/api/ai/review', { stepId: 'S23', input: { actions: '关闭所有日志以防泄露' }, sessionId });
}

beforeEach(() => noModel());

describe('AI 调用审计', () => {
  it('未配置模型：规则兜底，ai_logs 有记录但调用次数为 0', async () => {
    const { token, sessionId } = await launch(h.base, 'ai_none');
    const res = await review(token, sessionId);
    expect(res.json.source).toBe('rule');
    const logs = db.prepare('SELECT COUNT(*) AS c FROM ai_logs WHERE session_id = ?').get(sessionId) as { c: number };
    expect(logs.c).toBe(1);
    const ai = buildAiData(sessionId, 'response_received');
    expect(ai.aiData).toMatchObject({ ai_call_count: 0, ai_models_used: [], ai_usage_scenarios: [] });
    expect(ai.audit.notConfigured).toBe(1);
    expect(validateAiData(ai.aiData)).toEqual([]);
  });

  it('收到模型响应但 JSON 解析失败：最终是规则结果，但真实调用仍被记录', async () => {
    useModel({ version: '2026-05', deployment: '私有化部署' });
    setModelFetch(reply('这不是 JSON', { prompt_tokens: 120, completion_tokens: 30 }));
    const { token, sessionId } = await launch(h.base, 'ai_badjson');
    const res = await review(token, sessionId);
    expect(res.json.source).toBe('rule');
    const row = db.prepare('SELECT dispatch_state, provider_response_received, parse_ok, final_source FROM ai_invocations WHERE session_id = ?').get(sessionId);
    expect(row).toEqual({ dispatch_state: 'response_received', provider_response_received: 1, parse_ok: 0, final_source: 'rule' });
    const ai = buildAiData(sessionId, 'response_received');
    expect(ai.aiData.ai_call_count).toBe(1);
    expect(ai.aiData.ai_models_used).toEqual([{ model: 'test-model', version: '2026-05', deployment: '私有化部署' }]);
    expect(ai.aiData.ai_usage_scenarios).toEqual(['事故整改方案智能评审']);
    expect(ai.aiData.ai_input_token_count).toBe(120);
    expect(validateAiData(ai.aiData)).toEqual([]);
  });

  it('超时与上游错误：保留审计；只有“dispatched”口径才计数', async () => {
    useModel({ version: 'v1', deployment: '公有云服务' });
    setModelFetch(async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    const { token, sessionId } = await launch(h.base, 'ai_timeout');
    await review(token, sessionId);
    setModelFetch(async () => new Response('busy', { status: 503 }));
    await review(token, sessionId);
    const states = (db.prepare('SELECT dispatch_state FROM ai_invocations WHERE session_id = ? ORDER BY id').all(sessionId) as Array<{ dispatch_state: string }>).map((r) => r.dispatch_state);
    expect(states).toEqual(['timeout', 'http_error']);
    expect(buildAiData(sessionId, 'response_received').aiData.ai_call_count).toBe(0);
    expect(buildAiData(sessionId, 'dispatched').aiData.ai_call_count).toBe(2);
    expect(buildAiData(sessionId, 'unconfirmed').blockers).toContain('ai_count_policy_unconfirmed');
  });

  it('usage 缺失时省略 token 字段（不估算、不补 0）', async () => {
    useModel({ version: 'v1', deployment: '本地运行' });
    setModelFetch(reply('{"risks":[{"level":"low","item":"a","reason":"b"}]}'));
    const { token, sessionId } = await launch(h.base, 'ai_nousage');
    const res = await review(token, sessionId);
    expect(res.json.source).toBe('model');
    const ai = buildAiData(sessionId, 'response_received');
    expect(ai.aiData.ai_call_count).toBe(1);
    expect('ai_input_token_count' in ai.aiData).toBe(false);
    expect('ai_output_token_count' in ai.aiData).toBe(false);
  });

  it('模型版本未配置：不捏造版本，给出阻断项', async () => {
    useModel({ version: '', deployment: '公有云服务' });
    setModelFetch(reply('{"risks":[{"level":"low","item":"a","reason":"b"}]}', { prompt_tokens: 1, completion_tokens: 1 }));
    const { token, sessionId } = await launch(h.base, 'ai_noversion');
    await review(token, sessionId);
    const ai = buildAiData(sessionId, 'response_received');
    expect(ai.blockers).toContain('ai_model_metadata_missing');
    expect(JSON.stringify(ai.aiData)).not.toContain('1.0');
  });

  it('不能把 AI 调用记到别人的会话上', async () => {
    const victim = await launch(h.base, 'ai_victim');
    const attacker = await launch(h.base, 'ai_attacker');
    await review(attacker.token, victim.sessionId);
    const count = db.prepare('SELECT COUNT(*) AS c FROM ai_invocations WHERE session_id = ?').get(victim.sessionId) as { c: number };
    expect(count.c).toBe(0);
  });

  it('报告生成与仿真预览不产生 AI 调用', async () => {
    const { token, sessionId } = await launch(h.base, 'ai_report');
    const client = api(h.base, token);
    await client.post('/api/ai/report', { sessionId });
    await client.post('/api/experiment/preview/S16', { input: { loadPct: 90, fanPct: 30, ambientC: 26 } });
    const count = db.prepare('SELECT COUNT(*) AS c FROM ai_invocations WHERE session_id = ?').get(sessionId) as { c: number };
    expect(count.c).toBe(0);
  });
});
