export type RiskLevel = '低' | '中' | '高' | '极高';

const DATA_POINTS: Record<string, number> = { 公开数据: 0, 内部数据: 1, 含个人信息: 2, 含敏感个人信息: 3 };
const MODEL_POINTS: Record<string, number> = { '小模型(<1B)': 0, '中模型(1–10B)': 1, '大模型(>10B)': 2 };
const TOOL_POINTS: Record<string, number> = { 无工具: 0, 只读工具: 1, '可写/可外发工具': 2 };

const ORDER: RiskLevel[] = ['低', '中', '高', '极高'];

export function assessRisk(dataLevel: string, modelScale: string, toolUse: string): { level: RiskLevel; points: number } {
  const data = DATA_POINTS[dataLevel] ?? 0;
  const tool = TOOL_POINTS[toolUse] ?? 0;
  const points = data + (MODEL_POINTS[modelScale] ?? 0) + tool;
  let index = points <= 1 ? 0 : points <= 3 ? 1 : points <= 5 ? 2 : 3;
  if (data >= 2 && tool >= 2) index = Math.max(index, 2);
  return { level: ORDER[index]!, points };
}
