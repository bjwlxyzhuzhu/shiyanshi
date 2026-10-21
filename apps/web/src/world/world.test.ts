import { afterEach, describe, expect, it } from 'vitest';
import { STEPS } from '@zhian/shared';
import { BOXES, DOOR_BOXES, cameraClearance, circleOverlaps, moveCircle } from './collision';
import { HOTSPOTS, PLAYER, SPAWN, STEP_HOTSPOT, ZONE_BY_ID, hotspotForStep, zoneAt, type Vec2 } from './layout';
import { pathTo } from './nav';

function setDoors(open: boolean) {
  for (const box of Object.values(DOOR_BOXES)) box.enabled = !open;
}

/** 用真实碰撞代码沿导引路径行走，返回终点与耗时 */
function walk(from: Vec2, zone: Parameters<typeof pathTo>[1], target: Vec2): { end: Vec2; seconds: number } {
  let x = from[0];
  let z = from[1];
  const dt = 1 / 60;
  let t = 0;
  while (t < 60) {
    const path = pathTo([x, z], zone, target);
    const next = path.find((point, index) => index > 0 && Math.hypot(point[0] - x, point[1] - z) > 0.3);
    if (!next) break;
    const length = Math.hypot(next[0] - x, next[1] - z);
    [x, z] = moveCircle(x, z, ((next[0] - x) / length) * PLAYER.speed * dt, ((next[1] - z) / length) * PLAYER.speed * dt);
    t += dt;
  }
  return { end: [x, z], seconds: t };
}

afterEach(() => setDoors(false));

describe('世界布局与 24 步映射', () => {
  it('每一步都映射到存在的热点，且热点在所属区域内', () => {
    expect(STEPS).toHaveLength(24);
    for (const step of STEPS) {
      const hotspot = hotspotForStep(step.id);
      expect(hotspot, step.id).toBeDefined();
      const zone = ZONE_BY_ID.get(hotspot!.zone)!;
      for (const [x, z] of [hotspot!.position, hotspot!.standPoint]) {
        expect(x).toBeGreaterThan(zone.x[0]);
        expect(x).toBeLessThan(zone.x[1]);
        expect(z).toBeGreaterThan(zone.z[0]);
        expect(z).toBeLessThan(zone.z[1]);
      }
    }
    expect(new Set(Object.values(STEP_HOTSPOT)).size).toBe(HOTSPOTS.length);
  });

  it('所有安全站位都不与碰撞体重叠', () => {
    for (const hotspot of HOTSPOTS) {
      const [x, z] = hotspot.standPoint;
      const hit = BOXES.filter((box) => box.enabled && box.minY < 1.6 && !box.doorId).find((box) => circleOverlaps(box, x, z));
      expect(hit, hotspot.id).toBeUndefined();
    }
  });
});

describe('导引路径经门洞可达，不穿墙', () => {
  it('从出生点能走到第一个任务（S01）', () => {
    setDoors(true);
    const hotspot = hotspotForStep('S01')!;
    const { end } = walk(SPAWN, hotspot.zone, hotspot.standPoint);
    expect(Math.hypot(end[0] - hotspot.standPoint[0], end[1] - hotspot.standPoint[1])).toBeLessThan(0.4);
  });

  it('按实际任务顺序逐步行走，每一步都能到达站位', () => {
    setDoors(true);
    let position: Vec2 = SPAWN;
    for (const step of STEPS) {
      const hotspot = hotspotForStep(step.id)!;
      const { end, seconds } = walk(position, hotspot.zone, hotspot.standPoint);
      expect(Math.hypot(end[0] - hotspot.standPoint[0], end[1] - hotspot.standPoint[1]), `${step.id} 用时 ${seconds.toFixed(1)}s`).toBeLessThan(0.4);
      position = hotspot.standPoint;
    }
  });

  it('任意两台设备之间都能互相到达（含回访路线）', () => {
    setDoors(true);
    for (const from of HOTSPOTS) {
      for (const to of HOTSPOTS) {
        if (from === to) continue;
        const { end } = walk(from.standPoint, to.zone, to.standPoint);
        expect(Math.hypot(end[0] - to.standPoint[0], end[1] - to.standPoint[1]), `${from.id} → ${to.id}`).toBeLessThan(0.4);
      }
    }
  });
});

describe('人物碰撞', () => {
  it('一次很大的位移（切回标签页）也不会穿墙', () => {
    const [x] = moveCircle(16, 5, 10, 0);
    expect(x).toBeLessThan(18 - 0.09 - PLAYER.radius + 0.001);
    const [, z] = moveCircle(3, 12, 0, -8);
    expect(zoneAt(3, z)).toBe('corridor');
  });

  it('关闭的门会挡住人物，打开后可以通过', () => {
    setDoors(false);
    const [, closedZ] = moveCircle(6, 12.6, 0, 3);
    expect(closedZ).toBeLessThan(14);
    setDoors(true);
    const [, openZ] = moveCircle(6, 12.6, 0, 3);
    expect(openZ).toBeGreaterThan(15);
  });

  it('斜向移动不会比单方向更快（移动意图已归一化，碰撞不额外加速）', () => {
    const [x, z] = moveCircle(20, 12, 0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2);
    expect(Math.hypot(x - 20, z - 12)).toBeCloseTo(0.5, 3);
  });
});

describe('相机防穿墙', () => {
  it('相机射线穿过外墙时被拉近', () => {
    expect(cameraClearance(1.5, 1.35, 12, -3, 2.1, 12)).toBeLessThan(0.5);
  });

  it('走廊内无遮挡时保持完整距离', () => {
    expect(cameraClearance(20, 1.35, 12, 24.4, 2.1, 12)).toBe(1);
  });
});
