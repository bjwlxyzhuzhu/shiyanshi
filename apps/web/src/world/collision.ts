import { DOORS, DOOR, HOTSPOTS, PLAYER, WALLS, WORLD } from './layout';
import { DEVICE_HEIGHT, PROPS, footprint } from './furniture';

/** 轴对齐包围盒；门的碰撞体可被开关 */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  enabled: boolean;
  doorId?: string;
}

const half = WORLD.wall / 2;

function boxFrom(x: number, z: number, sx: number, sz: number, minY: number, maxY: number): Box {
  return { minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, minY, maxY, enabled: true };
}

export const BOXES: Box[] = [];

for (const wall of WALLS) {
  if (wall.axis === 'x') {
    BOXES.push({ minX: wall.from - half, maxX: wall.to + half, minZ: wall.at - half, maxZ: wall.at + half, minY: 0, maxY: WORLD.ceiling, enabled: true });
  } else {
    BOXES.push({ minX: wall.at - half, maxX: wall.at + half, minZ: wall.from - half, maxZ: wall.to + half, minY: 0, maxY: WORLD.ceiling, enabled: true });
  }
}

// 门洞上方的过梁始终阻挡相机
export const DOOR_BOXES: Record<string, Box> = {};
for (const door of DOORS) {
  BOXES.push({ minX: door.x - DOOR.width / 2, maxX: door.x + DOOR.width / 2, minZ: door.z - half, maxZ: door.z + half, minY: DOOR.height, maxY: WORLD.ceiling, enabled: true });
  const leaf: Box = { minX: door.x - DOOR.width / 2, maxX: door.x + DOOR.width / 2, minZ: door.z - 0.06, maxZ: door.z + 0.06, minY: 0, maxY: DOOR.height, enabled: true, doorId: door.id };
  DOOR_BOXES[door.id] = leaf;
  BOXES.push(leaf);
}

for (const item of PROPS) {
  if (!item.collide) continue;
  const [sx, sz] = footprint(item);
  BOXES.push(boxFrom(item.x, item.z, sx, sz, item.y ?? 0, (item.y ?? 0) + item.h));
}

for (const hotspot of HOTSPOTS) {
  const tall = hotspot.kind === 'sandbox' || hotspot.kind === 'agentConsole' ? 1.9 : DEVICE_HEIGHT;
  BOXES.push(boxFrom(hotspot.position[0], hotspot.position[1], hotspot.size[0], hotspot.size[1], 0, tall));
}

/** 人物身体高度范围内的碰撞体（挂墙物体不挡人） */
function blocksBody(box: Box): boolean {
  return box.enabled && box.minY < 1.6 && box.maxY > 0.1;
}

/**
 * 圆形人物与包围盒的位移求解：按子步推进，每步把圆推出所有重叠盒子。
 * 子步长度不超过半径的一半，切回标签页后的大 delta 也不会穿墙。
 */
export function moveCircle(x: number, z: number, dx: number, dz: number, radius = PLAYER.radius): [number, number] {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / (radius * 0.5)));
  let px = x;
  let pz = z;
  for (let step = 0; step < steps; step++) {
    px += dx / steps;
    pz += dz / steps;
    for (let pass = 0; pass < 2; pass++) {
      for (const box of BOXES) {
        if (!blocksBody(box)) continue;
        const cx = Math.max(box.minX, Math.min(px, box.maxX));
        const cz = Math.max(box.minZ, Math.min(pz, box.maxZ));
        const ox = px - cx;
        const oz = pz - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          px = cx + (ox / d) * radius;
          pz = cz + (oz / d) * radius;
        } else {
          // 圆心已进入盒子：沿最近的面推出
          const left = px - box.minX;
          const right = box.maxX - px;
          const top = pz - box.minZ;
          const bottom = box.maxZ - pz;
          const min = Math.min(left, right, top, bottom);
          if (min === left) px = box.minX - radius;
          else if (min === right) px = box.maxX + radius;
          else if (min === top) pz = box.minZ - radius;
          else pz = box.maxZ + radius;
        }
      }
    }
  }
  return [px, pz];
}

/** 判断某点是否与人物圆重叠（门关闭前检查是否有人站在门洞内） */
export function circleOverlaps(box: Box, x: number, z: number, radius = PLAYER.radius): boolean {
  const cx = Math.max(box.minX, Math.min(x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
  return (x - cx) ** 2 + (z - cz) ** 2 < radius * radius;
}

/**
 * 相机防穿墙：从注视点到期望相机位置做射线 vs 膨胀包围盒（slab 法），
 * 返回可用的最大比例 t∈[0,1]。
 */
export function cameraClearance(
  ox: number, oy: number, oz: number,
  tx: number, ty: number, tz: number,
  pad = 0.18
): number {
  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  let best = 1;
  for (const box of BOXES) {
    if (!box.enabled) continue;
    let tmin = 0;
    let tmax = best;
    const axes: Array<[number, number, number, number]> = [
      [ox, dx, box.minX - pad, box.maxX + pad],
      [oy, dy, box.minY - pad, box.maxY + pad],
      [oz, dz, box.minZ - pad, box.maxZ + pad]
    ];
    let hit = true;
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { hit = false; break; }
        continue;
      }
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) { hit = false; break; }
    }
    // 起点已在盒内（tmin=0）时忽略，避免人物贴墙时相机抖到脸上
    if (hit && tmin > 0 && tmin < best) best = tmin;
  }
  return best;
}
