import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { AGENT_TOOLS } from '@zhian/shared';
import { HOTSPOT_PROPS, PROPS, RACK_COUNT, type Prop } from './furniture';
import type { Hotspot } from './layout';
import { materials } from './materials';
import type { HotspotStatus, SceneState, SlotState, TraceHop } from './sceneAdapter';
import { StaticMerge } from './StaticMerge';
import { labelTexture, nodeTexture, noticeTexture, screenTexture, stageWallTexture, type ScreenStyle } from './textures';
import { useWorldStore, type Quality } from './worldStore';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const CYL_LOW = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const LEAF = new THREE.IcosahedronGeometry(0.5, 0);
const dummy = new THREE.Object3D();
const ROT = (rot: number) => (rot * Math.PI) / 2;

type V3 = [number, number, number];

/** 盒子简写：位置/尺寸都是中心与全尺寸 */
function B({ p, s, m, r, cast = false }: { p: V3; s: V3; m: THREE.Material; r?: V3; cast?: boolean }) {
  return <mesh geometry={BOX} material={m} position={p} scale={s} rotation={r} castShadow={cast} receiveShadow={cast} />;
}

function Screen({ p, size, style, seed = 1, r }: { p: V3; size: [number, number]; style: ScreenStyle; seed?: number; r?: V3 }) {
  const texture = useMemo(() => screenTexture(style, seed), [style, seed]);
  return (
    <mesh position={p} rotation={r}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} toneMapped={false} color="#c9d6e0" />
    </mesh>
  );
}

function Label({ p, size, text, r, background, color }: { p: V3; size: [number, number]; text: string; r?: V3; background?: string; color?: string }) {
  const texture = useMemo(() => labelTexture(text, background, color), [text, background, color]);
  return (
    <mesh position={p} rotation={r}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function Monitor({ p, style, seed, width = 0.62, tilt = -0.12 }: { p: V3; style: ScreenStyle; seed?: number; width?: number; tilt?: number }) {
  const m = materials();
  const height = width * 0.62;
  return (
    <group position={p}>
      <B p={[0, 0.015, -0.02]} s={[0.22, 0.03, 0.16]} m={m.screenFrame} />
      <B p={[0, 0.16, -0.05]} s={[0.04, 0.28, 0.03]} m={m.screenFrame} />
      <group position={[0, 0.3 + height / 2, -0.03]} rotation={[tilt, 0, 0]}>
        <B p={[0, 0, 0]} s={[width + 0.04, height + 0.04, 0.035]} m={m.screenFrame} cast />
        <Screen p={[0, 0, 0.019]} size={[width, height]} style={style} seed={seed} />
      </group>
    </group>
  );
}

function statusMaterial(status: HotspotStatus) {
  const m = materials();
  return status === 'current' ? m.amber : status === 'history' ? m.cyanSoft : m.ledOff;
}

/** 通用工作台终端：台座、桌面、倾斜屏、键盘、读卡区；当前任务时前沿琥珀灯条亮起 */
function DeskTerminal({ w, d, status, screens, extras }: { w: number; d: number; status: HotspotStatus; screens: Array<{ style: ScreenStyle; x: number; seed?: number; width?: number }>; extras?: React.ReactNode }) {
  const m = materials();
  return (
    <group>
      <B p={[0, 0.44, 0]} s={[w - 0.16, 0.86, d - 0.12]} m={m.deskBody} cast />
      <B p={[0, 0.44, d / 2 - 0.055]} s={[w - 0.3, 0.7, 0.012]} m={m.graphite} />
      <B p={[0, 0.03, 0]} s={[w - 0.1, 0.06, d - 0.06]} m={m.black} />
      <B p={[0, 0.9, 0]} s={[w, 0.045, d]} m={m.desktop} cast />
      <B p={[0, 0.885, d / 2 + 0.004]} s={[w - 0.02, 0.018, 0.012]} m={statusMaterial(status)} />
      {screens.map((screen, index) => (
        <Monitor key={index} p={[screen.x, 0.92, -d / 2 + 0.2]} style={screen.style} seed={screen.seed ?? index + 1} width={screen.width} />
      ))}
      <B p={[0, 0.935, d / 2 - 0.17]} s={[0.46, 0.022, 0.15]} m={m.black} />
      <B p={[0.36, 0.93, d / 2 - 0.16]} s={[0.07, 0.02, 0.1]} m={m.black} />
      <B p={[-w / 2 + 0.16, 0.94, d / 2 - 0.16]} s={[0.14, 0.035, 0.1]} m={m.graphiteLight} />
      <B p={[-w / 2 + 0.16, 0.96, d / 2 - 0.13]} s={[0.08, 0.004, 0.02]} m={status === 'locked' ? m.ledOff : m.cyan} />
      {extras}
    </group>
  );
}

function Kiosk({ status }: { status: HotspotStatus }) {
  const m = materials();
  return (
    <group>
      <B p={[0, 0.03, 0]} s={[0.7, 0.06, 0.55]} m={m.black} />
      <B p={[0, 0.55, -0.02]} s={[0.46, 1.0, 0.34]} m={m.graphite} cast />
      <B p={[0, 0.55, 0.152]} s={[0.05, 0.86, 0.01]} m={statusMaterial(status)} />
      <group position={[0, 1.18, 0.02]} rotation={[-0.45, 0, 0]}>
        <B p={[0, 0, 0]} s={[0.62, 0.44, 0.07]} m={m.screenFrame} cast />
        <Screen p={[0, 0, 0.037]} size={[0.56, 0.38]} style="kiosk" seed={3} />
      </group>
      <B p={[0.18, 0.95, 0.2]} s={[0.16, 0.05, 0.14]} m={m.graphiteLight} />
      <B p={[0.18, 0.976, 0.2]} s={[0.1, 0.004, 0.08]} m={status === 'locked' ? m.ledOff : m.cyanSoft} />
      <B p={[-0.18, 0.95, 0.2]} s={[0.12, 0.04, 0.12]} m={m.black} />
      {/* 侧面门禁立柱 */}
      <B p={[0.45, 0.5, 0]} s={[0.12, 1.0, 0.5]} m={m.steel} cast />
      <B p={[0.45, 0.82, 0.255]} s={[0.08, 0.2, 0.01]} m={m.cyan} />
    </group>
  );
}

function Binders({ p }: { p: V3 }) {
  const m = materials();
  const colors = ['#2f5d8a', '#b8862f', '#2f6f5e', '#6b4f8a'];
  const mats = useMemo(() => colors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 })), []);
  return (
    <group position={p}>
      {mats.map((mat, index) => (
        <mesh key={index} geometry={BOX} material={mat} position={[index * 0.065, 0.13, 0]} scale={[0.05, 0.26, 0.2]} castShadow />
      ))}
      <B p={[0.1, 0.005, 0]} s={[0.3, 0.01, 0.22]} m={m.black} />
    </group>
  );
}

