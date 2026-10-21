import { Html } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Building } from './Building';
import { cameraClearance, moveCircle } from './collision';
import { Devices } from './Devices';
import { moveIntent } from './input';
import {
  DOORS,
  EXIT_RADIUS,
  HOTSPOTS,
  HOTSPOT_BY_ID,
  INTERACT_RADIUS,
  PLAYER,
  WORLD,
  ZONE_BY_ID,
  yawToward,
  zoneAt,
  type Vec2
} from './layout';
import { pathTo } from './nav';
import { Player } from './Player';
import type { SceneState } from './sceneAdapter';
import { camera as cam, perf, player, useWorldStore, type Quality } from './worldStore';

const FOLLOW_DIST = Math.hypot(4.4, 0.75);
const TARGET_Y = 1.35;
const damp = (lambda: number, delta: number) => 1 - Math.exp(-lambda * delta);

function angleLerp(from: number, to: number, t: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

export function panelWidth(width: number): number {
  if (width >= 1100) return 500;
  if (width > 760) return Math.min(420, width * 0.48);
  return 0;
}

/** 人物移动、自动前往、热点检测与模式过渡；每帧数据只写可变对象 */
function Controller({ scene }: { scene: SceneState }) {
  const timer = useRef(0);
  const pathRef = useRef<{ points: Vec2[]; at: number }>({ points: [], at: 0 });
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, PLAYER.maxDelta);
    const world = useWorldStore.getState();
    player.moved = 0;
    const s = sceneRef.current;

    if (world.mode === 'focusing' || world.mode === 'operating') {
      const hotspot = world.focusHotspotId ? HOTSPOT_BY_ID.get(world.focusHotspotId) : null;
      if (hotspot) {
        // 平滑走到安全站位并面向设备（站位已在碰撞体之外）
        const t = damp(world.reduceMotion ? 18 : 6, delta);
        const nx = player.x + (hotspot.standPoint[0] - player.x) * t;
        const nz = player.z + (hotspot.standPoint[1] - player.z) * t;
        player.moved = Math.hypot(nx - player.x, nz - player.z);
        player.x = nx;
        player.z = nz;
        player.yaw = angleLerp(player.yaw, yawToward(hotspot.standPoint, hotspot.position), damp(8, delta));
      }
      if (world.mode === 'focusing') {
        timer.current += delta;
        if (timer.current >= (world.reduceMotion ? 0.25 : 0.7)) {
          timer.current = 0;
          world.setMode('operating');
        }
      }
      return;
    }
    if (world.mode === 'returning') {
      timer.current += delta;
      if (timer.current >= (world.reduceMotion ? 0.2 : 0.6)) {
        timer.current = 0;
        world.setMode('exploring');
      }
    }
    if (world.mode !== 'exploring' && world.mode !== 'returning') return;
    if (world.drawer !== 'none') return;

    // 手动输入（相对相机方向）；任何手动输入都会取消自动前往
    const [ix, iy] = moveIntent();
    let dirX = 0;
    let dirZ = 0;
    if (ix !== 0 || iy !== 0) {
      if (world.autoWalk) world.setAutoWalk(false);
      const fx = -Math.sin(cam.yaw);
      const fz = -Math.cos(cam.yaw);
      dirX = fx * iy + -fz * ix;
      dirZ = fz * iy + fx * ix;
    } else if (world.autoWalk && s.currentHotspotId) {
      const hotspot = HOTSPOT_BY_ID.get(s.currentHotspotId)!;
      const now = performance.now();
      if (now - pathRef.current.at > 250) pathRef.current = { points: pathTo([player.x, player.z], hotspot.zone, hotspot.standPoint), at: now };
      const next = pathRef.current.points.find((point, index) => index > 0 && Math.hypot(point[0] - player.x, point[1] - player.z) > 0.3);
      if (!next) {
        world.setAutoWalk(false);
        player.yaw = yawToward(hotspot.standPoint, hotspot.position);
      } else {
        const length = Math.hypot(next[0] - player.x, next[1] - player.z);
        dirX = (next[0] - player.x) / length;
        dirZ = (next[1] - player.z) / length;
      }
    }

    const length = Math.hypot(dirX, dirZ);
    if (length > 0) {
      dirX /= length;
      dirZ /= length;
      const [nx, nz] = moveCircle(player.x, player.z, dirX * PLAYER.speed * delta, dirZ * PLAYER.speed * delta);
      player.moved = Math.hypot(nx - player.x, nz - player.z);
      player.x = Math.min(WORLD.width - 0.3, Math.max(0.3, nx));
      player.z = Math.min(WORLD.depth - 0.3, Math.max(0.3, nz));
      player.yaw = angleLerp(player.yaw, Math.atan2(-dirX, -dirZ), damp(12, delta));
    }
    player.speed = player.moved / Math.max(delta, 1e-4);

    // 热点：同区域、未遮挡，进入 2.1m、离开 2.5m；当前任务优先
    const zone = zoneAt(player.x, player.z);
    let best: { id: string; score: number } | null = null;
    for (const hotspot of HOTSPOTS) {
      if (hotspot.zone !== zone) continue;
      const distance = Math.hypot(hotspot.position[0] - player.x, hotspot.position[1] - player.z);
      const radius = world.nearHotspotId === hotspot.id ? EXIT_RADIUS : INTERACT_RADIUS;
      if (distance > radius) continue;
      const score = distance - (s.hotspots[hotspot.id] === 'current' ? 10 : 0);
      if (!best || score < best.score) best = { id: hotspot.id, score };
    }
    world.setNear(best?.id ?? null);

    // 走近尚未开放的门时给出说明
    const lockedDoor = DOORS.find((door) => !s.unlockedZones.has(door.zone) && Math.hypot(door.x - player.x, door.z - player.z) < 2.2);
    world.setNotice(lockedDoor ? `${ZONE_BY_ID.get(lockedDoor.zone)!.name}尚未开放：完成前面的任务后自动开放` : null);
  });
  return null;
}

