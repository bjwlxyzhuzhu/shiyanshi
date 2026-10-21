import * as THREE from 'three';
import { concreteTexture } from './textures';

/**
 * 共享材质：整个世界生命周期内只创建一次，组件卸载时不单独释放，
 * 避免一个实例卸载误释放其他实例仍在使用的材质。
 */
let made: ReturnType<typeof build> | null = null;

function std(color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function glow(color: string, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#0a0f14', emissive: color, emissiveIntensity: intensity, roughness: 0.6 });
}

function build() {
  const wallMap = concreteTexture('#c4ccd0', 11);
  wallMap.repeat.set(3, 1);
  const floorMap = concreteTexture('#8e99a2', 23);
  return {
    concrete: std('#d3d9dc', 0.92, 0, { map: wallMap }),
    concreteDark: std('#9aa4aa', 0.9),
    floor: std('#ffffff', 0.62, 0.02, { map: floorMap }),
    floorCorridor: std('#a8b2b9', 0.55, 0.02, { map: floorMap }),
    floorSeam: std('#4a555e', 0.8),
    ceiling: std('#2a343e', 0.95),
    pillar: std('#36424d', 0.55, 0.25),
    graphite: std('#2a343d', 0.55, 0.35),
    graphiteLight: std('#3a4651', 0.5, 0.3),
    metal: std('#7b8790', 0.35, 0.7),
    steel: std('#b6c0c6', 0.32, 0.65),
    black: std('#12181e', 0.5, 0.2),
    desktop: std('#e5e8ea', 0.45),
    deskBody: std('#59646d', 0.6, 0.2),
    screenFrame: std('#151c22', 0.4, 0.4),
    glass: new THREE.MeshPhysicalMaterial({ color: '#9cc6da', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false }),
    glassOpaque: std('#55707e', 0.3, 0.1),
    amber: glow('#F4B740', 2.2),
    amberSoft: glow('#F4B740', 0.9),
    cyan: glow('#67D2E3', 1.6),
    cyanSoft: glow('#67D2E3', 0.6),
    green: glow('#69CC9E', 1.6),
    red: glow('#F17872', 2.2),
    neutralLed: glow('#7fa2b2', 0.7),
    ledOff: std('#27313a', 0.6),
    lightPanel: glow('#f3f6ff', 2.4),
    lightWarm: glow('#ffe2b0', 2.0),
    plant: std('#3f6a4a', 0.8),
    plantDark: std('#2d4f37', 0.85),
    soil: std('#2b2622', 1),
    rubber: std('#1c2127', 0.9),
    fireRed: std('#b8322c', 0.45, 0.2),
    warning: std('#e3b23c', 0.5),
    hazardStripe: std('#16191d', 0.7)
  };
}

export function materials() {
  made ??= build();
  return made;
}

export type Materials = ReturnType<typeof materials>;