const SLOT_MAT = (state: SlotState) => {
  const m = materials();
  return state === 'selected' ? m.amber : state === 'correct' ? m.green : state === 'wrong' ? m.red : m.graphiteLight;
};

/** 提示注入隔离沙箱：玻璃舱内的样本格只显示序号和选择/判定状态，长文字在 HTML 面板 */
function Sandbox({ status, slots, quality }: { status: HotspotStatus; slots: SlotState[]; quality: Quality }) {
  const m = materials();
  const columns = 4;
  return (
    <group>
      <B p={[0, 0.45, 0]} s={[1.5, 0.9, 0.74]} m={m.deskBody} cast />
      <B p={[0, 0.885, 0.375]} s={[1.48, 0.02, 0.012]} m={statusMaterial(status)} />
      <B p={[0, 0.92, 0]} s={[1.6, 0.05, 0.8]} m={m.graphite} cast />
      {/* 玻璃舱 */}
      <mesh geometry={BOX} material={quality === 'low' ? m.glassOpaque : m.glass} position={[0, 1.25, -0.05]} scale={[1.36, 0.6, 0.58]} />
      {[[-0.68, -0.34], [0.68, -0.34], [-0.68, 0.24], [0.68, 0.24]].map(([x, z], index) => (
        <B key={index} p={[x!, 1.25, z!]} s={[0.04, 0.62, 0.04]} m={m.pillar} />
      ))}
      <B p={[0, 1.56, -0.05]} s={[1.4, 0.04, 0.62]} m={m.pillar} />
      <B p={[0, 1.555, 0.27]} s={[1.3, 0.012, 0.012]} m={m.cyanSoft} />
      {slots.map((state, index) => {
        const x = ((index % columns) - (columns - 1) / 2) * 0.3;
        const z = Math.floor(index / columns) * 0.26 - 0.16;
        return (
          <group key={index} position={[x, 0.98, z]}>
            <B p={[0, 0.04, 0]} s={[0.22, 0.08, 0.18]} m={SLOT_MAT(state)} />
            <Label p={[0, 0.082, 0]} size={[0.14, 0.06]} r={[-Math.PI / 2, 0, 0]} text={String(index + 1)} />
          </group>
        );
      })}
      <Monitor p={[0.55, 0.945, 0.24]} style="sandbox" seed={5} width={0.34} tilt={-0.5} />
    </group>
  );
}

const LEVEL_MAT = (level: string) => {
  const m = materials();
  if (level === '禁止') return m.ledOff;
  if (level === '只读') return m.cyanSoft;
  if (level === '需人工确认') return m.amberSoft;
  return m.lightPanel;
};

const OUTCOME_COLOR: Record<string, string> = { 执行: '#F17872', 被拦截: '#69CC9E', 待人工确认: '#F4B740' };

function HoloNode({ p, title, status, color, scale = 1 }: { p: V3; title: string; status: string; color: string; scale?: number }) {
  const texture = useMemo(() => nodeTexture(title, status, color), [title, status, color]);
  return (
    <mesh position={p} scale={[scale, scale, 1]}>
      <planeGeometry args={[0.5, 0.22]} />
      <meshBasicMaterial map={texture} toneMapped={false} transparent opacity={0.94} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Link({ from, to, color }: { from: V3; to: V3; color: string }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.85 }), [color]);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  return (
    <mesh geometry={BOX} material={mat} position={[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, from[2]]} rotation={[0, 0, Math.atan2(dy, dx)]} scale={[length, 0.022, 0.022]} />
  );
}

/**
 * 智能体权限控制台：五个工具端口按配置显示；路径节点按实际 trace 生成——
 * 读取为根，邮件/检索/系统命令为读取执行后的分支，不固定串成三跳。
 */
