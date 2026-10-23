import { clamp01, round } from './metrics.js';

/**
 * 产线工位摄像头图像的人脸去标识化（数字图像处理）。
 * 训练任务是识别“是否佩戴护目镜”，人脸身份与任务无关：
 * - 身份细节主要在高频（五官边缘、纹理），用拉普拉斯能量衡量“可识别细节残留”；
 * - 护目镜是低频的深色横带，用“护目镜带与面部皮肤的亮度对比”衡量任务可用性。
 * 合适强度的马赛克/高斯模糊能去掉高频而保留低频；涂黑或删除会毁掉任务信息，强度过大也会。
 * 图像为程序生成的 48×48 合成图，不含任何真实人像。
 */
export const IMAGE_SIZE = 48;
/** 人脸区域（含护目镜）：[x0, y0, x1, y1)，右开区间 */
export const FACE_BOX = [12, 6, 36, 34] as const;
const GOGGLE_ROWS: [number, number] = [15, 20];
const SKIN_ROWS: [number, number] = [23, 31];

export const PHOTO_OPTIONS = ['保留原图', '人脸区域马赛克', '人脸区域高斯模糊', '人脸区域涂黑', '删除整张图像'] as const;
export type PhotoOption = (typeof PHOTO_OPTIONS)[number];

function inFace(x: number, y: number): boolean {
  return x >= FACE_BOX[0] && x < FACE_BOX[2] && y >= FACE_BOX[1] && y < FACE_BOX[3];
}

/** 确定性合成图：浅色背景、实验服、面部椭圆、护目镜、五官细节与发丝纹理 */
export function syntheticPortrait(): number[] {
  const n = IMAGE_SIZE;
  const pixels = new Array<number>(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 228 - y * 0.6;
      // 实验服（下半身，白色带深色领口）
      if (y >= 36) v = Math.abs(x - 24) < 3 ? 70 : 236;
      // 头发
      const dxh = (x - 24) / 13;
      const dyh = (y - 15) / 11;
      if (dxh * dxh + dyh * dyh < 1 && y < 16) v = 55 + ((x * 7 + y * 3) % 5) * 6;
      // 面部椭圆
      const dx = (x - 24) / 10.5;
      const dy = (y - 20) / 12.5;
      if (dx * dx + dy * dy < 1 && y >= 11) v = 196 + ((x * 13 + y * 7) % 3) * 3;
      // 护目镜横带（任务信息，低频）
      if (y >= GOGGLE_ROWS[0] && y < GOGGLE_ROWS[1] && x >= 15 && x < 33) v = 48;
      // 镜片高光、鼻梁、嘴、眉弓：身份细节（高频）
      if ((y === 16 || y === 17) && (x === 19 || x === 20 || x === 28 || x === 29)) v = 210;
      if (x === 24 && y >= 21 && y <= 25) v = 150;
      if (y === 28 && x >= 21 && x <= 27) v = 95;
      if (y === 13 && ((x >= 17 && x <= 21) || (x >= 27 && x <= 31))) v = 70;
      if ((y === 23 || y === 24) && (x === 17 || x === 31)) v = 160;
      pixels[y * n + x] = Math.round(v);
    }
  }
  return pixels;
}

function mosaic(source: number[], block: number): number[] {
  const out = [...source];
  const [x0, y0, x1, y1] = FACE_BOX;
  for (let by = y0; by < y1; by += block) {
    for (let bx = x0; bx < x1; bx += block) {
      let sum = 0;
      let count = 0;
      for (let y = by; y < Math.min(by + block, y1); y++) {
        for (let x = bx; x < Math.min(bx + block, x1); x++) {
          sum += source[y * IMAGE_SIZE + x]!;
          count += 1;
        }
      }
      const mean = Math.round(sum / count);
      for (let y = by; y < Math.min(by + block, y1); y++) {
        for (let x = bx; x < Math.min(bx + block, x1); x++) out[y * IMAGE_SIZE + x] = mean;
      }
    }
  }
  return out;
}

