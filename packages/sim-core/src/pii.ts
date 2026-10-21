import { clamp01, round } from './metrics.js';

export const SAMPLE_RECORD = {
  name: '张伟',
  phone: '13812345678',
  idCard: '610303200201015678',
  health: '有轻度焦虑，近期睡眠差'
};

export interface PiiHit {
  type: '手机号' | '身份证号';
  value: string;
}

const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const ID_CARD = /(?<![0-9Xx])\d{17}[\dXx](?![0-9Xx])/g;

export function detectPii(text: string): PiiHit[] {
  const hits: PiiHit[] = [];
  for (const match of text.matchAll(ID_CARD)) hits.push({ type: '身份证号', value: match[0] });
  const withoutIds = text.replace(ID_CARD, '');
  for (const match of withoutIds.matchAll(PHONE)) hits.push({ type: '手机号', value: match[0] });
  return hits;
}

type Strategy = '保留' | '部分遮蔽' | '假名化' | '删除' | '泛化为类别';

const RISK: Record<string, Record<string, number>> = {
  name: { 保留: 0.25, 部分遮蔽: 0.12, 假名化: 0.02, 删除: 0 },
  phone: { 保留: 0.25, 部分遮蔽: 0.05, 假名化: 0.02, 删除: 0 },
  idCard: { 保留: 0.35, 部分遮蔽: 0.15, 假名化: 0.03, 删除: 0 },
  health: { 保留: 0.25, 泛化为类别: 0.04, 删除: 0 }
};

const UTILITY: Record<string, Record<string, number>> = {
  name: { 保留: 1, 部分遮蔽: 1, 假名化: 1, 删除: 0.9 },
  health: { 保留: 1, 泛化为类别: 0.85, 删除: 0.3 }
};

const MAX_RISK = 0.25 + 0.25 + 0.35 + 0.25;

function applyName(value: string, strategy: Strategy): string {
  if (strategy === '部分遮蔽') return `${value.slice(0, 1)}*`;
  if (strategy === '假名化') return '受访者A017';
  if (strategy === '删除') return '[已删除]';
  return value;
}

function applyPhone(value: string, strategy: Strategy): string {
  if (strategy === '部分遮蔽') return `${value.slice(0, 3)}****${value.slice(-4)}`;
  if (strategy === '假名化') return 'TEL-7f3a';
  if (strategy === '删除') return '[已删除]';
  return value;
}

function applyIdCard(value: string, strategy: Strategy): string {
  if (strategy === '部分遮蔽') return `${value.slice(0, 6)}********${value.slice(-4)}`;
  if (strategy === '假名化') return 'ID-c91e';
  if (strategy === '删除') return '[已删除]';
  return value;
}

function applyHealth(value: string, strategy: Strategy): string {
  if (strategy === '泛化为类别') return '心理健康类';
  if (strategy === '删除') return '[已删除]';
  return value;
}

export interface DesensitizeResult {
  masked: string;
  residualHits: PiiHit[];
  riskIndex: number;
  utility: number;
}

export function desensitize(strategies: Record<'name' | 'phone' | 'idCard' | 'health', string>): DesensitizeResult {
  const s = strategies as Record<'name' | 'phone' | 'idCard' | 'health', Strategy>;
  const masked =
    `${applyName(SAMPLE_RECORD.name, s.name)}，手机 ${applyPhone(SAMPLE_RECORD.phone, s.phone)}，` +
    `身份证 ${applyIdCard(SAMPLE_RECORD.idCard, s.idCard)}，健康状况：${applyHealth(SAMPLE_RECORD.health, s.health)}`;

  const risk =
    (RISK.name![s.name] ?? 0.25) +
    (RISK.phone![s.phone] ?? 0.25) +
    (RISK.idCard![s.idCard] ?? 0.35) +
    (RISK.health![s.health] ?? 0.25);
  const utility = ((UTILITY.name![s.name] ?? 1) + (UTILITY.health![s.health] ?? 1)) / 2;

  return {
    masked,
    residualHits: detectPii(masked),
    riskIndex: round(clamp01(risk / MAX_RISK)),
    utility: round(utility)
  };
}

/** 隐私占 70%、可用性占 30%，残留可识别标识每条扣 0.15。 */
export function desensitizeScore(result: DesensitizeResult): number {
  return clamp01((1 - result.riskIndex) * 0.7 + result.utility * 0.3 - result.residualHits.length * 0.15);
}

/** 穷举全部策略组合，得到可达到的最高得分，用于判分归一化。 */
export function bestDesensitizeScore(): number {
  const masking = ['保留', '部分遮蔽', '假名化', '删除'];
  const health = ['保留', '泛化为类别', '删除'];
  let best = 0;
  for (const name of masking) {
    for (const phone of masking) {
      for (const idCard of masking) {
        for (const h of health) {
          best = Math.max(best, desensitizeScore(desensitize({ name, phone, idCard, health: h })));
        }
      }
    }
  }
  return best;
}