function AgentConsole({ status, levels, trace, dirty, reduceMotion }: { status: HotspotStatus; levels: string[]; trace: TraceHop[] | null; dirty: boolean; reduceMotion: boolean }) {
  const m = materials();
  const grow = useRef<THREE.Group>(null);
  const born = useRef(0);
  const traceKey = trace ? JSON.stringify(trace) : 'none';
  useEffect(() => {
    born.current = performance.now();
  }, [traceKey]);
  useFrame(() => {
    if (!grow.current) return;
    const t = reduceMotion ? 1 : Math.min(1, (performance.now() - born.current) / 800);
    grow.current.scale.setScalar(0.6 + 0.4 * t);
  });

  const root: V3 = [-0.55, 1.95, 0];
  const branches = trace ? trace.slice(1) : null;
  const ghost = !trace;
  const rows = ghost ? ['发送邮件', '联网检索', '执行系统命令'] : (branches ?? []).map((hop) => hop.tool);
  const branchPos = (index: number, total: number): V3 => [0.45, 1.95 + (((total - 1) / 2) - index) * 0.32, 0];
  const rootHop = trace?.[0];

  return (
    <group>
      <B p={[0, 0.44, 0.05]} s={[1.7, 0.86, 0.66]} m={m.deskBody} cast />
      <B p={[0, 0.875, 0.38]} s={[1.68, 0.02, 0.012]} m={statusMaterial(status)} />
      <group position={[0, 0.95, 0.08]} rotation={[-0.22, 0, 0]}>
        <B p={[0, 0, 0]} s={[1.8, 0.08, 0.66]} m={m.graphite} cast />
        <Screen p={[0, 0.042, 0.02]} size={[1.1, 0.46]} r={[-Math.PI / 2, 0, 0]} style="agent" seed={7} />
      </group>
      {/* 六个工具端口（含设施控制：应为“禁止”） */}
      {AGENT_TOOLS.map((tool, index) => {
        const x = (index - (AGENT_TOOLS.length - 1) / 2) * 0.28;
        return (
          <group key={tool} position={[x, 1.08, -0.3]}>
            <B p={[0, 0.1, 0]} s={[0.24, 0.24, 0.14]} m={m.screenFrame} cast />
            <B p={[0, 0.14, 0.072]} s={[0.17, 0.08, 0.01]} m={LEVEL_MAT(levels[index] ?? '自动允许')} />
            <Label p={[0, 0.04, 0.072]} size={[0.21, 0.06]} text={tool.length > 6 ? '设施控制' : tool} />
          </group>
        );
      })}
      {/* 攻击路径全息层 */}
      <group ref={grow} position={[0, 0, -0.1]}>
        <HoloNode p={root} title="文件读取" status={rootHop ? rootHop.outcome : '待验证'} color={rootHop ? (rootHop.outcome === '执行' ? '#67D2E3' : OUTCOME_COLOR[rootHop.outcome]!) : '#7d8d99'} />
        {rows.map((tool, index) => {
          const hop = branches?.[index];
          const color = hop ? OUTCOME_COLOR[hop.outcome]! : '#5c6b76';
          const to = branchPos(index, rows.length);
          return (
            <group key={tool}>
              <Link from={[root[0] + 0.25, root[1], root[2]]} to={[to[0] - 0.25, to[1], to[2]]} color={color} />
              <HoloNode p={to} title={tool} status={hop ? hop.outcome : '待验证'} color={color} scale={0.92} />
            </group>
          );
        })}
        {dirty ? <HoloNode p={[0, 2.5, 0]} title="配置已修改" status="待重新提交" color="#A7BAC9" scale={0.8} /> : null}
      </group>
    </group>
  );
}

