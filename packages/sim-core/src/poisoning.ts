import { detectionScore, round, type DetectionScore } from './metrics.js';
import { createRandom, gaussian } from './random.js';

export interface Sample {
  index: number;
  score: number;
  hasTrigger: boolean;
  poisoned: boolean;
}

export const POISON_SEED = 20261021;

export function buildDataset(size = 200, poisonedCount = 12, seed = POISON_SEED): Sample[] {
  const random = createRandom(seed);
  const poisonedSet = new Set<number>();
  while (poisonedSet.size < poisonedCount) poisonedSet.add(Math.floor(random() * size));

  const samples: Sample[] = [];
  for (let index = 0; index < size; index++) {
    const poisoned = poisonedSet.has(index);
    const score = poisoned
      ? Math.abs(2.3 + gaussian(random) * 0.7)
      : Math.abs(gaussian(random));
    const hasTrigger = poisoned ? random() < 0.6 : random() < 0.01;
    samples.push({ index, score: round(score), hasTrigger, poisoned });
  }
  return samples;
}

export type PoisonMethod = '仅看标签分布' | '基于特征离群度' | '离群度 + 触发词扫描';

export interface PoisonResult extends DetectionScore {
  flagged: number;
  sortedScores: number[];
}

export function detectPoisoning(method: string, threshold: number, samples = buildDataset()): PoisonResult {
  const random = createRandom(7);
  const predicted = new Set<number>();
  for (const sample of samples) {
    let hit: boolean;
    if (method === '仅看标签分布') {
      hit = random() < 0.06;
    } else {
      hit = sample.score >= threshold;
      if (method === '离群度 + 触发词扫描' && sample.hasTrigger) hit = true;
    }
    if (hit) predicted.add(sample.index);
  }
  const truth = new Set(samples.filter((sample) => sample.poisoned).map((sample) => sample.index));
  return {
    ...detectionScore(predicted, truth),
    flagged: predicted.size,
    sortedScores: samples.map((sample) => sample.score).sort((a, b) => b - a).slice(0, 60)
  };
}

/** 在 0.5–5.0 区间扫描阈值，得到本数据集可达到的最优检测效果，用于判分归一化。 */
export function bestPoisonSetting(samples = buildDataset()): { method: PoisonMethod; threshold: number; f1: number } {
  let best = { method: '离群度 + 触发词扫描' as PoisonMethod, threshold: 2, f1: 0 };
  for (const method of ['基于特征离群度', '离群度 + 触发词扫描'] as PoisonMethod[]) {
    for (let step = 5; step <= 50; step++) {
      const threshold = step / 10;
      const { f1 } = detectPoisoning(method, threshold, samples);
      if (f1 > best.f1) best = { method, threshold, f1 };
    }
  }
  return best;
}
