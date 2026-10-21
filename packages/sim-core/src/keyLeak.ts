import { detectionScore, type DetectionScore } from './metrics.js';
import { createRandom } from './random.js';

export const LEAK_HOURS = [2, 3, 4];

export function hourlyCalls(seed = 99): number[] {
  const random = createRandom(seed);
  return Array.from({ length: 24 }, (_, hour) => {
    if (LEAK_HOURS.includes(hour)) return Math.round(620 + random() * 280);
    const daytime = hour >= 8 && hour <= 22;
    const base = daytime ? 120 + 60 * Math.sin(((hour - 8) / 14) * Math.PI) : 18;
    return Math.round(base + random() * 40);
  });
}

export interface KeyLeakResult extends DetectionScore {
  calls: number[];
  flaggedHours: number[];
}

export function detectKeyLeak(threshold: number, calls = hourlyCalls()): KeyLeakResult {
  const flaggedHours = calls
    .map((value, hour) => ({ value, hour }))
    .filter((item) => item.value > threshold)
    .map((item) => item.hour);
  return {
    ...detectionScore(new Set(flaggedHours), new Set(LEAK_HOURS)),
    calls,
    flaggedHours
  };
}
