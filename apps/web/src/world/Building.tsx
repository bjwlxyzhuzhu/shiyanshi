import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { DOOR_BOXES, circleOverlaps } from './collision';
import { CORRIDOR, DOOR, DOORS, WALLS, WORLD, ZONE_BY_ID, type Door, type ZoneId } from './layout';
import { PROPS } from './furniture';
import { materials } from './materials';
import { signTexture } from './textures';
import { player, useWorldStore, type Quality } from './worldStore';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
const dummy = new THREE.Object3D();

/** 同一几何体与材质的批量实例；矩阵只在挂载时写入 */
function Instances({ items, material, castShadow = false, receiveShadow = false, colors }: {
  items: Array<{ p: [number, number, number]; s: [number, number, number]; r?: number }>;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  colors?: string[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, index) => {
      dummy.position.set(...item.p);
      dummy.scale.set(...item.s);
      dummy.rotation.set(0, item.r ?? 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (colors) mesh.setColorAt(index, new THREE.Color(colors[index % colors.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, colors]);
  return <instancedMesh ref={ref} args={[BOX, material, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} />;
}

function Floor() {
  const m = materials();
  const tiles = useMemo(() => {
    const list: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const colors: string[] = [];
    const size = 3;
    for (let x = 0; x < WORLD.width; x += size) {
      for (let z = 0; z < WORLD.depth; z += size) {
        list.push({ p: [x + size / 2, -0.01, z + size / 2], s: [size - 0.03, 0.02, size - 0.03] });
        const corridor = z + size / 2 > CORRIDOR.z0 && z + size / 2 < CORRIDOR.z1;
        const jitter = ((x * 7 + z * 13) % 5) / 100;
        colors.push(new THREE.Color(corridor ? '#c9d1d6' : '#b3bdc4').offsetHSL(0, 0, jitter - 0.02).getStyle());
      }
    }
    return { list, colors };
  }, []);
  return (
    <group>
      <mesh position={[WORLD.width / 2, -0.016, WORLD.depth / 2]} rotation={[-Math.PI / 2, 0, 0]} scale={[WORLD.width, WORLD.depth, 1]} geometry={PLANE} material={m.floorSeam} />
      <Instances items={tiles.list} colors={tiles.colors} material={m.floor} receiveShadow />
    </group>
  );
}

/** 走廊两侧地面琥珀灯带，门洞处断开 */
function CorridorStrips() {
  const m = materials();
  const items = useMemo(() => {
    const list: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const rows: Array<{ z: number; gaps: number[] }> = [
      { z: CORRIDOR.z0 + 0.32, gaps: [9, 27] },
      { z: CORRIDOR.z1 - 0.32, gaps: [6, 18, 30] }
    ];
    for (const row of rows) {
      let cursor = 0.4;
      for (const gap of [...row.gaps, 35.6 + DOOR.width]) {
        const end = Math.min(35.6, gap - DOOR.width / 2 - 0.3);
        if (end > cursor) list.push({ p: [(cursor + end) / 2, 0.006, row.z], s: [end - cursor, 0.012, 0.05] });
        cursor = gap + DOOR.width / 2 + 0.3;
      }
    }
    return list;
  }, []);
  return <Instances items={items} material={m.amberSoft} />;
}

function Walls({ quality }: { quality: Quality }) {
  const m = materials();
  const parts = useMemo(() => {
    const solid: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const base: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const glass: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const mullion: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const pillars: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const t = WORLD.wall;
    for (const wall of WALLS) {
      const length = wall.to - wall.from;
      const mid = (wall.from + wall.to) / 2;
      const along = (a: number, y: number, z0: number, sx: number, sy: number, sz: number): { p: [number, number, number]; s: [number, number, number] } =>
        wall.axis === 'x' ? { p: [a, y, wall.at + z0], s: [sx, sy, sz] } : { p: [wall.at + z0, y, a], s: [sz, sy, sx] };
      if (!wall.facade) {
        solid.push(along(mid, WORLD.ceiling / 2, 0, length + t, WORLD.ceiling, t));
        base.push(along(mid, 0.06, 0, length + t, 0.12, t + 0.03));
        continue;
      }
      // 走廊立面：石墨踢脚 + 玻璃 + 混凝土过梁 + 竖梃
      base.push(along(mid, 0.14, 0, length, 0.28, t + 0.04));
      glass.push(along(mid, 0.28 + (DOOR.height - 0.28) / 2, 0, length, DOOR.height - 0.28, 0.03));
      solid.push(along(mid, DOOR.height + (WORLD.ceiling - DOOR.height) / 2, 0, length, WORLD.ceiling - DOOR.height, t));
      const count = Math.max(1, Math.round(length / 1.6));
      for (let index = 0; index <= count; index++) {
        const a = wall.from + (length * index) / count;
        mullion.push(along(a, DOOR.height / 2, 0, 0.05, DOOR.height, 0.08));
      }
    }
    // 走廊结构柱：每 6m 一根，深色立柱形成节奏
    for (let x = 0; x <= 36; x += 6) {
      for (const z of [CORRIDOR.z0, CORRIDOR.z1]) {
        const doorClash = DOORS.some((door) => door.z === z && Math.abs(door.x - x) < DOOR.width / 2 + 0.3);
        if (doorClash) continue;
        const dz = z === CORRIDOR.z0 ? 0.16 : -0.16;
        pillars.push({ p: [Math.min(35.8, Math.max(0.2, x)), WORLD.ceiling / 2, z + dz], s: [0.42, WORLD.ceiling, 0.34] });
      }
    }
    // 房间内墙壁柱：深色竖向结构与细灯条，形成纵深节奏
    const pilasters: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const strips: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    for (const zone of ['gpu', 'review', 'admission', 'data', 'ai'] as ZoneId[]) {
      const area = ZONE_BY_ID.get(zone)!;
      const backZ = area.z[0] === 0 ? 0.2 : 23.8;
      for (let x = area.x[0] + 3; x < area.x[1] - 1; x += 4.5) {
        const covered = PROPS.some((item) => (item.kind === 'wallScreen' || item.kind === 'noticeBoard') && Math.abs(item.z - backZ) < 0.5 && Math.abs(item.x - x) < item.w / 2 + 0.4);
        if (covered) continue;
        pilasters.push({ p: [x, WORLD.ceiling / 2, backZ], s: [0.36, WORLD.ceiling, 0.22] });
        strips.push({ p: [x, 1.9, backZ + (backZ < 1 ? 0.115 : -0.115)], s: [0.04, 2.6, 0.01] });
      }
    }
    for (const pillar of pillars) {
      const face = pillar.p[2] < 12 ? 0.175 : -0.175;
      strips.push({ p: [pillar.p[0], 1.6, pillar.p[2] + face], s: [0.04, 2.4, 0.01] });
    }
    return { solid, base, glass, mullion, pillars, pilasters, strips };
  }, []);

  return (
    <group>
      <Instances items={parts.solid} material={m.concrete} receiveShadow />
      <Instances items={parts.base} material={m.graphite} />
      <Instances items={parts.glass} material={quality === 'low' ? m.glassOpaque : m.glass} />
      <Instances items={parts.mullion} material={m.pillar} />
      <Instances items={parts.pillars} material={m.pillar} />
      <Instances items={parts.pilasters} material={m.pillar} />
      <Instances items={parts.strips} material={m.amberSoft} />
    </group>
  );
}

function Ceiling() {
  const m = materials();
  const strips = useMemo(() => {
    const list: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    const y = WORLD.ceiling - 0.03;
    // 走廊横向短灯带
    for (let x = 1.5; x < 36; x += 3) list.push({ p: [x, y - 0.05, 12], s: [0.14, 0.04, 2.2] });
    // 房间纵向长灯带
    for (const zone of ['gpu', 'review', 'admission', 'data', 'ai'] as ZoneId[]) {
      const area = ZONE_BY_ID.get(zone)!;
      for (let x = area.x[0] + 2; x < area.x[1] - 1; x += 3) {
        list.push({ p: [x, y, (area.z[0] + area.z[1]) / 2], s: [0.12, 0.04, area.z[1] - area.z[0] - 2.4] });
      }
    }
    return list;
  }, []);
  const beams = useMemo(() => {
    const list: Array<{ p: [number, number, number]; s: [number, number, number] }> = [];
    for (let x = 0; x <= 36; x += 3) list.push({ p: [x, WORLD.ceiling - 0.14, 12], s: [0.22, 0.28, 4] });
    list.push({ p: [18, WORLD.ceiling - 0.1, CORRIDOR.z0 + 0.25], s: [36, 0.2, 0.3] });
    list.push({ p: [18, WORLD.ceiling - 0.1, CORRIDOR.z1 - 0.25], s: [36, 0.2, 0.3] });
    return list;
  }, []);
  return (
    <group>
      <Instances items={beams} material={m.pillar} />
      <mesh position={[WORLD.width / 2, WORLD.ceiling, WORLD.depth / 2]} rotation={[Math.PI / 2, 0, 0]} scale={[WORLD.width, WORLD.depth, 1]} geometry={PLANE} material={m.ceiling} />
      <Instances items={strips} material={m.lightPanel} />
    </group>
  );
}

function RoomSign({ door }: { door: Door }) {
  const zone = ZONE_BY_ID.get(door.zone)!;
  const texture = useMemo(() => signTexture(zone.name, zone.english, '#67D2E3'), [zone]);
  const facing = door.side === 'north' ? 0 : Math.PI;
  const dz = door.side === 'north' ? WORLD.wall / 2 + 0.02 : -(WORLD.wall / 2 + 0.02);
  return (
    <mesh position={[door.x, 3.22, door.z + dz]} rotation={[0, facing, 0]}>
      <planeGeometry args={[2.6, 0.65]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** 双扇滑门：门开到安全宽度才移除碰撞体；人物在门洞内时不关门 */
function SlidingDoor({ door, unlocked }: { door: Door; unlocked: boolean }) {
  const m = materials();
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const collider = DOOR_BOXES[door.id]!;
  const doorway = useMemo(() => ({ ...collider, minZ: collider.minZ - 0.5, maxZ: collider.maxZ + 0.5 }), [collider]);
  const leafW = DOOR.width / 2;
  const offset = door.side === 'north' ? 0.12 : -0.12;

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const near = Math.hypot(player.x - door.x, player.z - door.z) < 2.7;
    let target = unlocked && near ? 1 : 0;
    if (target === 0 && circleOverlaps(doorway, player.x, player.z)) target = 1;
    const step = delta / DOOR.seconds;
    open.current = target > open.current ? Math.min(1, open.current + step) : Math.max(0, open.current - step);
    const eased = open.current * open.current * (3 - 2 * open.current);
    collider.enabled = open.current < 0.85;
    if (left.current) left.current.position.x = -leafW / 2 - eased * DOOR.leaf;
    if (right.current) right.current.position.x = leafW / 2 + eased * DOOR.leaf;
    if (lamp.current) lamp.current.material = unlocked ? (open.current > 0.05 ? m.amber : m.cyan) : m.red;
  });

  const leaf = (
    <>
      <mesh material={m.glass} scale={[leafW - 0.06, DOOR.height - 0.08, 0.03]} geometry={BOX} position={[0, DOOR.height / 2, 0]} />
      <mesh material={m.pillar} scale={[0.05, DOOR.height, 0.06]} geometry={BOX} position={[-leafW / 2 + 0.025, DOOR.height / 2, 0]} />
      <mesh material={m.pillar} scale={[0.05, DOOR.height, 0.06]} geometry={BOX} position={[leafW / 2 - 0.025, DOOR.height / 2, 0]} />
      <mesh material={m.pillar} scale={[leafW, 0.06, 0.06]} geometry={BOX} position={[0, DOOR.height - 0.03, 0]} />
      <mesh material={m.pillar} scale={[leafW, 0.12, 0.06]} geometry={BOX} position={[0, 0.06, 0]} />
    </>
  );

  return (
    <group position={[door.x, 0, door.z]}>
      <group position={[0, 0, offset]}>
        <group ref={left}>{leaf}</group>
        <group ref={right}>{leaf}</group>
      </group>
      {/* 门框与琥珀竖向灯条 */}
      {[-1, 1].map((sign) => (
        <group key={sign} position={[sign * (DOOR.width / 2 + 0.11), 0, 0]}>
          <mesh material={m.pillar} geometry={BOX} scale={[0.22, DOOR.height + 0.1, 0.36]} position={[0, (DOOR.height + 0.1) / 2, 0]} castShadow />
          <mesh material={m.amberSoft} geometry={BOX} scale={[0.035, 2.1, 0.02]} position={[-sign * 0.09, 1.3, 0.185]} />
          <mesh material={m.amberSoft} geometry={BOX} scale={[0.035, 2.1, 0.02]} position={[-sign * 0.09, 1.3, -0.185]} />
        </group>
      ))}
      <mesh ref={lamp} geometry={BOX} material={m.cyan} scale={[0.5, 0.05, 0.4]} position={[0, DOOR.height + 0.06, 0]} />
    </group>
  );
}

export function Building({ quality, unlockedZones }: { quality: Quality; unlockedZones: Set<ZoneId> }) {
  return (
    <group>
      <Floor />
      <CorridorStrips />
      <Walls quality={quality} />
      <Ceiling />
      {DOORS.map((door) => (
        <group key={door.id}>
          <SlidingDoor door={door} unlocked={unlockedZones.has(door.zone)} />
          <RoomSign door={door} />
        </group>
      ))}
    </group>
  );
}

/** 读取低频 quality，供场景外层使用 */
export function useQuality(): Quality {
  return useWorldStore((state) => state.quality);
}