/** GPU 机柜整排：外壳、托盘、风扇、LED 全部实例化 */
function RackRow({ items, hot }: { items: Prop[]; hot: boolean }) {
  const m = materials();
  const shells = useRef<THREE.InstancedMesh>(null);
  const doors = useRef<THREE.InstancedMesh>(null);
  const trays = useRef<THREE.InstancedMesh>(null);
  const fans = useRef<THREE.InstancedMesh>(null);
  const leds = useRef<THREE.InstancedMesh>(null);
  const handles = useRef<THREE.InstancedMesh>(null);
  const ledMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const TRAYS = 6;

  useLayoutEffect(() => {
    const place = (mesh: THREE.InstancedMesh | null, index: number, p: V3, s: V3, rx = 0) => {
      if (!mesh) return;
      dummy.position.set(...p);
      dummy.scale.set(...s);
      dummy.rotation.set(rx, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    };
    items.forEach((rack, r) => {
      const front = rack.z + rack.d / 2;
      place(shells.current, r, [rack.x, 1.1, rack.z], [rack.w, 2.2, rack.d]);
      place(doors.current, r, [rack.x, 1.12, front + 0.006], [rack.w - 0.08, 1.98, 0.012]);
      place(handles.current, r, [rack.x + rack.w / 2 - 0.07, 1.15, front + 0.03], [0.025, 0.4, 0.03]);
      for (let t = 0; t < TRAYS; t++) {
        const y = 0.34 + t * 0.3;
        const index = r * TRAYS + t;
        place(trays.current, index, [rack.x, y, front + 0.016], [rack.w - 0.14, 0.2, 0.02]);
        for (let f = 0; f < 2; f++) {
          place(fans.current, index * 2 + f, [rack.x - 0.14 + f * 0.2, y, front + 0.028], [0.13, 0.012, 0.13], Math.PI / 2);
          place(leds.current, index * 2 + f, [rack.x + 0.27, y + 0.05 - f * 0.1, front + 0.03], [0.03, 0.018, 0.012]);
        }
      }
    });
    for (const mesh of [shells.current, doors.current, trays.current, fans.current, leds.current, handles.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [items]);

  useEffect(() => {
    const mesh = leds.current;
    if (!mesh) return;
    const neutral = new THREE.Color('#6f9fb0');
    const dim = new THREE.Color('#3d5560');
    const warn = new THREE.Color('#ff6a5c');
    const amber = new THREE.Color('#f4b740');
    for (let index = 0; index < mesh.count; index++) {
      const color = hot ? (index % 2 === 0 ? warn : amber) : index % 3 === 0 ? dim : neutral;
      mesh.setColorAt(index, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [hot, items]);

  const count = items.length;
  return (
    <group>
      <instancedMesh ref={shells} args={[BOX, m.graphite, count]} castShadow receiveShadow />
      <instancedMesh ref={doors} args={[BOX, m.black, count]} />
      <instancedMesh ref={handles} args={[BOX, m.steel, count]} />
      <instancedMesh ref={trays} args={[BOX, m.graphiteLight, count * TRAYS]} />
      <instancedMesh ref={fans} args={[CYL_LOW, m.black, count * TRAYS * 2]} />
      <instancedMesh ref={leds} args={[BOX, ledMat, count * TRAYS * 2]} />
      {items.map((rack) => (
        <Label key={rack.id} p={[rack.x, 2.08, rack.z + rack.d / 2 + 0.014]} size={[0.36, 0.1]} text={rack.id ?? ''} />
      ))}
      {/* 机柜上方走线槽 */}
      <B p={[(items[0]!.x + items[count - 1]!.x) / 2, 2.62, items[0]!.z]} s={[count * 0.82 + 0.4, 0.08, 0.5]} m={m.metal} />
      {Array.from({ length: count }, (_, index) => (
        <B key={index} p={[items[index]!.x, 2.42, items[0]!.z - 0.1]} s={[0.05, 0.36, 0.05]} m={m.black} />
      ))}
    </group>
  );
}

function AirHandler({ item, fanPct, active }: { item: Prop; fanPct: number; active: boolean }) {
  const m = materials();
  const blades = useRef<THREE.Group[]>([]);
  const speed = (active ? fanPct : 40) / 100;
  useFrame((_, delta) => {
    const reduce = useWorldStore.getState().reduceMotion;
    const omega = (reduce ? 1.5 : 9) * speed;
    blades.current.forEach((group) => {
      if (group) group.rotation.z += omega * Math.min(delta, 0.05);
    });
  });
  return (
    <group>
      <B p={[0, item.h / 2, 0]} s={[item.w, item.h, item.d]} m={m.graphiteLight} cast />
      <B p={[0, 0.3, item.d / 2 + 0.005]} s={[item.w - 0.12, 0.4, 0.01]} m={m.black} />
      {Array.from({ length: 8 }, (_, index) => (
        <B key={index} p={[0, 0.14 + index * 0.045, item.d / 2 + 0.012]} s={[item.w - 0.16, 0.012, 0.01]} m={m.metal} />
      ))}
      {[-0.48, 0, 0.48].map((x, index) => (
        <group key={x} position={[x, 1.35, item.d / 2 + 0.02]}>
          <mesh geometry={CYL} material={m.black} rotation={[Math.PI / 2, 0, 0]} scale={[0.42, 0.04, 0.42]} />
          <mesh geometry={CYL} material={m.metal} rotation={[Math.PI / 2, 0, 0]} scale={[0.4, 0.045, 0.4]} position={[0, 0, -0.005]} />
          <group ref={(group) => { if (group) blades.current[index] = group; }} position={[0, 0, 0.03]}>
            {[0, 1, 2, 3, 4].map((blade) => (
              <mesh key={blade} geometry={BOX} material={m.steel} rotation={[0, 0.4, (blade * Math.PI * 2) / 5]} scale={[0.06, 0.17, 0.008]} position={[Math.cos((blade * Math.PI * 2) / 5 + Math.PI / 2) * 0.09, Math.sin((blade * Math.PI * 2) / 5 + Math.PI / 2) * 0.09, 0]} />
            ))}
            <mesh geometry={CYL} material={m.graphite} rotation={[Math.PI / 2, 0, 0]} scale={[0.07, 0.04, 0.07]} />
          </group>
        </group>
      ))}
      <B p={[0, 1.9, item.d / 2 + 0.006]} s={[0.5, 0.12, 0.01]} m={m.black} />
      <B p={[-0.15, 1.9, item.d / 2 + 0.012]} s={[0.06, 0.04, 0.004]} m={m.cyan} />
      <Label p={[0.45, 1.9, item.d / 2 + 0.012]} size={[0.4, 0.11]} text={item.id ?? ''} />
    </group>
  );
}

function Beacon({ on }: { on: boolean }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a1412', emissive: '#ff4a3d', emissiveIntensity: 0, roughness: 0.4 }), []);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const reduce = useWorldStore.getState().reduceMotion;
    const pulse = on ? (reduce ? 1 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 7)) : 0;
    mat.emissiveIntensity = pulse * 3;
    if (light.current) light.current.intensity = pulse * 2.2;
  });
  const m = materials();
  return (
    <group>
      <B p={[0, 0.03, 0]} s={[0.14, 0.06, 0.14]} m={m.black} />
      <mesh geometry={CYL} material={mat} position={[0, 0.14, 0]} scale={[0.11, 0.16, 0.11]} />
      <pointLight ref={light} position={[0, 0.3, 0.3]} color="#ff5a4a" distance={5} decay={2} intensity={0} />
    </group>
  );
}

function PowerCabinet({ item, recorded, drill }: { item: Prop; recorded: boolean; drill: boolean }) {
  const m = materials();
  const front = item.d / 2;
  return (
    <group>
      <B p={[0, item.h / 2, 0]} s={[item.w, item.h, item.d]} m={m.graphiteLight} cast />
      <B p={[-0.02, 1.0, front + 0.006]} s={[item.w - 0.12, item.h - 0.2, 0.012]} m={m.graphite} />
      <B p={[item.w / 2 - 0.1, 1.0, front + 0.03]} s={[0.03, 0.3, 0.03]} m={m.steel} />
      {/* 主开关 */}
      <B p={[-0.15, 1.35, front + 0.03]} s={[0.18, 0.24, 0.05]} m={m.black} />
      <B p={[-0.15, 1.38, front + 0.07]} s={[0.05, 0.12, 0.05]} m={m.fireRed} />
      {/* 警示牌与接地标识 */}
      <mesh position={[0.12, 1.65, front + 0.014]}>
        <circleGeometry args={[0.09, 3]} />
        <meshStandardMaterial color="#e3b23c" roughness={0.5} />
      </mesh>
      <B p={[0.12, 1.635, front + 0.016]} s={[0.012, 0.06, 0.002]} m={m.black} />
      <B p={[0.25, 0.25, front + 0.012]} s={[0.12, 0.012, 0.004]} m={m.plant} />
      {[0, 1, 2].map((index) => (
        <B key={index} p={[-0.25 + index * 0.08, 1.1, front + 0.016]} s={[0.04, 0.04, 0.01]} m={drill ? m.red : recorded ? m.cyan : m.neutralLed} />
      ))}
      <Label p={[0, 1.83, front + 0.014]} size={[0.4, 0.1]} text={item.id ?? ''} />
    </group>
  );
}

function Ups({ item }: { item: Prop }) {
  const m = materials();
  const front = item.d / 2;
  return (
    <group>
      <B p={[0, item.h / 2, 0]} s={[item.w, item.h, item.d]} m={m.graphite} cast />
      <B p={[0, 0.3, front + 0.006]} s={[item.w - 0.08, 0.42, 0.01]} m={m.black} />
      {Array.from({ length: 6 }, (_, index) => (
        <B key={index} p={[0, 0.14 + index * 0.06, front + 0.012]} s={[item.w - 0.14, 0.012, 0.006]} m={m.metal} />
      ))}
      <B p={[0, 0.78, front + 0.008]} s={[0.3, 0.16, 0.01]} m={m.screenFrame} />
      <Screen p={[0, 0.78, front + 0.014]} size={[0.26, 0.12]} style="power" seed={9} />
      <B p={[0.22, 0.78, front + 0.012]} s={[0.03, 0.03, 0.006]} m={m.green} />
      <Label p={[0, 0.94, front + 0.012]} size={[0.3, 0.08]} text={item.id ?? ''} />
    </group>
  );
}

/** CO₂ 灭火器：瓶体、肩部、阀门、喇叭喷口、软管与壁挂底座 */
function Extinguisher() {
  const m = materials();
  const hose = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.03, 0.62, 0.02), new THREE.Vector3(0.1, 0.55, 0.06), new THREE.Vector3(0.12, 0.35, 0.08), new THREE.Vector3(0.1, 0.22, 0.09)
  ]), 12, 0.012, 6), []);
  return (
    <group>
      <B p={[0, 0.02, 0]} s={[0.24, 0.04, 0.24]} m={m.black} />
      <mesh geometry={CYL} material={m.fireRed} position={[0, 0.3, 0]} scale={[0.18, 0.5, 0.18]} castShadow />
      <mesh geometry={LEAF} material={m.fireRed} position={[0, 0.55, 0]} scale={[0.18, 0.1, 0.18]} />
      <B p={[0, 0.62, 0]} s={[0.05, 0.08, 0.05]} m={m.black} />
      <B p={[-0.04, 0.66, 0]} s={[0.12, 0.02, 0.04]} m={m.steel} />
      <mesh geometry={hose} material={m.rubber} />
      <mesh geometry={new THREE.ConeGeometry(0.05, 0.16, 10, 1, true)} material={m.black} position={[0.1, 0.16, 0.09]} rotation={[Math.PI, 0, 0]} />
      <B p={[0, 0.32, 0.091]} s={[0.1, 0.08, 0.004]} m={m.desktop} />
    </group>
  );
}

