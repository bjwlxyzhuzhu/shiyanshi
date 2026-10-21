export interface ProfileDimension {
  key: string;
  label: string;
  score: number;
  max: number;
  percent: number;
}

export const DIMENSIONS: Array<{ key: string; label: string; steps: string[] }> = [
  { key: 'awareness', label: '安全意识与规范', steps: ['S01', 'S02', 'S03', 'S04', 'S22'] },
  { key: 'data', label: '数据安全', steps: ['S05', 'S06', 'S07', 'S08', 'S09', 'S10'] },
  { key: 'model', label: '模型与智能体安全', steps: ['S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17'] },
  { key: 'facility', label: '设施与运维安全', steps: ['S18', 'S19', 'S20', 'S21'] },
  { key: 'review', label: '复盘与改进', steps: ['S23', 'S24'] }
];

export function buildProfile(
  records: Array<{ stepId: string; score: number; maxScore: number }>
): ProfileDimension[] {
  return DIMENSIONS.map((dimension) => {
    const items = records.filter((record) => dimension.steps.includes(record.stepId));
    const score = items.reduce((sum, record) => sum + record.score, 0);
    const max = items.reduce((sum, record) => sum + record.maxScore, 0);
    return {
      key: dimension.key,
      label: dimension.label,
      score: Number(score.toFixed(1)),
      max,
      percent: max > 0 ? Number(((score / max) * 100).toFixed(1)) : 0
    };
  });
}