/** 相机：跟随 / 设备近景 / 登录展示，带防穿墙与操作面板偏移 */
function CameraRig({ scene }: { scene: SceneState }) {
  const { camera, gl, size } = useThree();
  const pos = useRef(new THREE.Vector3(2.4, 1.9, 12.9));
  const look = useRef(new THREE.Vector3(12, 1.5, 12));
  const shift = useRef(0);
  const desired = useMemo(() => new THREE.Vector3(), []);
  const desiredLook = useMemo(() => new THREE.Vector3(), []);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    const element = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      const mode = useWorldStore.getState().mode;
      if (mode !== 'exploring' && mode !== 'returning') return;
      last = { x: event.clientX, y: event.clientY };
      cam.dragging = true;
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!last) return;
      cam.yaw -= (event.clientX - last.x) * 0.0055;
      cam.pitch = Math.min(0.62, Math.max(0.02, cam.pitch + (event.clientY - last.y) * 0.004));
      last = { x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      last = null;
      cam.dragging = false;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
  }, [gl]);

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const world = useWorldStore.getState();
    const perspective = camera as THREE.PerspectiveCamera;
    let lambda = 8;
    const panel = world.mode === 'focusing' || world.mode === 'operating' ? panelWidth(size.width) : 0;

    if (world.mode === 'attract') {
      const sway = world.reduceMotion ? 0 : Math.sin(clock.elapsedTime * 0.15) * 0.25;
      desired.set(2.4, 1.85, 12.9 + sway * 0.4);
      desiredLook.set(12, 1.45, 12 + sway);
      lambda = 2.5;
    } else if ((world.mode === 'focusing' || world.mode === 'operating') && world.focusHotspotId) {
      const hotspot = HOTSPOT_BY_ID.get(world.focusHotspotId)!;
      const [sx, sz] = hotspot.standPoint;
      const fx = hotspot.position[0] - sx;
      const fz = hotspot.position[1] - sz;
      const length = Math.hypot(fx, fz) || 1;
      const ux = fx / length;
      const uz = fz / length;
      // 越肩近景：人物与设备同框，面板在右侧时由 viewOffset 把构图移到左侧
      desired.set(sx - ux * 2.25 - uz * 0.95, 2.05, sz - uz * 2.25 + ux * 0.95);
      desiredLook.set(sx + ux * 1.15, 1.05, sz + uz * 1.15);
      lambda = world.reduceMotion ? 14 : 5.5;
    } else {
      const back = FOLLOW_DIST * Math.cos(cam.pitch);
      const up = FOLLOW_DIST * Math.sin(cam.pitch);
      desiredLook.set(player.x, TARGET_Y, player.z);
      desired.set(player.x + Math.sin(cam.yaw) * back, TARGET_Y + up, player.z + Math.cos(cam.yaw) * back);
      lambda = world.mode === 'returning' ? (world.reduceMotion ? 14 : 6) : 8;
    }

    // 防穿墙：从注视点向期望相机位置做射线检测，受阻时拉近
    const t = cameraClearance(desiredLook.x, desiredLook.y, desiredLook.z, desired.x, desired.y, desired.z);
    if (t < 1) {
      const minT = Math.min(1, 0.6 / Math.max(0.01, desired.distanceTo(desiredLook)));
      desired.lerp(desiredLook, 1 - Math.max(t, minT));
    }
    desired.y = Math.min(WORLD.ceiling - 0.3, desired.y);

    const pulledIn = desired.distanceTo(desiredLook) < pos.current.distanceTo(desiredLook) - 0.05;
    pos.current.lerp(desired, damp(pulledIn ? Math.max(lambda, 22) : lambda, delta));
    look.current.lerp(desiredLook, damp(lambda, delta));
    camera.position.copy(pos.current);
    camera.lookAt(look.current);

    shift.current += (panel - shift.current) * damp(world.reduceMotion ? 20 : 7, delta);
    if (shift.current > 0.5) {
      perspective.setViewOffset(size.width + shift.current, size.height, shift.current, 0, size.width, size.height);
    } else if (perspective.view) {
      perspective.clearViewOffset();
    }
  });
  return null;
}

