export type ToolLevel = '禁止' | '只读' | '需人工确认' | '自动允许';

export const ACCEPTABLE_LEVELS: Record<string, ToolLevel[]> = {
  文件读取: ['只读', '需人工确认'],
  文件删除: ['禁止', '需人工确认'],
  发送邮件: ['需人工确认', '禁止'],
  执行系统命令: ['禁止'],
  联网检索: ['只读', '需人工确认'],
  // 设施高危操作不得交给智能体（R14）
  机房电源与制冷控制: ['禁止']
};

export interface AttackStep {
  action: string;
  tool: string;
  outcome: '执行' | '被拦截' | '待人工确认';
}

export interface AttackResult {
  blocked: boolean;
  trace: AttackStep[];
  compliantTools: number;
}

function outcomeFor(level: string, needsWrite: boolean): AttackStep['outcome'] {
  if (level === '禁止') return '被拦截';
  if (level === '需人工确认') return '待人工确认';
  if (level === '只读' && needsWrite) return '被拦截';
  return '执行';
}

/** 模拟一次间接提示注入：诱导智能体读取企业质检数据文件并外发。 */
export function simulateExfiltration(levels: Record<string, string>): AttackResult {
  const read = outcomeFor(levels['文件读取'] ?? '自动允许', false);
  const trace: AttackStep[] = [{ action: '读取 qc_records.csv', tool: '文件读取', outcome: read }];

  if (read === '执行') {
    trace.push({ action: '把文件发送到外部邮箱', tool: '发送邮件', outcome: outcomeFor(levels['发送邮件'] ?? '自动允许', true) });
    trace.push({ action: '把数据拼进检索链接外传', tool: '联网检索', outcome: outcomeFor(levels['联网检索'] ?? '自动允许', true) });
    trace.push({ action: '执行 curl 上传文件', tool: '执行系统命令', outcome: outcomeFor(levels['执行系统命令'] ?? '自动允许', true) });
  }

  const blocked = read !== '执行' || trace.slice(1).every((step) => step.outcome !== '执行');
  const compliantTools = Object.entries(ACCEPTABLE_LEVELS)
    .filter(([tool, ok]) => ok.includes((levels[tool] ?? '') as ToolLevel)).length;

  return { blocked, trace, compliantTools };
}