/** 可分离高斯模糊，只作用于人脸区域，边界复制 */
function gaussian(source: number[], radius: number): number[] {
  const sigma = Math.max(0.5, radius / 2);
  const reach = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  for (let i = -reach; i <= reach; i++) kernel.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  const n = IMAGE_SIZE;
  const at = (img: number[], x: number, y: number) => img[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))]!;
  const horizontal = [...source];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let acc = 0;
      kernel.forEach((w, k) => { acc += w * at(source, x + k - reach, y); });
      horizontal[y * n + x] = acc / total;
    }
  }
  const out = [...source];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!inFace(x, y)) continue;
      let acc = 0;
      kernel.forEach((w, k) => { acc += w * at(horizontal, x, y + k - reach); });
      out[y * n + x] = Math.round(acc / total);
    }
  }
  return out;
}

/** 人脸区域拉普拉斯绝对值能量（高频细节） */
export function laplacianEnergy(img: number[]): number {
  const n = IMAGE_SIZE;
  const [x0, y0, x1, y1] = FACE_BOX;
  let energy = 0;
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const c = img[y * n + x]!;
      energy += Math.abs(4 * c - img[y * n + x - 1]! - img[y * n + x + 1]! - img[(y - 1) * n + x]! - img[(y + 1) * n + x]!);
    }
  }
  return energy;
}

function bandMean(img: number[], rows: [number, number]): number {
  let sum = 0;
  let count = 0;
  for (let y = rows[0]; y < rows[1]; y++) {
    for (let x = 17; x < 31; x++) {
      sum += img[y * IMAGE_SIZE + x]!;
      count += 1;
    }
  }
  return sum / count;
}

export interface ImageDeidResult {
  width: number;
  height: number;
  original: number[];
  processed: number[] | null;
  /** 人脸区域高频细节残留比例（0–1，越低越难识别身份） */
  identifiability: number;
  /** 护目镜与皮肤亮度对比保留比例（0–1，越高越利于训练任务） */
  taskUtility: number;
}

export function processPortrait(option: string, strength: number): ImageDeidResult {
  const original = syntheticPortrait();
  const size = Math.min(12, Math.max(1, Math.round(Number.isFinite(strength) ? strength : 1)));
  let processed: number[] | null;
  switch (option as PhotoOption) {
    case '人脸区域马赛克': processed = mosaic(original, size); break;
    case '人脸区域高斯模糊': processed = gaussian(original, size); break;
    case '人脸区域涂黑': processed = original.map((v, i) => (inFace(i % IMAGE_SIZE, Math.floor(i / IMAGE_SIZE)) ? 0 : v)); break;
    case '删除整张图像': processed = null; break;
    default: processed = [...original];
  }
  const baseEnergy = laplacianEnergy(original);
  const baseContrast = bandMean(original, SKIN_ROWS) - bandMean(original, GOGGLE_ROWS);
  const identifiability = processed ? clamp01(laplacianEnergy(processed) / baseEnergy) : 0;
  const taskUtility = processed ? clamp01((bandMean(processed, SKIN_ROWS) - bandMean(processed, GOGGLE_ROWS)) / baseContrast) : 0;
  return { width: IMAGE_SIZE, height: IMAGE_SIZE, original, processed, identifiability: round(identifiability, 3), taskUtility: round(taskUtility, 3) };
}

/** 身份不可识别（残留 ≤ 0.2 满分，≥ 0.6 为 0）占 60%，任务可用性占 40% */
export function imageDeidScore(result: Pick<ImageDeidResult, 'identifiability' | 'taskUtility'>): number {
  const privacy = clamp01((0.6 - result.identifiability) / 0.4);
  return round(0.6 * privacy + 0.4 * result.taskUtility, 4);
}

/** 在全部选项与强度上可达到的最好分，用于归一化 */
export function bestImageDeid(): { option: string; strength: number; score: number } {
  let best = { option: PHOTO_OPTIONS[0] as string, strength: 1, score: -1 };
  for (const option of PHOTO_OPTIONS) {
    for (let strength = 1; strength <= 12; strength++) {
      const score = imageDeidScore(processPortrait(option, strength));
      if (score > best.score) best = { option, strength, score };
    }
  }
  return best;
}