/** 地面导引：只沿走廊与门洞折线显示，不穿墙直连 */
function GuideLine({ scene }: { scene: SceneState }) {
  const MAX = 120;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const last = useRef(0);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#F4B740', toneMapped: false, transparent: true, opacity: 0.9 }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#F4B740', toneMapped: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useFrame(({ clock }) => {
    const world = useWorldStore.getState();
    const target = sceneRef.current.currentHotspotId ? HOTSPOT_BY_ID.get(sceneRef.current.currentHotspotId) : null;
    const show = Boolean(target) && (world.mode === 'exploring' || world.mode === 'returning') && world.drawer === 'none';
    if (ring.current) {
      ring.current.visible = show;
      if (target && show) {
        ring.current.position.set(target.standPoint[0], 0.015, target.standPoint[1]);
        const pulse = world.reduceMotion ? 1 : 1 + Math.sin(clock.elapsedTime * 3) * 0.06;
        ring.current.scale.setScalar(pulse);
      }
    }
    if (!mesh.current) return;
    mesh.current.visible = show;
    if (!show || !target) return;
    const now = performance.now();
    if (now - last.current < 200) return;
    last.current = now;
    const path = pathTo([player.x, player.z], target.zone, target.standPoint);
    let count = 0;
    const dash = 0.42;
    const gap = 0.38;
    let carry = 0.6;
    for (let index = 1; index < path.length && count < MAX; index++) {
      const [ax, az] = path[index - 1]!;
      const [bx, bz] = path[index]!;
      const length = Math.hypot(bx - ax, bz - az);
      const angle = Math.atan2(bx - ax, bz - az);
      let d = carry;
      while (d + dash <= length && count < MAX) {
        const mid = d + dash / 2;
        dummy.position.set(ax + ((bx - ax) * mid) / length, 0.012, az + ((bz - az) * mid) / length);
        dummy.rotation.set(0, angle, 0);
        dummy.scale.set(0.12, 0.01, dash);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(count++, dummy.matrix);
        d += dash + gap;
      }
      carry = Math.max(0, d - length);
    }
    mesh.current.count = count;
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[geometry, material, MAX]} frustumCulled={false} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.52, 40]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
    </group>
  );
}

/** 当前可交互设备上方的提示（同时提供可点击按钮） */
function HotspotPrompt({ scene, onInteract }: { scene: SceneState; onInteract: (hotspotId: string) => void }) {
  const near = useWorldStore((state) => state.nearHotspotId);
  const mode = useWorldStore((state) => state.mode);
  if (!near || mode !== 'exploring') return null;
  const hotspot = HOTSPOT_BY_ID.get(near)!;
  const status = scene.hotspots[near] ?? 'locked';
  return (
    <Html position={[hotspot.position[0], 1.95, hotspot.position[1]]} center zIndexRange={[20, 0]}>
      {status === 'locked' ? (
        <div className="world-prompt locked">{hotspot.name} · 当前尚未开放</div>
      ) : (
        <button type="button" className="world-prompt" onClick={() => onInteract(near)}>
          <kbd>E</kbd>
          {status === 'current' ? `操作${hotspot.name}` : `回看${hotspot.name}记录`}
        </button>
      )}
    </Html>
  );
}

