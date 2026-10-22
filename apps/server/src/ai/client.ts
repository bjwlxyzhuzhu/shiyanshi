import { callModelAudited, type ChatMessage } from '../ilab/aiAudit.js';

export type { ChatMessage };

/**
 * 兼容旧调用方式：只返回文本。实际请求、响应、错误与 usage 由 callModelAudited 写入 ai_invocations。
 * 未配置模型时不会发出请求，审计记为 not_configured（不计入 AI 调用次数）。
 */
export async function callModel(messages: ChatMessage[], context: { sessionId?: number | null; userId?: number | null; stepId?: string; scenario?: string } = {}): Promise<string | null> {
  const result = await callModelAudited(messages, {
    sessionId: context.sessionId ?? null,
    userId: context.userId ?? null,
    stepId: context.stepId ?? '',
    scenario: context.scenario ?? 'unspecified'
  });
  return result.text;
}
