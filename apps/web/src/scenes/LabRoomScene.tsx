import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

export interface LabRoomProps {
  /** 已上电的机柜数量 0–4 */
  racksOn: number;
  /** 机柜热负荷 0–1，0 为常温，1 为过温 */
  heat: number;
  alarm: boolean;
  caption: string;
}

function heatColor(heat: number): THREE.Color {
  return new THREE.Color('#2fbf71').lerp(new THREE.Color('#ff3b2f'), Math.min(1, Math.max(0, heat)));
}

function Rack({ x, on, heat }: { x: number; on: boolean; heat: number }) {
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!led.current) return;
    const pulse = on ? 0.8 + Math.sin(clock.getElapsedTime() * (2 + heat * 6) + x) * 0.3 : 0;
    led.current.emissiveIntensity = pulse * (0.6 + heat);
  });
  const color = on ? heatColor(heat) : new THREE.Color('#5b6270');
  return (
    <group position={[x, 0, -0.6]}>
      <mesh position={[0, 1, 0]} castShadow>
        <boxGeometry args={[0.6, 2, 0.9]} />
        <meshStandardMaterial color="#2a303b" metalness={0.5} roughness={0.5} />
      </mesh>
      {[0.4, 0.75, 1.1, 1.45, 1.8].map((y) => (
        <mesh key={y} position={[0, y, 0.452]}>
          <boxGeometry args={[0.5, 0.05, 0.01]} />
          <meshStandardMaterial ref={y === 1.1 ? led : undefined} color={color} emissive={color} emissiveIntensity={on ? 0.7 : 0} />
        </mesh>
      ))}
    </group>
  );
}

function Beacon({ active }: { active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 4;
  });
  return (
    <group position={[2.25, 2.55, -0.9]}>
      <mesh ref={ref}>
        <cylinderGeometry args={[0.1, 0.12, 0.16, 16]} />
        <meshStandardMaterial color={active ? '#ff3b2f' : '#8c939f'} emissive={active ? '#ff3b2f' : '#000000'} emissiveIntensity={active ? 1.4 : 0} />
      </mesh>
      {active ? <pointLight color="#ff3b2f" intensity={2.2} distance={4} /> : null}
    </group>
  );
}

export function LabRoomScene({ racksOn, heat, alarm, caption }: LabRoomProps) {
  return (
    <div className="scene-wrap">
      <Canvas shadows camera={{ position: [3.6, 2.6, 4.2], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={['#e7ebf0']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow />

        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[7, 5]} />
          <meshStandardMaterial color="#cfd5dc" />
        </mesh>
        <mesh position={[0, 1.5, -1.25]}>
          <planeGeometry args={[7, 3]} />
          <meshStandardMaterial color="#f3f4f6" />
        </mesh>

        <group position={[-2.4, 0, -0.75]}>
          <mesh position={[0, 0.9, 0]}>
            <boxGeometry args={[0.7, 1.8, 0.4]} />
            <meshStandardMaterial color="#9aa5b1" metalness={0.3} roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.55, 0.21]}>
            <circleGeometry args={[0.05, 16]} />
            <meshStandardMaterial color={racksOn > 0 ? '#2fbf71' : '#c23b3b'} emissive={racksOn > 0 ? '#2fbf71' : '#c23b3b'} emissiveIntensity={0.9} />
          </mesh>
          <Html position={[0, 1.95, 0]} center distanceFactor={4}>
            <span className="scene-label">配电柜</span>
          </Html>
        </group>

        <group position={[-1.5, 0, -0.75]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.5, 0.9, 0.5]} />
            <meshStandardMaterial color="#3d4552" />
          </mesh>
          <Html position={[0, 1.1, 0]} center distanceFactor={4}>
            <span className="scene-label">UPS</span>
          </Html>
        </group>

        {[-0.6, 0.15, 0.9, 1.65].map((x, index) => (
          <Rack key={x} x={x} on={index < racksOn} heat={heat} />
        ))}
        <Html position={[0.5, 2.3, -0.6]} center distanceFactor={4}>
          <span className="scene-label">GPU 机柜</span>
        </Html>

        <mesh position={[0.5, 2.75, -1.1]}>
          <boxGeometry args={[1.4, 0.3, 0.3]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>

        <group position={[2.6, 0, 0.6]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.6, 16]} />
            <meshStandardMaterial color="#d63a2f" />
          </mesh>
          <Html position={[0, 0.8, 0]} center distanceFactor={4}>
            <span className="scene-label">CO₂ 灭火器</span>
          </Html>
        </group>

        <Beacon active={alarm} />
        <OrbitControls enablePan={false} minDistance={3} maxDistance={9} target={[0, 1, -0.4]} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      <span className="scene-caption">{caption}</span>
    </div>
  );
}