function Lights({ quality }: { quality: Quality }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const shadow = quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 0;
  useLayoutEffect(() => {
    const dir = light.current;
    if (!dir) return;
    dir.target.position.set(18, 0, 12);
    dir.target.updateMatrixWorld();
  }, []);
  return (
    <>
      <hemisphereLight args={['#e4eef7', '#3a4652', 1.35]} />
      <ambientLight intensity={0.3} color="#a9bccc" />
      <directionalLight
        key={quality}
        ref={light}
        position={[22, 20, 18]}
        intensity={1.6}
        color="#fff3e2"
        castShadow={shadow > 0}
        shadow-mapSize={[shadow || 512, shadow || 512]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />
      {/* 每个房间一盏柔和填充光，区分色温；不为每颗 LED 加点光源 */}
      <pointLight position={[9, 3.2, 5]} intensity={9} distance={15} decay={1.5} color="#b5dbff" />
      <pointLight position={[27, 3.2, 5]} intensity={8} distance={15} decay={1.5} color="#ffe6c4" />
      <pointLight position={[6, 3.2, 19]} intensity={8} distance={13} decay={1.5} color="#ffe9cc" />
      <pointLight position={[18, 3.2, 19]} intensity={8} distance={13} decay={1.5} color="#e2f0ff" />
      <pointLight position={[30, 3.2, 19]} intensity={8} distance={13} decay={1.5} color="#c6ecf7" />
      {/* 走廊顶部暖色补光；低画质减半 */}
      {(quality === 'low' ? [9, 27] : [3, 12, 21, 30]).map((x) => (
        <pointLight key={x} position={[x, 3.3, 12]} intensity={quality === 'low' ? 6 : 4.5} distance={11} decay={1.5} color="#ffe6c4" />
      ))}
    </>
  );
}

/** 画质档位：显式切换阴影并让材质重新编译，避免沿用旧的阴影着色器 */
function QualityApplier({ quality }: { quality: Quality }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.shadowMap.enabled = quality !== 'low';
    gl.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    gl.shadowMap.needsUpdate = true;
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true;
    });
  }, [quality, gl, scene]);
  return null;
}

/** 帧时间采样：供设置面板显示实测帧率与 p95，不进 React 状态 */
function PerfProbe() {
  const { gl } = useThree();
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __zhianGl: unknown }).__zhianGl = gl;
  }, [gl]);
  useFrame((_, delta) => {
    perf.frames.push(delta * 1000);
    if (perf.frames.length > 600) perf.frames.shift();
    perf.drawCalls = gl.info.render.calls;
    perf.triangles = gl.info.render.triangles;
  });
  return null;
}

function SceneContents({ scene, onInteract }: { scene: SceneState; onInteract: (hotspotId: string) => void }) {
  const quality = useWorldStore((state) => state.quality);
  const reduceMotion = useWorldStore((state) => state.reduceMotion);
  return (
    <>
      <color attach="background" args={['#0C141D']} />
      <fog attach="fog" args={['#0C141D', 26, 48]} />
      <QualityApplier quality={quality} />
      <Lights quality={quality} />
      <Building quality={quality} unlockedZones={scene.unlockedZones} />
      <Devices scene={scene} quality={quality} reduceMotion={reduceMotion} />
      <Player />
      <GuideLine scene={scene} />
      <HotspotPrompt scene={scene} onInteract={onInteract} />
      <Controller scene={scene} />
      <CameraRig scene={scene} />
      <PerfProbe />
    </>
  );
}

export function WorldCanvas({ scene, onInteract, onContextLost }: { scene: SceneState; onInteract: (hotspotId: string) => void; onContextLost: (reason: string) => void }) {
  const quality = useWorldStore((state) => state.quality);
  const dpr = quality === 'high' ? 1.75 : quality === 'medium' ? 1.25 : 1;
  return (
    // 画质切换不重建 Canvas（保持同一个持续世界）；抗锯齿在创建时固定开启，低画质靠像素比与阴影降开销
    <Canvas
      className="world-canvas"
      shadows
      dpr={[1, dpr]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 50, near: 0.1, far: 70, position: [0.9, 1.9, 12.9] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.2;
        const canvas = gl.domElement;
        let restored = false;
        canvas.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          restored = false;
          window.setTimeout(() => {
            // 组件卸载时主动释放的上下文不算故障
            if (!restored && canvas.isConnected) onContextLost('三维渲染上下文丢失且未能恢复，已切换到 HTML 实验模式。');
          }, 3000);
        });
        canvas.addEventListener('webglcontextrestored', () => {
          restored = true;
        });
      }}
    >
      <SceneContents scene={scene} onInteract={onInteract} />
    </Canvas>
  );
}

export const STAND_POINTS = HOTSPOTS.map((hotspot) => hotspot.standPoint);