function Planter({ item }: { item: Prop }) {
  const m = materials();
  const leaves = useMemo(() => {
    const list: Array<{ p: V3; s: V3; dark: boolean }> = [];
    let seed = Math.round(item.x * 31 + item.z * 17);
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const count = Math.round(item.w * 7);
    for (let index = 0; index < count; index++) {
      list.push({
        p: [(random() - 0.5) * (item.w - 0.2), item.h + 0.12 + random() * 0.45, (random() - 0.5) * (item.d - 0.15)],
        s: [0.18 + random() * 0.16, 0.24 + random() * 0.3, 0.16 + random() * 0.14],
        dark: random() > 0.5
      });
    }
    return list;
  }, [item]);
  return (
    <group>
      <B p={[0, item.h / 2, 0]} s={[item.w, item.h, item.d]} m={m.concreteDark} cast />
      <B p={[0, item.h - 0.02, 0]} s={[item.w - 0.08, 0.03, item.d - 0.08]} m={m.soil} />
      <B p={[0, item.h / 2, item.d / 2 + 0.005]} s={[0.04, item.h - 0.16, 0.01]} m={m.amberSoft} />
      {leaves.map((leaf, index) => (
        <mesh key={index} geometry={LEAF} material={leaf.dark ? m.plantDark : m.plant} position={leaf.p} scale={leaf.s} castShadow />
      ))}
    </group>
  );
}

