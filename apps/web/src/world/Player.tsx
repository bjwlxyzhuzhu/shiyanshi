import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { poseAt, STRIDE } from './pose';
import { logoTexture } from './textures';
import { player, useWorldStore } from './worldStore';

/**
 * 程序化研究员：根 → 骨盆 → 躯干/头/肩/肘/髋/膝/脚，全部为真实父子轴心。
 * 步态由本帧有效位移推进；碰墙无位移时脚步停止，不原地滑步。
 */

/** 发束：头顶向后梳、额前短刘海、两侧鬓角（x, y, z, 绕 X, 绕 Z） */
const HAIR_LOCKS: Array<[number, number, number, number, number]> = [
  [0, 0.205, 0.03, 1.15, 0],
  [0.06, 0.195, 0.035, 1.05, -0.35],
  [-0.06, 0.195, 0.035, 1.05, 0.35],
  [0.02, 0.2, -0.04, 0.55, -0.1],
  [0.035, 0.185, -0.085, -1.05, -0.25],
  [-0.045, 0.18, -0.08, -1.1, 0.4],
  [0.085, 0.16, -0.06, -0.8, -0.85],
  [0.118, 0.12, 0.01, 0.25, -1.45],
  [-0.118, 0.12, 0.01, 0.25, 1.45]
];

const C = {
  jacket: '#e9edf0',
  jacketShade: '#d5dbe0',
  teal: '#1f6a70',
  collar: '#1c3a44',
  pants: '#2b3038',
  skin: '#e2b896',
  hair: '#2a1f1a',
  shoe: '#eef1f3',
  sole: '#1f6a70',
  strap: '#20262c'
};

function useMats() {
  return useMemo(() => {
    const mk = (color: string, roughness = 0.7) => new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
    return {
      jacket: mk(C.jacket, 0.65),
      jacketShade: mk(C.jacketShade, 0.7),
      teal: mk(C.teal, 0.6),
      collar: mk(C.collar, 0.6),
      pants: mk(C.pants, 0.8),
      skin: mk(C.skin, 0.75),
      hair: mk(C.hair, 0.85),
      shoe: mk(C.shoe, 0.5),
      sole: mk(C.sole, 0.6),
      strap: mk(C.strap, 0.6),
      logo: new THREE.MeshBasicMaterial({ map: logoTexture(), transparent: true, toneMapped: false })
    };
  }, []);
}

function torsoGeometry(): THREE.ExtrudeGeometry {
  // 夹克躯干：肩宽腰窄的梯形挤出体，带倒角
  const shape = new THREE.Shape();
  shape.moveTo(-0.17, 0);
  shape.lineTo(0.17, 0);
  shape.lineTo(0.215, 0.43);
  shape.quadraticCurveTo(0.2, 0.5, 0.12, 0.51);
  shape.lineTo(-0.12, 0.51);
  shape.quadraticCurveTo(-0.2, 0.5, -0.215, 0.43);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 4 });
  geometry.translate(0, 0, -0.1);
  return geometry;
}

function limb(radiusTop: number, radiusBottom: number, length: number): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 8);
  geometry.translate(0, -length / 2, 0);
  return geometry;
}

