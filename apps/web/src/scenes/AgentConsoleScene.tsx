import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

const LEVEL_COLOR: Record<string, string> = {
  禁止: '#8c939f',
  只读: '#1f5f8b',
  需人工确认: '#e3a008',
  自动允许: '#c23b3b'
};

export interface AgentTool {
  name: string;
  level: string;
}

export interface AttackHop {
  tool: string;
  outcome: string;
}

function Link({ to, color, dashed }: { to: THREE.Vector3; color: string; dashed: boolean }) {
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.6, 0), to]), [to]);
  const line = useMemo(() => {
    const material = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.1 })
      : new THREE.LineBasicMaterial({ color });
    const object = new THREE.Line(geometry, material);
    object.computeLineDistances();
    return object;
  }, [geometry, color, dashed]);
  return <primitive object={line} />;
}

function Packet({ to, blocked }: { to: THREE.Vector3; blocked: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const from = useMemo(() => new THREE.Vector3(0, 0.6, 0), []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.getElapsedTime() * 0.6) % 1;
    const reach = blocked ? Math.min(t, 0.55) : t;
    ref.current.position.lerpVectors(from, to, reach);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.07, 16, 16]} />
      <meshStandardMaterial color={blocked ? '#8c939f' : '#ff3b2f'} emissive={blocked ? '#000000' : '#ff3b2f'} emissiveIntensity={1.2} />
    </mesh>
  );
}

export function AgentConsoleScene({ tools, attack, caption }: { tools: AgentTool[]; attack: AttackHop[] | null; caption: string }) {
  const positions = tools.map((_, index) => {
    const angle = (index / tools.length) * Math.PI * 2 - Math.PI / 2;
    return new THREE.Vector3(Math.cos(angle) * 1.9, 0.45, Math.sin(angle) * 1.4);
  });

  return (
    <div className="scene-wrap">
      <Canvas camera={{ position: [0, 4.3, 4.6], fov: 44 }} dpr={[1, 2]}>
        <color attach="background" args={['#e7ebf0']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[2, 5, 3]} intensity={1} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[3, 64]} />
          <meshStandardMaterial color="#d5dbe2" />
        </mesh>

        <mesh position={[0, 0.6, 0]}>
          <icosahedronGeometry args={[0.38, 1]} />
          <meshStandardMaterial color="#1b2230" metalness={0.3} roughness={0.3} />
        </mesh>
        <Html position={[0, 1.2, 0]} center distanceFactor={4}>
          <span className="scene-label">智能体</span>
        </Html>

        {tools.map((tool, index) => {
          const position = positions[index]!;
          const color = LEVEL_COLOR[tool.level] ?? '#8c939f';
          const hop = attack?.find((item) => item.tool === tool.name);
          return (
            <group key={tool.name}>
              <Link to={position} color={color} dashed={tool.level === '禁止'} />
              <mesh position={position}>
                <boxGeometry args={[0.36, 0.36, 0.36]} />
                <meshStandardMaterial color={color} />
              </mesh>
              <Html position={[position.x, position.y + 0.45, position.z]} center distanceFactor={4}>
                <span className="scene-label">{tool.name} · {tool.level}</span>
              </Html>
              {hop ? <Packet to={position} blocked={hop.outcome !== '执行'} /> : null}
            </group>
          );
        })}
        <OrbitControls enablePan={false} minDistance={3} maxDistance={8} target={[0, 0.4, 0]} maxPolarAngle={Math.PI / 2.2} />
      </Canvas>
      <span className="scene-caption">{caption}</span>
    </div>
  );
}