function Chair({ p, r = 0 }: { p: V3; r?: number }) {
  const m = materials();
  return (
    <group position={p} rotation={[0, r, 0]}>
      {[0, 1, 2, 3, 4].map((leg) => (
        <B key={leg} p={[Math.sin((leg * Math.PI * 2) / 5) * 0.14, 0.04, Math.cos((leg * Math.PI * 2) / 5) * 0.14]} s={[0.04, 0.03, 0.28]} r={[0, (leg * Math.PI * 2) / 5, 0]} m={m.black} />
      ))}
      <mesh geometry={CYL} material={m.metal} position={[0, 0.25, 0]} scale={[0.05, 0.4, 0.05]} />
      <B p={[0, 0.47, 0]} s={[0.46, 0.07, 0.44]} m={m.black} cast />
      <B p={[0, 0.8, 0.21]} s={[0.42, 0.56, 0.05]} m={m.black} cast />
      <B p={[0.24, 0.6, 0]} s={[0.04, 0.03, 0.3]} m={m.graphite} />
      <B p={[-0.24, 0.6, 0]} s={[0.04, 0.03, 0.3]} m={m.graphite} />
    </group>
  );
}

function WorkDesk({ item }: { item: Prop }) {
  const m = materials();
  const seats = Math.max(1, Math.round(item.w / 1.3));
  return (
    <group>
      <B p={[0, 0.74, 0]} s={[item.w, 0.04, item.d]} m={m.desktop} cast />
      {[-1, 1].map((side) => <B key={side} p={[side * (item.w / 2 - 0.05), 0.37, 0]} s={[0.05, 0.72, item.d - 0.06]} m={m.deskBody} />)}
      <B p={[item.w / 2 - 0.35, 0.36, 0]} s={[0.4, 0.62, item.d - 0.1]} m={m.deskBody} />
      {Array.from({ length: seats }, (_, index) => {
        const x = ((index + 0.5) / seats - 0.5) * item.w;
        return (
          <group key={index}>
            <Monitor p={[x, 0.76, -item.d / 2 + 0.2]} style={index % 2 ? 'network' : 'data'} seed={index + Math.round(item.x)} width={0.5} />
            <Chair p={[x, 0, item.d / 2 + 0.38]} r={Math.PI} />
          </group>
        );
      })}
    </group>
  );
}

function MeetingTable({ item }: { item: Prop }) {
  const m = materials();
  return (
    <group>
      <B p={[0, 0.74, 0]} s={[item.w, 0.05, item.d]} m={m.desktop} cast />
      <B p={[0, 0.36, 0]} s={[item.w * 0.6, 0.7, 0.14]} m={m.graphite} />
      <Chair p={[-0.6, 0, -0.85]} />
      <Chair p={[0.6, 0, -0.85]} />
      <Chair p={[-0.6, 0, 0.85]} r={Math.PI} />
      <Chair p={[0.6, 0, 0.85]} r={Math.PI} />
    </group>
  );
}

function Shelf({ item }: { item: Prop }) {
  const m = materials();
  return (
    <group>
      {[-1, 1].map((side) => <B key={side} p={[side * (item.w / 2 - 0.02), item.h / 2, 0]} s={[0.04, item.h, item.d]} m={m.graphite} cast />)}
      {[0.05, 0.5, 0.95, 1.4, 1.82].map((y) => <B key={y} p={[0, y, 0]} s={[item.w, 0.03, item.d]} m={m.graphiteLight} />)}
      {[0.08, 0.53, 0.98, 1.43].map((y, row) => (
        <Binders key={y} p={[-item.w / 2 + 0.15 + (row % 2) * 0.4, y, 0]} />
      ))}
    </group>
  );
}

function ServerCabinet({ item }: { item: Prop }) {
  const m = materials();
  const front = item.d / 2;
  return (
    <group>
      <B p={[0, item.h / 2, 0]} s={[item.w, item.h, item.d]} m={m.graphite} cast />
      <B p={[0, 1.0, front + 0.006]} s={[item.w - 0.08, item.h - 0.2, 0.01]} m={m.black} />
      {Array.from({ length: 8 }, (_, index) => (
        <group key={index}>
          <B p={[0, 0.25 + index * 0.2, front + 0.014]} s={[item.w - 0.14, 0.1, 0.01]} m={m.graphiteLight} />
          <B p={[item.w / 2 - 0.12, 0.25 + index * 0.2, front + 0.02]} s={[0.025, 0.02, 0.006]} m={index % 3 ? m.neutralLed : m.cyanSoft} />
        </group>
      ))}
    </group>
  );
}

