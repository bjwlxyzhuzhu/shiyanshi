import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { DEPLOYMENTS, ilabConfig, type AiCountPolicy } from './config.js';
import { sha256Hex } from './signature.js';
import { AI_SCENARIOS } from './stepMeta.js';

/**
 * AI 调用事件审计。区分：
 * - not_configured：未配置模型，直接规则兜底，没有发出请求 → 任何口径都计 0
 * - response_received：确实收到模型服务的响应（即使随后 JSON 解析失败）
 * - http_error / timeout / network_error / bad_body：已发出但没有可用响应，是否计次取决于口径
 * 只有 S10/S23 的安全助手评审会调用模型；报告是模板、仿真/评分/三维画面都不是模型调用。
 */
export type DispatchState = 'pending' | 'not_configured' | 'response_received' | 'http_error' | 'timeout' | 'network_error' | 'bad_body';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AuditedResult {
  text: string | null;
  invocationId: string;
  /** 本次是否实际向模型服务发出了请求 */
  dispatched: boolean;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (input, init) => fetch(input, init);

export function setModelFetch(next: FetchLike): void {
  fetchImpl = next;
}

export interface CallContext {
  sessionId: number | null;
  userId: number | null;
  stepId: string;
  scenario: string;
}

export async function callModelAudited(messages: ChatMessage[], context: CallContext, options: { timeoutMs?: number; maxAttempts?: number } = {}): Promise<AuditedResult> {
  const base = process.env.AI_BASE_URL;
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  const config = ilabConfig();
  const invocationId = randomUUID();
  const promptHash = sha256Hex(JSON.stringify(messages));
  const insert = db.prepare(`
    INSERT INTO ai_invocations (invocation_id, attempt_no, session_id, user_id, step_id, scenario, dispatch_state, configured_model, configured_version, deployment, provider, prompt_sha256, started_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (!base || !key || !model) {
    const now = Date.now();
    const info = insert.run(invocationId, 1, context.sessionId, context.userId, context.stepId, context.scenario, 'not_configured', null, null, null, null, promptHash, now);
    db.prepare('UPDATE ai_invocations SET ended_ms = ?, final_source = ? WHERE id = ?').run(now, 'rule', Number(info.lastInsertRowid));
    return { text: null, invocationId, dispatched: false };
  }

  const attempts = Math.max(1, Math.min(3, options.maxAttempts ?? Number(process.env.AI_MAX_ATTEMPTS ?? 1)));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    // 先落库“已发出、未结束”，冻结回传前会检查是否仍有未结束的调用
    const info = insert.run(invocationId, attempt, context.sessionId, context.userId, context.stepId, context.scenario, 'pending', model, config.aiModel.version || null, config.aiModel.deployment || null, config.aiModel.provider || null, promptHash, started);
    const rowId = Number(info.lastInsertRowid);
    const finish = (fields: Record<string, unknown>) => {
      const keys = Object.keys(fields);
      db.prepare(`UPDATE ai_invocations SET ${keys.map((k) => `${k} = ?`).join(', ')}, ended_ms = ? WHERE id = ?`).run(...(Object.values(fields) as Array<string | number | null>), Date.now(), rowId);
    };
    try {
      const response = await fetchImpl(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.2 }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5000)
      });
      if (!response.ok) {
        finish({ dispatch_state: 'http_error', upstream_http_status: response.status, failure_class: `http_${response.status}` });
        continue;
      }
      let data: { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try {
        data = await response.json() as typeof data;
      } catch {
        finish({ dispatch_state: 'bad_body', upstream_http_status: response.status, provider_response_received: 1, failure_class: 'non_json_body' });
        continue;
      }
      const prompt = data.usage?.prompt_tokens;
      const completion = data.usage?.completion_tokens;
      const usageComplete = Number.isInteger(prompt) && Number.isInteger(completion);
      finish({
        dispatch_state: 'response_received',
        upstream_http_status: response.status,
        provider_response_received: 1,
        provider_model: typeof data.model === 'string' ? data.model : null,
        prompt_tokens: usageComplete ? prompt! : null,
        completion_tokens: usageComplete ? completion! : null,
        usage_complete: usageComplete ? 1 : 0
      });
      return { text: data.choices?.[0]?.message?.content ?? null, invocationId, dispatched: true };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      finish({ dispatch_state: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error', failure_class: name || 'error' });
    }
  }
  return { text: null, invocationId, dispatched: true };
}

/** 调用者解析模型输出后补记：解析是否成功、最终采用模型还是规则 */
export function markParse(invocationId: string, parseOk: boolean, finalSource: 'model' | 'rule'): void {
  db.prepare('UPDATE ai_invocations SET parse_ok = ?, final_source = ? WHERE invocation_id = ?').run(parseOk ? 1 : 0, finalSource, invocationId);
}

interface InvocationRow {
  invocation_id: string;
  scenario: string | null;
  step_id: string | null;
  dispatch_state: DispatchState;
  provider_response_received: number;
  configured_model: string | null;
  configured_version: string | null;
  deployment: string | null;
  provider: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  usage_complete: number;
  ended_ms: number | null;
}

export interface AiDataResult {
  aiData: Record<string, unknown>;
  blockers: string[];
  audit: { policy: AiCountPolicy; candidatePolicy: 'response_received' | 'dispatched'; dispatchedAttempts: number; responsesReceived: number; notConfigured: number; inFlight: number };
}

const SCENARIO_LABELS: Record<string, string> = {
  'tutor:pre': '实验前方案设计指导与资源推荐',
  'tutor:during': '实验中仿真数据分析与智能反馈',
  'tutor:post': '实验后反思改进与创新路径规划'
};

function scenarioLabel(row: { scenario: string | null; step_id: string | null }): string {
  return SCENARIO_LABELS[row.scenario ?? ''] ?? AI_SCENARIOS[row.step_id ?? ''] ?? row.scenario ?? '';
}

/** 是否仍有已发出但未结束的模型请求（冻结 ai_data 前必须为 0） */
export function inFlightCount(sessionId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM ai_invocations WHERE session_id = ? AND ended_ms IS NULL').get(sessionId) as { c: number };
  return Number(row.c);
}

/**
 * 汇总为 ai_data。口径未确认时用“收到响应才计数”作为候选并给出阻断项；
 * usage 不完整时省略 token 字段；版本/部署未知时不捏造，返回阻断项。
 */
export function buildAiData(sessionId: number, policy: AiCountPolicy = ilabConfig().aiCountPolicy): AiDataResult {
  const rows = db.prepare('SELECT * FROM ai_invocations WHERE session_id = ? ORDER BY id').all(sessionId) as unknown as InvocationRow[];
  const candidate = policy === 'dispatched' ? 'dispatched' : 'response_received';
  const dispatched = rows.filter((row) => row.dispatch_state !== 'not_configured');
  const received = rows.filter((row) => row.provider_response_received === 1);
  const counted = candidate === 'dispatched' ? dispatched : received;
  const blockers: string[] = [];
  if (policy === 'unconfirmed') blockers.push('ai_count_policy_unconfirmed');
  const inFlight = rows.filter((row) => row.ended_ms === null).length;
  if (inFlight > 0) blockers.push('ai_invocation_in_flight');

  const aiData: Record<string, unknown> = { ai_call_count: counted.length, ai_models_used: [], ai_usage_scenarios: [] };
  if (counted.length > 0) {
    const models = new Map<string, Record<string, string>>();
    for (const row of counted) {
      if (!row.configured_model || !row.configured_version || !(DEPLOYMENTS as readonly string[]).includes(row.deployment ?? '')) {
        blockers.push('ai_model_metadata_missing');
        continue;
      }
      const model: Record<string, string> = { model: row.configured_model, version: row.configured_version, deployment: row.deployment! };
      if (row.provider) model.provider = row.provider;
      models.set(JSON.stringify(model), model);
    }
    aiData.ai_models_used = [...models.values()];
    aiData.ai_usage_scenarios = [...new Set(counted.map((row) => scenarioLabel(row)).filter(Boolean))];
    if (counted.every((row) => row.usage_complete === 1)) {
      aiData.ai_input_token_count = counted.reduce((sum, row) => sum + (row.prompt_tokens ?? 0), 0);
      aiData.ai_output_token_count = counted.reduce((sum, row) => sum + (row.completion_tokens ?? 0), 0);
    }
    aiData.ai_remark = '大模型用于实验前方案指导、实验中仿真数据反馈、实验后反思规划与方案评审，均不计分；模型不可用时由知识库规则兜底。';
  } else {
    aiData.ai_remark = '本次实验未产生模型调用；评审由规则引擎完成，报告为本地模板生成。';
  }
  return {
    aiData,
    blockers: [...new Set(blockers)],
    audit: {
      policy,
      candidatePolicy: candidate,
      dispatchedAttempts: dispatched.length,
      responsesReceived: received.length,
      notConfigured: rows.filter((row) => row.dispatch_state === 'not_configured').length,
      inFlight
    }
  };
}
