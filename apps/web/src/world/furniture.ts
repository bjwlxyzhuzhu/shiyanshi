import { HOTSPOTS, type Vec2 } from './layout';

/**
 * 场景陈设与设备的占位清单。渲染与碰撞读取同一份数据，避免“看得见的机柜能穿过去”。
 * 约定：模型正面（屏幕/面板）在 rot=0 时朝 +Z。
 */
export type PropKind =
  | 'rack'
  | 'powerCabinet'
  | 'ups'
  | 'airHandler'
  | 'extinguisher'
  | 'planter'
  | 'locker'
  | 'serverCabinet'
  | 'workDesk'
  | 'meetingTable'
  | 'shelf'
  | 'wallScreen'
  | 'noticeBoard'
  | 'beacon';

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** 宽（沿本地 X）× 深（沿本地 Z）× 高 */
  w: number;
  d: number;
  h: number;
  rot: 0 | 1 | 2 | 3;
  collide: boolean;
  id?: string;
  /** 挂墙物体离地高度 */
  y?: number;
}

const prop = (kind: PropKind, x: number, z: number, w: number, d: number, h: number, rot: Prop['rot'], collide = true, extra: Partial<Prop> = {}): Prop => ({ kind, x, z, w, d, h, rot, collide, ...extra });

export const RACK_COUNT = 10;
export const RACK_X0 = 4.7;
export const RACK_PITCH = 0.82;
export const RACK_Z = 1.25;

export const PROPS: Prop[] = [
  // GPU 机房：一排 GPU 机柜、配电柜、UPS、精密空调与灭火器
  ...Array.from({ length: RACK_COUNT }, (_, index) =>
    prop('rack', RACK_X0 + index * RACK_PITCH, RACK_Z, 0.8, 1.0, 2.2, 0, true, { id: `GPU-${String(index + 1).padStart(2, '0')}` })),
  prop('powerCabinet', 1.2, 0.55, 0.85, 0.5, 1.9, 0, true, { id: 'PDU-01' }),
  prop('ups', 2.35, 0.65, 0.65, 0.75, 1.0, 0, true, { id: 'UPS-A' }),
  prop('ups', 3.15, 0.65, 0.65, 0.75, 1.0, 0, true, { id: 'UPS-B' }),
  prop('airHandler', 14.9, 0.7, 1.6, 0.8, 2.1, 0, true, { id: 'CRAC-01' }),
  prop('extinguisher', 0.35, 7.2, 0.3, 0.3, 0.7, 1, true),
  prop('extinguisher', 10.7, 9.55, 0.3, 0.3, 0.7, 2, true),
  prop('beacon', RACK_X0 + (RACK_COUNT - 1) * RACK_PITCH, 1.0, 0.2, 0.2, 0.3, 0, false, { y: 2.2 }),
  prop('shelf', 17.45, 6.5, 1.6, 0.5, 1.8, 3, true),

  // 审计与复盘室
  prop('wallScreen', 30, 0.12, 7.2, 0.1, 2.2, 0, false, { y: 1.1, id: 'stage-wall' }),
  prop('wallScreen', 22.5, 0.12, 3.4, 0.1, 1.5, 0, false, { y: 1.4, id: 'audit-wall' }),
  prop('meetingTable', 33.6, 7.6, 2.4, 1.2, 0.75, 0, true),
  prop('shelf', 18.55, 3.0, 1.8, 0.45, 1.9, 1, true),
  prop('planter', 35.4, 9.4, 0.7, 0.7, 0.6, 0, true),

  // 准入与简报区
  prop('locker', 0.4, 18.5, 3.6, 0.5, 1.9, 1, true),
  prop('noticeBoard', 7, 23.88, 4.2, 0.08, 1.4, 2, false, { y: 1.2, id: 'notice' }),
  prop('planter', 11.3, 23.3, 0.7, 0.7, 0.6, 0, true),

  // 数据实验室
  prop('serverCabinet', 13.0, 23.35, 0.7, 0.9, 2.0, 2, true),
  prop('serverCabinet', 13.75, 23.35, 0.7, 0.9, 2.0, 2, true),
  prop('workDesk', 17, 22.9, 2.6, 0.75, 0.75, 2, true),
  prop('workDesk', 21, 22.9, 2.6, 0.75, 0.75, 2, true),
  prop('wallScreen', 19, 23.88, 4.6, 0.1, 1.5, 2, false, { y: 1.55, id: 'data-wall' }),
  prop('planter', 23.3, 15.0, 0.7, 0.7, 0.6, 0, true),

  // 模型与智能体区
  prop('wallScreen', 30, 23.88, 5.6, 0.1, 1.6, 2, false, { y: 1.5, id: 'ai-wall' }),
  prop('serverCabinet', 35.3, 22.6, 0.7, 0.9, 2.0, 3, true),
  prop('serverCabinet', 35.3, 21.8, 0.7, 0.9, 2.0, 3, true),
  prop('workDesk', 25.6, 22.9, 2.0, 0.75, 0.75, 2, true),

  // 中央走廊：混凝土花坛避开门洞与导引中线
  prop('planter', 3.2, 10.5, 1.4, 0.6, 0.7, 0, true),
  prop('planter', 14.6, 10.5, 1.4, 0.6, 0.7, 0, true),
  prop('planter', 21.4, 10.5, 1.4, 0.6, 0.7, 0, true),
  prop('planter', 33.6, 10.5, 1.4, 0.6, 0.7, 0, true),
  prop('planter', 12, 13.5, 1.4, 0.6, 0.7, 0, true),
  prop('planter', 24, 13.5, 1.4, 0.6, 0.7, 0, true),
  prop('planter', 34.6, 13.5, 1.4, 0.6, 0.7, 0, true)
];

/** 世界坐标下的占地尺寸（考虑 90° 旋转） */
export function footprint(item: { w: number; d: number; rot: number }): Vec2 {
  return item.rot % 2 === 1 ? [item.d, item.w] : [item.w, item.d];
}

/** 热点设备的朝向：正面朝向站位 */
export function hotspotRot(position: Vec2, standPoint: Vec2): Prop['rot'] {
  return standPoint[1] < position[1] ? 2 : 0;
}

export const DEVICE_HEIGHT = 1.4;

export const HOTSPOT_PROPS = HOTSPOTS.map((hotspot) => ({
  hotspot,
  rot: hotspotRot(hotspot.position, hotspot.standPoint)
}));