function Locker({ item }: { item: Prop }) {
  const m = materials();
  const units = Math.round(item.w / 0.6);
  return (
    <group>
      <B p={[0, item.h / 2, 0]} s={[item.w, item.h, item.d]} m={m.graphiteLight} cast />
      {Array.from({ length: units }, (_, index) => {
        const x = ((index + 0.5) / units - 0.5) * item.w;
        return (
          <group key={index}>
            <B p={[x, item.h / 2, item.d / 2 + 0.005]} s={[item.w / units - 0.03, item.h - 0.1, 0.01]} m={m.concreteDark} />
            <B p={[x + 0.18, item.h / 2 + 0.1, item.d / 2 + 0.02]} s={[0.02, 0.14, 0.02]} m={m.steel} />
            <B p={[x, item.h - 0.2, item.d / 2 + 0.012]} s={[0.2, 0.05, 0.004]} m={m.desktop} />
          </group>
        );
      })}
    </group>
  );
}

function WallScreen({ item, stages }: { item: Prop; stages: SceneState['stages'] }) {
  const m = materials();
  const stageTexture = useMemo(() => (item.id === 'stage-wall' ? stageWallTexture(stages) : null), [item.id, JSON.stringify(stages)]);
  useEffect(() => () => stageTexture?.dispose(), [stageTexture]);
  const style: ScreenStyle = item.id === 'audit-wall' ? 'audit' : item.id === 'ai-wall' ? 'model' : 'network';
  return (
    <group position={[0, item.y ?? 1.2, 0]}>
      <B p={[0, item.h / 2, 0]} s={[item.w + 0.1, item.h + 0.1, 0.06]} m={m.screenFrame} />
      {stageTexture ? (
        <mesh position={[0, item.h / 2, 0.035]}>
          <planeGeometry args={[item.w, item.h]} />
          <meshBasicMaterial map={stageTexture} toneMapped={false} />
        </mesh>
      ) : (
        <Screen p={[0, item.h / 2, 0.035]} size={[item.w, item.h]} style={style} seed={Math.round(item.x)} />
      )}
      <B p={[0, item.h + 0.08, 0.02]} s={[item.w * 0.6, 0.02, 0.04]} m={m.cyanSoft} />
    </group>
  );
}

