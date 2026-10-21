import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

export type CellState = 'neutral' | 'flagged' | 'correct' | 'wrong';

export interface SandboxItem {
  label: string;
  state: CellState;
}

const COLORS: Record<CellState, string> = {
  neutral: '#9fb3c8',
  flagged: '#e3a008',
  correct: '#17865f',
  wrong: '#c23b3b'
};

function Cell({ item, index, total }: { item: SandboxItem; index: number; total: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const columns = Math.min(4, total);
  const x = (index % columns - (columns - 1) / 2) * 0.9;
  const z = (Math.floor(index / columns) - 0.5) * 0.9;
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const lift = item.state === 'flagged' || item.state === 'wrong' ? 0.12 : 0;
    ref.current.position.y = 0.45 + lift + Math.sin(clock.getElapsedTime() * 1.5 + index) * 0.03;
    ref.current.rotation.y += 0.004;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={ref} castShadow>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color={COLORS[item.state]} roughness={0.35} metalness={0.1} />
      </mesh>
      <Html position={[0, 1, 0]} center distanceFactor={4}>
        <span className="scene-label" title={item.label}>{index + 1}</span>
      </Html>
    </group>
  );
}

export function SandboxScene({ items, caption }: { items: SandboxItem[]; caption: string }) {
  return (
    <div className="scene-wrap">
      <Canvas shadows camera={{ position: [0, 3.2, 4.2], fov: 40 }} dpr={[1, 2]}>
        <color attach="background" args={['#e7ebf0']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 5, 3]} intensity={1.1} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color="#d5dbe2" />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <boxGeometry args={[3.9, 1.4, 2.2]} />
          <meshPhysicalMaterial color="#bcd6ff" transparent opacity={0.16} roughness={0.05} metalness={0} depthWrite={false} />
        </mesh>
        <lineSegments position={[0, 0.7, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(3.9, 1.4, 2.2)]} />
          <lineBasicMaterial color="#1f5f8b" />
        </lineSegments>
        {items.map((item, index) => (
          <Cell key={item.label} item={item} index={index} total={items.length} />
        ))}
        <OrbitControls enablePan={false} minDistance={3} maxDistance={8} target={[0, 0.5, 0]} maxPolarAngle={Math.PI / 2.1} />
      </Canvas>
      <span className="scene-caption">{caption}</span>
    </div>
  );
}