export function Player() {
  const mats = useMats();
  const geo = useMemo(() => ({
    torso: torsoGeometry(),
    upperArm: limb(0.058, 0.05, 0.28),
    forearm: limb(0.05, 0.042, 0.25),
    cuff: limb(0.054, 0.054, 0.04),
    thigh: limb(0.082, 0.066, 0.42),
    shin: limb(0.064, 0.05, 0.42),
    hand: new THREE.BoxGeometry(0.07, 0.1, 0.045),
    shoe: new THREE.BoxGeometry(0.11, 0.08, 0.27),
    soleGeo: new THREE.BoxGeometry(0.115, 0.025, 0.28),
    head: new THREE.IcosahedronGeometry(0.115, 1),
    hairCap: new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairSpike: new THREE.ConeGeometry(0.045, 0.11, 4).scale(1, 1, 0.5),
    joint: new THREE.SphereGeometry(0.062, 8, 6),
    neck: limb(0.05, 0.05, 0.08),
    ear: new THREE.SphereGeometry(0.025, 6, 4),
    box: new THREE.BoxGeometry(1, 1, 1),
    pelvis: new THREE.BoxGeometry(0.33, 0.16, 0.2)
  }), []);

  const root = useRef<THREE.Group>(null);
  const pelvis = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const shoulderR = useRef<THREE.Group>(null);
  const shoulderL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const hipR = useRef<THREE.Group>(null);
  const hipL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const footR = useRef<THREE.Group>(null);
  const footL = useRef<THREE.Group>(null);

  const anim = useRef({ phase: 0, walk: 0, op: 0, time: 0 });

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const state = useWorldStore.getState();
    const a = anim.current;
    a.time += delta;
    if (!root.current) return;
    root.current.position.set(player.x, 0, player.z);
    root.current.rotation.y = player.yaw;

    // 步态只在获得有效位移时推进；碰墙无位移时脚步停止
    a.phase += (player.moved / STRIDE) * Math.PI * 2;
    const walking = player.moved > 0.0005 ? 1 : 0;
    a.walk += (walking - a.walk) * (1 - Math.exp(-10 * delta));
    const operating = state.mode === 'operating' || state.mode === 'focusing' ? 1 : 0;
    a.op += (operating - a.op) * (1 - Math.exp(-6 * delta));

    const pose = poseAt(a.phase, a.walk, a.op);
    const breathe = state.reduceMotion ? 0 : Math.sin(a.time * 1.6) * 0.008 * (1 - a.walk);

    if (pelvis.current) pelvis.current.position.y = 0.93 + pose.pelvisLift;
    if (torso.current) {
      torso.current.position.y = 0.06 + breathe;
      torso.current.rotation.set(pose.torsoX, pose.torsoY, 0);
    }
    if (head.current) head.current.rotation.x = pose.headX;
    // 右侧（+X）与左侧分别取姿态；肩部 Z 轴轻微外展让手臂离开躯干
    if (hipR.current) hipR.current.rotation.x = pose.hipR;
    if (hipL.current) hipL.current.rotation.x = pose.hipL;
    if (kneeR.current) kneeR.current.rotation.x = pose.kneeR;
    if (kneeL.current) kneeL.current.rotation.x = pose.kneeL;
    if (footR.current) footR.current.rotation.x = pose.footR;
    if (footL.current) footL.current.rotation.x = pose.footL;
    if (shoulderR.current) shoulderR.current.rotation.set(pose.shoulderR, 0, 0.09 + 0.04 * a.op);
    if (shoulderL.current) shoulderL.current.rotation.set(pose.shoulderL, 0, -0.09 - 0.04 * a.op);
    if (elbowR.current) elbowR.current.rotation.x = pose.elbowR;
    if (elbowL.current) elbowL.current.rotation.x = pose.elbowL;
  });

  const arm = (side: 1 | -1, shoulder: React.RefObject<THREE.Group>, elbow: React.RefObject<THREE.Group>) => (
    <group ref={shoulder} position={[side * 0.262, 0.45, 0]}>
      <mesh geometry={geo.joint} material={mats.jacket} castShadow />
      <mesh geometry={geo.upperArm} material={mats.jacket} castShadow />
      <mesh geometry={geo.box} material={mats.teal} scale={[0.02, 0.2, 0.06]} position={[side * 0.052, -0.13, 0]} />
      <group ref={elbow} position={[0, -0.28, 0]}>
        <mesh geometry={geo.forearm} material={mats.jacket} castShadow />
        <mesh geometry={geo.cuff} material={mats.teal} position={[0, -0.21, 0]} />
        <mesh geometry={geo.hand} material={mats.skin} position={[0, -0.3, 0.005]} castShadow />
      </group>
    </group>
  );

  const leg = (side: 1 | -1, hip: React.RefObject<THREE.Group>, knee: React.RefObject<THREE.Group>, foot: React.RefObject<THREE.Group>) => (
    <group ref={hip} position={[side * 0.095, -0.02, 0]}>
      <mesh geometry={geo.thigh} material={mats.pants} castShadow />
      <mesh geometry={geo.box} material={mats.strap} scale={[0.05, 0.1, 0.05]} position={[side * 0.08, -0.22, 0]} />
      <group ref={knee} position={[0, -0.42, 0]}>
        <mesh geometry={geo.shin} material={mats.pants} castShadow />
        <group ref={foot} position={[0, -0.42, 0]}>
          <mesh geometry={geo.shoe} material={mats.shoe} position={[0, -0.022, -0.05]} castShadow />
          <mesh geometry={geo.soleGeo} material={mats.sole} position={[0, -0.058, -0.05]} />
        </group>
      </group>
    </group>
  );

  return (
    <group ref={root}>
      <group ref={pelvis} position={[0, 0.93, 0]}>
        <mesh geometry={geo.pelvis} material={mats.pants} castShadow />
        {leg(1, hipR, kneeR, footR)}
        {leg(-1, hipL, kneeL, footL)}
        <group ref={torso} position={[0, 0.06, 0]}>
          <mesh geometry={geo.torso} material={mats.jacket} castShadow />
          {/* 两侧青绿色拼块与下摆 */}
          <mesh geometry={geo.box} material={mats.teal} scale={[0.03, 0.34, 0.2]} position={[0.2, 0.22, 0]} rotation={[0, 0, 0.1]} />
          <mesh geometry={geo.box} material={mats.teal} scale={[0.03, 0.34, 0.2]} position={[-0.2, 0.22, 0]} rotation={[0, 0, -0.1]} />
          <mesh geometry={geo.box} material={mats.jacketShade} scale={[0.36, 0.06, 0.27]} position={[0, 0.02, 0]} />
          <mesh geometry={geo.box} material={mats.collar} scale={[0.2, 0.06, 0.2]} position={[0, 0.53, -0.005]} />
          <mesh geometry={geo.box} material={mats.teal} scale={[0.012, 0.42, 0.012]} position={[0, 0.27, -0.128]} />
          {/* 背部标识：人物默认朝 -Z，背面在 +Z */}
          <mesh material={mats.logo} position={[0, 0.34, 0.131]}>
            <planeGeometry args={[0.24, 0.075]} />
          </mesh>
          <mesh geometry={geo.box} material={mats.strap} scale={[0.07, 0.05, 0.03]} position={[-0.2, 0.36, -0.06]} />
          {arm(1, shoulderR, elbowR)}
          {arm(-1, shoulderL, elbowL)}
          <mesh geometry={geo.neck} material={mats.skin} position={[0, 0.57, 0]} />
          <group ref={head} position={[0, 0.555, 0]}>
            <mesh geometry={geo.head} material={mats.skin} position={[0, 0.085, 0]} scale={[0.95, 1.08, 1]} castShadow />
            <mesh geometry={geo.ear} material={mats.skin} position={[0.11, 0.085, 0.01]} />
            <mesh geometry={geo.ear} material={mats.skin} position={[-0.11, 0.085, 0.01]} />
            <mesh geometry={geo.hairCap} material={mats.hair} position={[0, 0.098, 0.014]} rotation={[0.28, 0, 0]} scale={[1, 0.95, 1.05]} castShadow />
            {HAIR_LOCKS.map(([x, y, z, rx, rz], index) => (
              <mesh key={index} geometry={geo.hairSpike} material={mats.hair} position={[x, y, z]} rotation={[rx, 0, rz]} />
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
