import { round } from './metrics.js';

export const GROUPS = {
  城镇: { size: 1200, positiveRate: 0.42, truePositiveRate: 0.86 },
  农村: { size: 800, positiveRate: 0.29, truePositiveRate: 0.71 }
} as const;

export interface FairnessResult {
  demographicParityDiff: number;
  equalOpportunityDiff: number;
  value: number;
  exceeds: boolean;
}

export function evaluateFairness(metric: string, threshold: number): FairnessResult {
  const demographicParityDiff = round(Math.abs(GROUPS.城镇.positiveRate - GROUPS.农村.positiveRate));
  const equalOpportunityDiff = round(Math.abs(GROUPS.城镇.truePositiveRate - GROUPS.农村.truePositiveRate));
  const value = metric === '机会均等差' ? equalOpportunityDiff : demographicParityDiff;
  return { demographicParityDiff, equalOpportunityDiff, value, exceeds: value > threshold };
}
