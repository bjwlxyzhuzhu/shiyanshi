/**
 * 基地空间布局（单位 m，+Y 向上，俯视图 +X 向右、+Z 向下）。
 * 数值来自 claude-webgl-design-kit/spec/world-layout.json 与 step-world-map.json，
 * 是设计起点而非实测；碰撞、导引与渲染都只读这里，保证三者一致。
 */

export type ZoneId = 'gpu' | 'review' | 'admission' | 'data' | 'ai';
export type Vec2 = [number, number];

export const WORLD = { width: 36, depth: 24, ceiling: 3.8, wall: 0.18 };
export const CORRIDOR = { z0: 10, z1: 14 };
/** 出生点：设计稿为 [3,12]，右移 2.5m 让跟随相机不贴西墙 */
export const SPAWN: Vec2 = [5.5, 12];
export const PLAYER = { height: 1.76, radius: 0.28, speed: 2.6, maxDelta: 0.05 };
export const DOOR = { width: 2.4, height: 2.7, leaf: 1.1, seconds: 0.55 };

export interface Zone {
  id: ZoneId;
  name: string;
  english: string;
  short: string;
  x: Vec2;
  z: Vec2;
  doorId: string;
}

export const ZONES: Zone[] = [
  { id: 'gpu', name: 'GPU 机房', english: 'GPU SERVER ROOM', short: '运维', x: [0, 18], z: [0, 10], doorId: 'door-gpu' },
  { id: 'review', name: '审计与复盘室', english: 'AUDIT & REVIEW', short: '复盘', x: [18, 36], z: [0, 10], doorId: 'door-review' },
  { id: 'admission', name: '准入与简报区', english: 'ADMISSION & BRIEFING', short: '准入', x: [0, 12], z: [14, 24], doorId: 'door-admission' },
  { id: 'data', name: '数据实验室', english: 'DATA PROCESSING LAB', short: '数据', x: [12, 24], z: [14, 24], doorId: 'door-data' },
  { id: 'ai', name: '模型与智能体区', english: 'MODEL & AGENT LAB', short: '模型', x: [24, 36], z: [14, 24], doorId: 'door-ai' }
];

export interface Door {
  id: string;
  zone: ZoneId;
  x: number;
  z: number;
  /** 门洞所在墙：北排房间门在 z=10（房间在 -Z 侧），南排在 z=14（房间在 +Z 侧） */
  side: 'north' | 'south';
}

export const DOORS: Door[] = [
  { id: 'door-gpu', zone: 'gpu', x: 9, z: 10, side: 'north' },
  { id: 'door-review', zone: 'review', x: 27, z: 10, side: 'north' },
  { id: 'door-admission', zone: 'admission', x: 6, z: 14, side: 'south' },
  { id: 'door-data', zone: 'data', x: 18, z: 14, side: 'south' },
  { id: 'door-ai', zone: 'ai', x: 30, z: 14, side: 'south' }
];

export type DeviceKind =
  | 'kiosk'
  | 'briefing'
  | 'dataDesk'
  | 'incident'
  | 'modelDesk'
  | 'sandbox'
  | 'agentConsole'
  | 'inspection'
  | 'powerDesk'
  | 'coolingDesk'
  | 'auditDesk'
  | 'reviewDesk';

export interface Hotspot {
  id: string;
  zone: ZoneId;
  name: string;
  code: string;
  kind: DeviceKind;
  position: Vec2;
  standPoint: Vec2;
  /** 设备占地（宽 × 深），用于碰撞 */
  size: Vec2;
}

export const INTERACT_RADIUS = 2.1;
export const EXIT_RADIUS = 2.5;

