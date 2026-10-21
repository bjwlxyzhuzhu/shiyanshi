import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 静态合批：把子树中静态网格按材质合并为一个网格，减少绘制调用。
 * 原网格保留在场景图中但隐藏；version 变化（例如设备状态切换材质）时重新合并。
 * 动态部件（风扇、告警灯、全息路径等）不要放进这个包装。
 */
export function StaticMerge({ children, version = '' }: { children: React.ReactNode; version?: string }) {
  const group = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    const root = group.current;
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
    const sources: THREE.Mesh[] = [];

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object.userData.merged) return;
      if (Array.isArray(object.material)) return;
      const local = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
      let geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
      }
      if (!geometry.attributes.uv) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position!.count * 2), 2));
      }
      geometry = geometry.applyMatrix4(local);
      const bucket = buckets.get(object.material) ?? { geometries: [], cast: false, receive: false };
      bucket.geometries.push(geometry);
      bucket.cast ||= object.castShadow;
      bucket.receive ||= object.receiveShadow;
      buckets.set(object.material, bucket);
      sources.push(object);
    });

    const merged: THREE.Mesh[] = [];
    for (const [material, bucket] of buckets) {
      const geometry = bucket.geometries.length === 1 ? bucket.geometries[0]! : mergeGeometries(bucket.geometries, false);
      if (bucket.geometries.length > 1) bucket.geometries.forEach((item) => item.dispose());
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = bucket.cast;
      mesh.receiveShadow = bucket.receive;
      mesh.userData.merged = true;
      root.add(mesh);
      merged.push(mesh);
    }
    sources.forEach((mesh) => {
      mesh.visible = false;
    });

    return () => {
      merged.forEach((mesh) => {
        root.remove(mesh);
        mesh.geometry.dispose();
      });
      sources.forEach((mesh) => {
        mesh.visible = true;
      });
    };
  }, [version]);

  return <group ref={group}>{children}</group>;
}
