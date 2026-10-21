import { CORRIDOR, DOOR_BY_ZONE, zoneAt, type Vec2, type ZoneId } from './layout';

/**
 * 预定义导航节点：房间内站位 ↔ 门内点 ↔ 门外点 ↔ 走廊中线。
 * 房间内部的站位与门之间保持无遮挡直线（陈设布置时已避开），
 * 因此导引线只经过门洞与走廊，不会穿墙。
 */
const MID = (CORRIDOR.z0 + CORRIDOR.z1) / 2;

function doorNodes(zone: ZoneId): { inside: Vec2; outside: Vec2; lane: Vec2 } {
  const door = DOOR_BY_ZONE.get(zone)!;
  const sign = door.side === 'north' ? -1 : 1;
  return {
    inside: [door.x, door.z + sign * 1.2],
    outside: [door.x, door.z - sign * 1.0],
    lane: [door.x, MID]
  };
}

function corridorEntry(from: Vec2): Vec2 {
  return [from[0], Math.min(CORRIDOR.z1 - 1.2, Math.max(CORRIDOR.z0 + 1.2, from[1]))];
}

/** 从人物位置到目标站位的折线路径（首点为人物位置） */
export function pathTo(from: Vec2, targetZone: ZoneId, target: Vec2): Vec2[] {
  const here = zoneAt(from[0], from[1]);
  if (here === targetZone) return [from, target];

  const enter = doorNodes(targetZone);
  let path: Vec2[];
  if (here === 'corridor') {
    // 走廊内：先回到可通行的车道高度，再沿走廊平移到目标门口，不回头找中线
    const entry = corridorEntry(from);
    // 已在目标门口前方时直接进门，避免把身后的车道点当作下一个路点
    path = Math.abs(from[0] - enter.lane[0]) < 1
      ? [from, enter.outside, enter.inside, target]
      : [from, entry, [enter.lane[0], entry[1]], enter.outside, enter.inside, target];
  } else {
    const exit = doorNodes(here);
    path = [from, exit.inside, exit.outside, exit.lane, enter.lane, enter.outside, enter.inside, target];
  }
  return dropPassed(simplify(path));
}

/**
 * 去掉已经走过的路点：若人物到下下个点比下个点到下下个点更近，说明下个点已在身后。
 * 否则每帧重算路径时会被身后的路点拉回，原地来回抖动。
 */
function dropPassed(path: Vec2[]): Vec2[] {
  const out = [...path];
  while (out.length >= 3) {
    const [from, a, b] = out as [Vec2, Vec2, Vec2];
    if (Math.hypot(from[0] - b[0], from[1] - b[1]) <= Math.hypot(a[0] - b[0], a[1] - b[1])) out.splice(1, 1);
    else break;
  }
  return out;
}

function simplify(path: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const point of path) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev[0] - point[0], prev[1] - point[1]) < 0.15) continue;
    out.push(point);
  }
  return out;
}

export function pathLength(path: Vec2[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index++) {
    total += Math.hypot(path[index]![0] - path[index - 1]![0], path[index]![1] - path[index - 1]![1]);
  }
  return total;
}
