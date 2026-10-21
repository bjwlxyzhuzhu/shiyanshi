export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 勾选题：选对一项加一分、选错一项扣一分，按应选项数归一化；什么都不选得 0。 */
export function checklistAccuracy(selected: string[], correct: string[], options: string[]): number {
  if (correct.length === 0) return 0;
  const valid = new Set(options);
  const truth = new Set(correct);
  const picked = [...new Set(selected)].filter((item) => valid.has(item));
  const hits = picked.filter((item) => truth.has(item)).length;
  const wrong = picked.length - hits;
  return Math.max(0, (hits - wrong) / truth.size);
}

/** 排序题：按 Kendall 一致对比例计算相似度，完全正确为 1，完全逆序为 0。 */
export function orderSimilarity(sequence: string[], correct: string[]): number {
  const position = new Map(sequence.map((item, index) => [item, index]));
  if (correct.some((item) => !position.has(item))) return 0;
  let concordant = 0;
  let total = 0;
  for (let i = 0; i < correct.length; i++) {
    for (let j = i + 1; j < correct.length; j++) {
      total++;
      if (position.get(correct[i]!)! < position.get(correct[j]!)!) concordant++;
    }
  }
  return total === 0 ? 1 : concordant / total;
}

export interface DetectionScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export function detectionScore(predicted: Set<number>, truth: Set<number>): DetectionScore {
  let tp = 0;
  let fp = 0;
  for (const item of predicted) {
    if (truth.has(item)) tp++;
    else fp++;
  }
  const fn = [...truth].filter((item) => !predicted.has(item)).length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision: round(precision), recall: round(recall), f1: round(f1) };
}
