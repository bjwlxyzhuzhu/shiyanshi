import * as THREE from 'three';

/**
 * 全部纹理在运行时用 Canvas 程序化生成：混凝土细噪、标牌、装饰性屏幕。
 * 重要文字与实验数据仍由 React/HTML 呈现，这里只做环境装饰。
 */
const cache = new Map<string, THREE.Texture>();

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')!];
}

function finish(element: HTMLCanvasElement, key: string, repeat?: [number, number], color = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  cache.set(key, texture);
  return texture;
}

/** 确定性伪随机，保证每次生成的纹理一致 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function concreteTexture(base: string, seed = 7): THREE.Texture {
  const key = `concrete:${base}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 256;
  const [element, ctx] = canvas(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const random = rng(seed);
  for (let index = 0; index < 26; index++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 20 + random() * 60;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const shade = random() > 0.5 ? '255,255,255' : '0,0,0';
    gradient.addColorStop(0, `rgba(${shade},${0.035 + random() * 0.03})`);
    gradient.addColorStop(1, `rgba(${shade},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let index = 0; index < 1400; index++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(random() * size, random() * size, 1, 1);
  }
  return finish(element, key, [1, 1]);
}

export function signTexture(title: string, subtitle: string, accent = '#67D2E3', code?: string): THREE.Texture {
  const key = `sign:${title}:${subtitle}:${accent}:${code ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(1024, 256);
  ctx.fillStyle = '#101b25';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = accent;
  ctx.fillRect(56, 54, 12, 148);
  ctx.fillStyle = '#EDF4FA';
  ctx.font = '600 92px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, 100, 140);
  ctx.fillStyle = '#A7BAC9';
  ctx.font = '500 40px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(subtitle, 104, 196);
  if (code) {
    ctx.strokeStyle = 'rgba(167,186,201,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(880, 70, 100, 100);
    ctx.fillStyle = '#EDF4FA';
    ctx.font = '600 56px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(code, 930, 140);
  }
  return finish(element, key);
}

export function logoTexture(): THREE.Texture {
  const key = 'logo';
  const hit = cache.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(512, 160);
  ctx.clearRect(0, 0, 512, 160);
  ctx.fillStyle = '#F4B740';
  roundRect(ctx, 16, 24, 112, 112, 18);
  ctx.fill();
  ctx.fillStyle = '#152332';
  ctx.font = '700 84px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('安', 72, 84);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1D3041';
  ctx.font = '700 72px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.fillText('智安工坊', 150, 84);
  return finish(element, key);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export type ScreenStyle = 'data' | 'model' | 'sandbox' | 'agent' | 'gpu' | 'power' | 'cooling' | 'audit' | 'review' | 'kiosk' | 'briefing' | 'incident' | 'network';

/** 装饰性屏幕：抽象界面线框，不含任何实验数据或答案 */
export function screenTexture(style: ScreenStyle, seed = 1): THREE.Texture {
  const key = `screen:${style}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(512, 320);
  const random = rng(seed * 97 + style.length * 13);
  const gradient = ctx.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, '#0d2438');
  gradient.addColorStop(1, '#081723');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = 'rgba(103,210,227,0.9)';
  ctx.fillRect(18, 16, 120, 6);
  ctx.fillStyle = 'rgba(167,186,201,0.35)';
  for (let row = 0; row < 3; row++) ctx.fillRect(18, 34 + row * 12, 60 + random() * 70, 5);

  ctx.strokeStyle = 'rgba(103,210,227,0.55)';
  ctx.lineWidth = 2;
  if (style === 'data' || style === 'kiosk' || style === 'briefing') {
    for (let row = 0; row < 5; row++) {
      const y = 92 + row * 42;
      ctx.strokeRect(170, y, 310, 32);
      ctx.fillStyle = 'rgba(167,186,201,0.5)';
      ctx.fillRect(184, y + 13, 50, 6);
      ctx.fillStyle = 'rgba(103,210,227,0.35)';
      ctx.fillRect(260, y + 13, 80 + random() * 120, 6);
    }
    ctx.beginPath();
    ctx.moveTo(90, 120);
    ctx.lineTo(130, 136);
    ctx.lineTo(130, 186);
    ctx.quadraticCurveTo(90, 226, 90, 226);
    ctx.quadraticCurveTo(50, 206, 50, 186);
    ctx.lineTo(50, 136);
    ctx.closePath();
    ctx.stroke();
  } else if (style === 'gpu' || style === 'cooling' || style === 'power') {
    for (let col = 0; col < 6; col++) {
      const x = 30 + col * 78;
      ctx.strokeRect(x, 96, 60, 160);
      for (let tray = 0; tray < 6; tray++) {
        ctx.fillStyle = `rgba(103,210,227,${0.2 + random() * 0.4})`;
        ctx.fillRect(x + 8, 106 + tray * 24, 44, 10);
      }
    }
  } else if (style === 'agent' || style === 'network' || style === 'model') {
    const nodes: Array<[number, number]> = [];
    for (let index = 0; index < 9; index++) nodes.push([60 + random() * 400, 90 + random() * 200]);
    ctx.strokeStyle = 'rgba(103,210,227,0.4)';
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        if (random() > 0.72) {
          ctx.beginPath();
          ctx.moveTo(...nodes[a]!);
          ctx.lineTo(...nodes[b]!);
          ctx.stroke();
        }
      }
    }
    for (const [x, y] of nodes) {
      ctx.fillStyle = 'rgba(103,210,227,0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(30, 260);
    for (let x = 30; x <= 480; x += 15) ctx.lineTo(x, 150 + Math.sin(x / 40 + seed) * 40 + random() * 30);
    ctx.stroke();
    for (let row = 0; row < 4; row++) {
      ctx.fillStyle = 'rgba(167,186,201,0.4)';
      ctx.fillRect(30, 90 + row * 14, 100 + random() * 200, 6);
    }
  }
  return finish(element, key);
}

/** 墙面公告板：仅放实验守则标题，正文仍在 HTML 面板 */
export function noticeTexture(): THREE.Texture {
  const key = 'notice';
  const hit = cache.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(1024, 340);
  ctx.fillStyle = '#122130';
  ctx.fillRect(0, 0, 1024, 340);
  ctx.fillStyle = '#F4B740';
  ctx.fillRect(48, 48, 10, 64);
  ctx.fillStyle = '#EDF4FA';
  ctx.font = '600 56px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.fillText('人工智能实验安全守则', 84, 100);
  ctx.font = '400 32px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.fillStyle = '#A7BAC9';
  ['准入核验 · 风险分级 · 应急预案', '数据最小化 · 模型合规 · 工具最小权限', '过温即停 · 日志留痕 · 事件上报'].forEach((line, index) => {
    ctx.fillText(line, 84, 170 + index * 52);
  });
  return finish(element, key);
}

/** 复盘室墙面：五阶段进度，按服务端已提交记录绘制 */
export function stageWallTexture(stages: Array<{ label: string; done: number; total: number; current: boolean }>): THREE.CanvasTexture {
  const [element, ctx] = canvas(1024, 320);
  ctx.fillStyle = '#0f1c28';
  ctx.fillRect(0, 0, 1024, 320);
  ctx.fillStyle = 'rgba(167,186,201,0.7)';
  ctx.font = '500 26px "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText('实验进度 · 依据已提交记录', 48, 54);
  const step = 920 / (stages.length - 1);
  ctx.strokeStyle = 'rgba(103,210,227,0.35)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(52, 170);
  ctx.lineTo(52 + step * (stages.length - 1), 170);
  ctx.stroke();
  stages.forEach((stage, index) => {
    const x = 52 + step * index;
    const complete = stage.done === stage.total;
    ctx.fillStyle = stage.current ? '#F4B740' : complete ? '#67D2E3' : '#395163';
    ctx.beginPath();
    ctx.arc(x, 170, stage.current ? 16 : 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#EDF4FA';
    ctx.font = '600 30px "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = index === 0 ? 'left' : index === stages.length - 1 ? 'right' : 'center';
    ctx.fillText(stage.label, x, 236);
    ctx.fillStyle = '#A7BAC9';
    ctx.font = '400 24px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`${stage.done}/${stage.total} 已提交`, x, 274);
    ctx.textAlign = 'left';
  });
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 小标签（机柜编号、样本序号等），白字深底 */
export function labelTexture(text: string, background = '#101b25', color = '#EDF4FA'): THREE.Texture {
  const key = `label:${text}:${background}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(256, 96);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = color;
  ctx.font = '600 52px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  return finish(element, key);
}

/** 智能体攻击路径节点：工具名 + 实际判定，颜色同时配文字 */
export function nodeTexture(title: string, status: string, color: string): THREE.Texture {
  const key = `node:${title}:${status}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(512, 224);
  ctx.fillStyle = 'rgba(10,22,32,0.92)';
  ctx.fillRect(0, 0, 512, 224);
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 212);
  ctx.fillStyle = '#EDF4FA';
  ctx.font = '600 64px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 98);
  ctx.fillStyle = color;
  ctx.font = '600 48px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.fillText(status, 256, 172);
  return finish(element, key);
}