export const HOTSPOTS: Hotspot[] = [
  { id: 'admission-terminal', zone: 'admission', name: '身份核验终端', code: 'A1', kind: 'kiosk', position: [5, 20], standPoint: [5, 18.3], size: [1.1, 0.7] },
  { id: 'briefing-terminal', zone: 'admission', name: '任务简报台', code: 'A2', kind: 'briefing', position: [9, 20], standPoint: [9, 18.3], size: [1.6, 0.8] },
  { id: 'data-terminal', zone: 'data', name: '数据处理终端', code: 'D1', kind: 'dataDesk', position: [17, 20], standPoint: [17, 18.3], size: [1.5, 0.65] },
  { id: 'incident-terminal', zone: 'data', name: '泄露应急终端', code: 'D2', kind: 'incident', position: [21, 20], standPoint: [21, 18.3], size: [1.3, 0.65] },
  { id: 'model-terminal', zone: 'ai', name: '模型合规终端', code: 'M1', kind: 'modelDesk', position: [27, 20], standPoint: [27, 18.3], size: [1.5, 0.65] },
  { id: 'sandbox-terminal', zone: 'ai', name: '提示注入隔离沙箱', code: 'M2', kind: 'sandbox', position: [30, 20], standPoint: [30, 18.3], size: [1.6, 0.8] },
  { id: 'agent-terminal', zone: 'ai', name: '智能体权限控制台', code: 'M3', kind: 'agentConsole', position: [33.5, 20], standPoint: [33.5, 18.3], size: [1.8, 0.8] },
  { id: 'gpu-inspection', zone: 'gpu', name: '机房巡检台', code: 'G1', kind: 'inspection', position: [8, 4], standPoint: [8, 5.7], size: [1.5, 0.65] },
  { id: 'power-terminal', zone: 'gpu', name: '配电与上电控制台', code: 'G2', kind: 'powerDesk', position: [3, 4], standPoint: [3, 5.7], size: [1.4, 0.65] },
  { id: 'cooling-terminal', zone: 'gpu', name: '散热监控台', code: 'G3', kind: 'coolingDesk', position: [14, 4], standPoint: [14, 5.7], size: [1.5, 0.65] },
  { id: 'audit-terminal', zone: 'review', name: '日志审计终端', code: 'R1', kind: 'auditDesk', position: [23, 4], standPoint: [23, 5.7], size: [1.5, 0.65] },
  { id: 'review-terminal', zone: 'review', name: '复盘与报告终端', code: 'R2', kind: 'reviewDesk', position: [30, 4], standPoint: [30, 5.7], size: [1.6, 0.7] }
];

/** 步骤 → 热点，来自 step-world-map.json；只决定在哪台设备操作，不改题库与评分。 */
export const STEP_HOTSPOT: Record<string, string> = {
  S01: 'admission-terminal', S02: 'briefing-terminal', S03: 'briefing-terminal',
  S04: 'gpu-inspection',
  S05: 'data-terminal', S06: 'data-terminal', S07: 'data-terminal', S08: 'data-terminal', S09: 'data-terminal',
  S10: 'incident-terminal',
  S11: 'model-terminal', S12: 'model-terminal', S13: 'model-terminal',
  S14: 'sandbox-terminal', S15: 'sandbox-terminal', S16: 'agent-terminal', S17: 'model-terminal',
  S18: 'power-terminal', S19: 'cooling-terminal', S20: 'power-terminal',
  S21: 'audit-terminal', S22: 'review-terminal', S23: 'review-terminal', S24: 'review-terminal'
};

/** 当前任务简短目标（step-world-map.json objective），题干仍以 steps.ts 为准 */
export const STEP_OBJECTIVE: Record<string, string> = {
  S01: '核验准入材料', S02: '判断实验风险', S03: '准备应急预案', S04: '巡检 GPU 机房',
  S05: '完成数据分级', S06: '配置个人信息脱敏', S07: '核查数据授权', S08: '检测训练数据投毒',
  S09: '演练实验结束后的残留清理', S10: '演练数据泄露应急', S11: '核查模型许可', S12: '配置密钥最小权限',
  S13: '检测密钥泄露', S14: '识别提示注入', S15: '处置越狱与有害请求', S16: '配置智能体工具授权',
  S17: '评估模型公平性', S18: '执行 GPU 上电流程', S19: '控制散热与过温', S20: '演练过温断电应急',
  S21: '追溯审计日志', S22: '撰写安全事件报告', S23: '选择整改措施', S24: '生成实验报告'
};

