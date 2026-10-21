import { create } from 'zustand';
import { SPAWN } from './layout';

export type WorldMode = 'attract' | 'loading' | 'exploring' | 'focusing' | 'operating' | 'returning';
export type Quality = 'high' | 'medium' | 'low';

/**
 * 每帧变化的人物/相机数据放在可变对象里，不进 React 状态；
 * UI 只订阅下面 store 中的低频状态。
 */
export const player = {
  x: SPAWN[0],
  z: SPAWN[1],
  yaw: -Math.PI / 2,
  speed: 0,
  /** 本帧有效位移，驱动步态 */
  moved: 0
};

export const camera = {
  yaw: -Math.PI / 2,
  pitch: 0.16,
  dragging: false
};

export const perf = {
  frames: [] as number[],
  drawCalls: 0,
  triangles: 0
};

const PREFS_KEY = 'zhian.world.prefs';

function readPrefs(): { quality: Quality; reduceMotion: boolean } {
  const fallback = {
    quality: 'medium' as Quality,
    reduceMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<{ quality: Quality; reduceMotion: boolean }>;
    return {
      quality: parsed.quality === 'high' || parsed.quality === 'low' || parsed.quality === 'medium' ? parsed.quality : fallback.quality,
      reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : fallback.reduceMotion
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: { quality: Quality; reduceMotion: boolean }): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 存储不可用只影响偏好记忆
  }
}

interface WorldStore {
  mode: WorldMode;
  /** 范围内可交互的热点（低频更新） */
  nearHotspotId: string | null;
  /** 正在操作的热点 */
  focusHotspotId: string | null;
  hintLevel: 0 | 1 | 2 | 3;
  drawer: 'none' | 'records' | 'help' | 'settings' | 'review';
  quality: Quality;
  reduceMotion: boolean;
  /** WebGL 不可用或用户选择时使用 HTML 实验模式 */
  htmlMode: boolean;
  webglIssue: string | null;
  autoWalk: boolean;
  introSeen: boolean;
  /** 场景内的情境提示，例如走近尚未开放的门 */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  setMode: (mode: WorldMode) => void;
  setNear: (id: string | null) => void;
  focus: (hotspotId: string) => void;
  release: () => void;
  setHint: (level: WorldStore['hintLevel']) => void;
  cycleHint: () => void;
  setDrawer: (drawer: WorldStore['drawer']) => void;
  setQuality: (quality: Quality) => void;
  setReduceMotion: (value: boolean) => void;
  setHtmlMode: (value: boolean, issue?: string | null) => void;
  setAutoWalk: (value: boolean) => void;
  setIntroSeen: () => void;
}

const prefs = readPrefs();

export const useWorldStore = create<WorldStore>((set, get) => ({
  mode: 'attract',
  nearHotspotId: null,
  focusHotspotId: null,
  hintLevel: 0,
  drawer: 'none',
  quality: prefs.quality,
  reduceMotion: prefs.reduceMotion,
  htmlMode: false,
  webglIssue: null,
  autoWalk: false,
  introSeen: false,
  notice: null,

  setNotice: (notice) => {
    if (get().notice !== notice) set({ notice });
  },
  setMode: (mode) => set({ mode }),
  setNear: (id) => {
    if (get().nearHotspotId !== id) set({ nearHotspotId: id });
  },
  focus: (hotspotId) => set({ focusHotspotId: hotspotId, mode: 'focusing', autoWalk: false, hintLevel: 0 }),
  release: () => {
    if (get().focusHotspotId) set({ mode: 'returning', focusHotspotId: null });
  },
  setHint: (hintLevel) => set({ hintLevel }),
  cycleHint: () => set({ hintLevel: ((get().hintLevel + 1) % 4) as WorldStore['hintLevel'] }),
  setDrawer: (drawer) => set({ drawer }),
  setQuality: (quality) => {
    writePrefs({ quality, reduceMotion: get().reduceMotion });
    set({ quality });
  },
  setReduceMotion: (reduceMotion) => {
    writePrefs({ quality: get().quality, reduceMotion });
    set({ reduceMotion });
  },
  setHtmlMode: (htmlMode, issue = null) => set({ htmlMode, webglIssue: issue, focusHotspotId: null, mode: htmlMode ? get().mode : 'exploring' }),
  setAutoWalk: (autoWalk) => set({ autoWalk }),
  setIntroSeen: () => set({ introSeen: true })
}));

/** 检查点：只记录“已看过操作提示”和镜头角度，按用户与会话隔离；位置总以当前任务安全站位恢复 */
export function checkpointKey(userId: number, sessionId: number): string {
  return `zhian.world.${userId}.${sessionId}`;
}

export function readCheckpoint(userId: number, sessionId: number): { introSeen: boolean; yaw: number } | null {
  try {
    const raw = localStorage.getItem(checkpointKey(userId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { introSeen?: unknown; yaw?: unknown };
    return {
      introSeen: parsed.introSeen === true,
      yaw: typeof parsed.yaw === 'number' && Number.isFinite(parsed.yaw) ? parsed.yaw : camera.yaw
    };
  } catch {
    return null;
  }
}

export function writeCheckpoint(userId: number, sessionId: number, data: { introSeen: boolean; yaw: number }): void {
  try {
    localStorage.setItem(checkpointKey(userId, sessionId), JSON.stringify(data));
  } catch {
    // 忽略
  }
}

export function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// 仅开发环境：暴露只读调试句柄，便于浏览器中核对人物位置与帧时间
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __zhian: unknown }).__zhian = { player, camera, perf, world: useWorldStore };
}