function NoticeBoard({ item }: { item: Prop }) {
  const m = materials();
  const texture = useMemo(() => noticeTexture(), []);
  return (
    <group position={[0, item.y ?? 1.2, 0]}>
      <B p={[0, item.h / 2, 0]} s={[item.w + 0.08, item.h + 0.08, 0.04]} m={m.pillar} />
      <mesh position={[0, item.h / 2, 0.025]}>
        <planeGeometry args={[item.w, item.h]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function PropModel({ item, scene }: { item: Prop; scene: SceneState }) {
  switch (item.kind) {
    case 'powerCabinet': return <PowerCabinet item={item} recorded={scene.power.s18Recorded} drill={scene.power.drill} />;
    case 'ups': return <Ups item={item} />;
    case 'airHandler': return <AirHandler item={item} fanPct={scene.cooling.fanPct} active={scene.cooling.active} />;
    case 'extinguisher': return <Extinguisher />;
    case 'planter': return <Planter item={item} />;
    case 'locker': return <Locker item={item} />;
    case 'serverCabinet': return <ServerCabinet item={item} />;
    case 'workDesk': return <WorkDesk item={item} />;
    case 'meetingTable': return <MeetingTable item={item} />;
    case 'shelf': return <Shelf item={item} />;
    case 'wallScreen': return <WallScreen item={item} stages={scene.stages} />;
    case 'noticeBoard': return <NoticeBoard item={item} />;
    case 'beacon': return <Beacon on={scene.power.drill || (scene.cooling.active && scene.cooling.peakC !== null && scene.cooling.limitC !== null && scene.cooling.peakC > scene.cooling.limitC)} />;
    default: return null;
  }
}

function HotspotDevice({ hotspot, rot, scene, quality, reduceMotion }: { hotspot: Hotspot; rot: number; scene: SceneState; quality: Quality; reduceMotion: boolean }) {
  const status = scene.hotspots[hotspot.id] ?? 'locked';
  const [w, d] = hotspot.size;
  const m = materials();
  let body: React.ReactNode;
  switch (hotspot.kind) {
    case 'kiosk': body = <Kiosk status={status} />; break;
    case 'briefing': body = <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'briefing', x: -0.35 }, { style: 'network', x: 0.35, seed: 4 }]} extras={<Binders p={[0.45, 0.925, 0.12]} />} />; break;
    case 'dataDesk': body = <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'data', x: 0, width: 0.72 }]} />; break;
    case 'incident': body = (
      <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'incident', x: -0.1 }]} extras={(
        <group position={[0.5, 0.93, 0]}>
          <B p={[0, 0.1, 0]} s={[0.12, 0.2, 0.12]} m={m.graphite} />
          <B p={[0, 0.22, 0]} s={[0.1, 0.05, 0.1]} m={status === 'current' ? m.red : m.ledOff} />
        </group>
      )} />
    ); break;
    case 'modelDesk': body = <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'model', x: -0.32, width: 0.56 }, { style: 'review', x: 0.32, width: 0.56, seed: 6 }]} />; break;
    case 'sandbox': body = <Sandbox status={status} slots={scene.sandbox.slots} quality={quality} />; break;
    case 'agentConsole': body = <AgentConsole status={status} levels={scene.agent.levels} trace={scene.agent.trace} dirty={scene.agent.dirty} reduceMotion={reduceMotion} />; break;
    case 'inspection': body = (
      <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'gpu', x: -0.32, width: 0.56 }, { style: 'cooling', x: 0.32, width: 0.56, seed: 2 }]} extras={(
        <group position={[0.6, 0.93, 0.15]}>
          <B p={[0, 0.05, 0]} s={[0.1, 0.1, 0.08]} m={m.graphite} />
          <B p={[0, 0.12, 0]} s={[0.07, 0.04, 0.07]} m={scene.inspection.verified ? (scene.inspection.ambientOk ? m.green : m.red) : m.ledOff} />
        </group>
      )} />
    ); break;
    case 'powerDesk': body = <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'power', x: 0 }]} />; break;
    case 'coolingDesk': {
      const { peakC, limitC, stale } = scene.cooling;
      const known = peakC !== null && limitC !== null && !stale;
      body = (
        <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'cooling', x: -0.32, width: 0.56 }, { style: 'gpu', x: 0.32, width: 0.56, seed: 8 }]} extras={(
          <group position={[-0.62, 0.93, 0.15]}>
            <B p={[0, 0.05, 0]} s={[0.1, 0.1, 0.08]} m={m.graphite} />
            <B p={[0, 0.12, 0]} s={[0.07, 0.04, 0.07]} m={known ? (peakC! > limitC! ? m.red : m.cyan) : m.ledOff} />
          </group>
        )} />
      );
      break;
    }
    case 'auditDesk': body = <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'audit', x: -0.32, width: 0.56 }, { style: 'audit', x: 0.32, width: 0.56, seed: 3 }]} />; break;
    case 'safetyStation': body = (
      // 应急安全站：气体灭火控制盘（红）、AED 箱（绿）、急救箱与疏散图
      <group>
        <B p={[0, 0.9, 0]} s={[w, 1.8, d]} m={m.deskBody} cast />
        <B p={[0, 1.79, d / 2 + 0.006]} s={[w * 0.9, 0.03, 0.01]} m={statusMaterial(status)} />
        <B p={[-0.3, 1.32, d / 2 + 0.012]} s={[0.42, 0.52, 0.02]} m={m.fireRed} />
        <Label p={[-0.3, 1.32, d / 2 + 0.024]} size={[0.36, 0.1]} text="气体灭火控制" background="#b8322c" color="#ffffff" />
        <B p={[0.3, 1.22, d / 2 + 0.012]} s={[0.34, 0.4, 0.02]} m={m.green} />
        <Label p={[0.3, 1.22, d / 2 + 0.024]} size={[0.28, 0.1]} text="AED" background="#1f7a52" color="#ffffff" />
        <B p={[0.3, 0.72, d / 2 + 0.012]} s={[0.34, 0.26, 0.02]} m={m.screenFrame} />
        <Label p={[0.3, 0.72, d / 2 + 0.024]} size={[0.28, 0.08]} text="急救箱" />
        <Label p={[-0.3, 0.78, d / 2 + 0.014]} size={[0.42, 0.3]} text="疏散路线图" />
      </group>
    ); break;
    case 'reviewDesk': body = <DeskTerminal w={w} d={d} status={status} screens={[{ style: 'review', x: -0.34, width: 0.58 }, { style: 'briefing', x: 0.34, width: 0.58, seed: 2 }]} extras={<Binders p={[-0.72, 0.925, 0.12]} />} />; break;
  }
  // 沙箱与权限台含随结果变化的动态部件，不合批；其余终端按状态版本合批
  const dynamic = hotspot.kind === 'sandbox' || hotspot.kind === 'agentConsole';
  const version = `${status}|${scene.inspection.verified}|${scene.inspection.ambientOk}|${scene.cooling.peakC}|${scene.cooling.stale}`;
  return (
    <group position={[hotspot.position[0], 0, hotspot.position[1]]} rotation={[0, ROT(rot), 0]}>
      {dynamic ? body : <StaticMerge version={version}>{body}</StaticMerge>}
    </group>
  );
}

/** 不含动画或状态切换的陈设，可整体合批 */
const STATIC_KINDS = new Set<Prop['kind']>(['planter', 'locker', 'serverCabinet', 'workDesk', 'meetingTable', 'shelf', 'ups', 'extinguisher', 'wallScreen', 'noticeBoard']);

export function Devices({ scene, quality, reduceMotion }: { scene: SceneState; quality: Quality; reduceMotion: boolean }) {
  const racks = useMemo(() => PROPS.filter((item) => item.kind === 'rack'), []);
  const others = useMemo(() => PROPS.filter((item) => item.kind !== 'rack'), []);
  const hot = scene.cooling.active && scene.cooling.peakC !== null && scene.cooling.limitC !== null && !scene.cooling.stale && scene.cooling.peakC > scene.cooling.limitC;
  return (
    <group>
      {racks.length === RACK_COUNT ? <RackRow items={racks} hot={hot} /> : null}
      {others.map((item, index) => (
        <group key={`${item.kind}-${index}`} position={[item.x, item.kind === 'beacon' ? item.y ?? 0 : 0, item.z]} rotation={[0, ROT(item.rot), 0]}>
          {STATIC_KINDS.has(item.kind) ? (
            <StaticMerge version={item.id === 'stage-wall' ? JSON.stringify(scene.stages) : ''}><PropModel item={item} scene={scene} /></StaticMerge>
          ) : (
            <PropModel item={item} scene={scene} />
          )}
        </group>
      ))}
      {HOTSPOT_PROPS.map(({ hotspot, rot }) => (
        <HotspotDevice key={hotspot.id} hotspot={hotspot} rot={rot} scene={scene} quality={quality} reduceMotion={reduceMotion} />
      ))}
    </group>
  );
}
