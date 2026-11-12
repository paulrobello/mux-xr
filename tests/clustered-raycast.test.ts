import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { clusteredRaycast } from '../src/xr/clustered-raycast';
import { createTerminalFrameGeometry } from '../src/xr/terminal-warp';

function frames(radians: number) {
  const geometry = createTerminalFrameGeometry(
    { width: 1.2, height: 0.7, radians },
    { chin: true },
  );
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const plain = new THREE.Mesh(geometry, material);
  const clustered = new THREE.Mesh(geometry, material);
  clustered.raycast = clusteredRaycast;
  for (const mesh of [plain, clustered]) {
    mesh.position.set(0.2, 1.4, -1.1);
    mesh.rotation.set(0.1, -0.3, 0.02);
    mesh.scale.setScalar(1.3);
    mesh.updateMatrixWorld(true);
  }
  return { plain, clustered, geometry };
}

const summary = (hits: THREE.Intersection[]) =>
  hits.map((hit) => [hit.faceIndex, hit.distance.toFixed(9), hit.uv?.x.toFixed(9)]);

describe('clustered raycast', () => {
  it.each([0, 0.6])('returns exactly the default hits on a frame curved %s rad', (radians) => {
    const { plain, clustered, geometry } = frames(radians);
    expect((geometry.index?.count ?? 0) / 3).toBeGreaterThan(500);
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3(0.2, 1.4, 0.4);
    let hitRays = 0;
    for (let x = -0.9; x <= 0.9; x += 0.03)
      for (let y = -0.6; y <= 0.6; y += 0.03) {
        const target = new THREE.Vector3(0.2 + x, 1.4 + y, -1.1);
        raycaster.set(origin, target.sub(origin).normalize());
        const expected = raycaster.intersectObject(plain);
        const actual = raycaster.intersectObject(clustered);
        expect(summary(actual)).toEqual(summary(expected));
        if (expected.length > 0) hitRays++;
      }
    expect(hitRays).toBeGreaterThan(50);
    expect(geometry.drawRange.start).toBe(0);
    expect(geometry.drawRange.count).toBe(Number.POSITIVE_INFINITY);
  });
});