/** 第三层提示：解释控件与操作方法，不给出答案 */
export const STEP_OPERATION_HINT: Record<string, string> = {
  S01: '在终端中选择你的实验角色，并逐项勾选你认为准入必须提交的材料。',
  S02: '阅读任务简报，分别判断数据、模型、工具三个维度，再给出综合等级。',
  S03: '打开电子预案册，勾选本实验需要事先准备的预案；漏选与误选都会影响结果。',
  S04: '逐项勾选你判断为合格的巡检项，并录入你观察到的机房环境温度。',
  S05: '为七个数据字段分别选择分类分级。',
  S06: '为四类个人信息选择处理策略；右侧预览来自后端，可边调边看。',
  S07: '对照授权材料，勾选缺失的要件，再给出能否使用的结论。',
  S08: '选择检测方法并调节阈值，观察后端返回的检测曲线后再提交。',
  S09: '本步是实验结束后的清理预演，不会删除任何真实文件；选择要清理的位置与方式。',
  S10: '用上下按钮调整六项处置的先后顺序；可另请安全助手评审，评审不计分。',
  S11: '核对许可证与使用范围，选择对应条件和结论。',
  S12: '配置密钥的权限范围、有效期与每日额度，均为课程仿真字段。',
  S13: '调节调用量告警阈值，结合后端调用曲线选择处置方式。',
  S14: '逐条阅读八条输入，勾选你判断为提示注入的条目。',
  S15: '为四条请求分别选择处置策略。',
  S16: '为五项工具分别设置权限，提交后系统按你的配置模拟一次诱导外发攻击。',
  S17: '选择公平性指标与阈值，观察后端分组图表后给出结论。',
  S18: '用上下按钮排列六项上电操作的顺序。',
  S19: '调节负载、风扇转速与进风温度，温度曲线由后端教学热路模型计算。',
  S20: '阅读过温演练情景，用上下按钮排列六项处置顺序。',
  S21: '选择要检索的时间窗与账号，观察后端审计图表。',
  S22: '选择事件等级，并勾选报告应包含的要素。',
  S23: '勾选整改措施；可另请安全助手评审，评审不计分。',
  S24: '先提交本步记录得分，再单独生成实验报告与能力画像。'
};

export const HOTSPOT_BY_ID = new Map(HOTSPOTS.map((hotspot) => [hotspot.id, hotspot]));
export const ZONE_BY_ID = new Map(ZONES.map((zone) => [zone.id, zone]));
export const DOOR_BY_ZONE = new Map(DOORS.map((door) => [door.zone, door]));

export function zoneAt(x: number, z: number): ZoneId | 'corridor' {
  if (z > CORRIDOR.z0 && z < CORRIDOR.z1) return 'corridor';
  for (const zone of ZONES) {
    if (x >= zone.x[0] && x <= zone.x[1] && z >= zone.z[0] && z <= zone.z[1]) return zone.id;
  }
  return 'corridor';
}

export function hotspotForStep(stepId: string): Hotspot | undefined {
  const id = STEP_HOTSPOT[stepId];
  return id ? HOTSPOT_BY_ID.get(id) : undefined;
}

/** 设备朝向：从站位指向设备中心的偏航角（人物静止朝向 -Z） */
export function yawToward(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));
}

export interface WallSegment {
  /** 沿 X（a=x0..x1, at=z）或沿 Z（a=z0..z1, at=x） */
  axis: 'x' | 'z';
  from: number;
  to: number;
  at: number;
  /** 走廊立面使用玻璃幕墙 */
  facade?: boolean;
}

function withGaps(axis: 'x' | 'z', at: number, from: number, to: number, gaps: number[], facade = false): WallSegment[] {
  const segments: WallSegment[] = [];
  let cursor = from;
  for (const center of [...gaps].sort((a, b) => a - b)) {
    segments.push({ axis, at, from: cursor, to: center - DOOR.width / 2, facade });
    cursor = center + DOOR.width / 2;
  }
  segments.push({ axis, at, from: cursor, to, facade });
  return segments;
}

export const WALLS: WallSegment[] = [
  { axis: 'x', at: 0, from: 0, to: 36 },
  { axis: 'x', at: 24, from: 0, to: 36 },
  { axis: 'z', at: 0, from: 0, to: 24 },
  { axis: 'z', at: 36, from: 0, to: 24 },
  ...withGaps('x', 10, 0, 36, [9, 27], true),
  ...withGaps('x', 14, 0, 36, [6, 18, 30], true),
  { axis: 'z', at: 18, from: 0, to: 10 },
  { axis: 'z', at: 12, from: 14, to: 24 },
  { axis: 'z', at: 24, from: 14, to: 24 }
];

export const STAGE_SHORT: Record<string, string> = {
  准入: '准入',
  数据安全: '数据',
  模型与智能体: '模型',
  设施与运维: '运维',
  复盘: '复盘'
};
