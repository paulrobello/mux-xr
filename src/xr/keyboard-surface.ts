import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCurvedTerminalGeometry, terminalWarpPoint } from './terminal-warp';

export function curveKeyboardContent(root: THREE.Group, width: number, radians: number): void {
  for (const child of root.children) {
    // The Keyborb shell and glyph batches follow their orbs, so they take no warp of their own.
    if (['input-backdrop', 'keyborb-shells', 'keyborb-glyphs'].includes(child.name)) continue;
    const point = terminalWarpPoint(child.position.x, { width, height: 1, radians });
    const theta = Math.atan2(-point.normalX, point.normalZ);
    child.position.x = point.x;
    child.position.z += point.z;
    child.rotateY(-theta);
    child.renderOrder = 10;
    child.traverse((descendant) => {
      if (descendant !== child) descendant.renderOrder = 11;
    });
    if (child.userData.keyborb) continue;
    const mesh = child as THREE.Mesh;
    const keyWidth = Number(child.userData.labelWidth);
    const keyHeight = Number(child.userData.labelHeight);
    if (!mesh.geometry || !Number.isFinite(keyWidth) || !Number.isFinite(keyHeight)) continue;
    const keyRadians = (radians * keyWidth) / width;
    const segments = Math.max(2, Math.ceil((keyWidth / width) * 48));
    mesh.geometry.dispose();
    mesh.geometry = createCurvedTerminalGeometry({
      width: keyWidth,
      height: keyHeight,
      radians: keyRadians,
      segments,
    });
    child.userData.faceRadians = keyRadians;
    child.userData.faceSegments = segments;
  }
  root.userData.keyboardCurvature = THREE.MathUtils.radToDeg(radians);
}

/** Open side walls from `front` to `depth` behind a face bent by `radians`, in face-local space. */
export function createCurvedButtonSides(
  width: number,
  height: number,
  radians: number,
  front: number,
  depth: number,
  segments: number,
): THREE.BufferGeometry {
  const points = Array.from({ length: segments + 1 }, (_, index) =>
    terminalWarpPoint((index / segments - 0.5) * width, { width, height, radians }),
  );
  const positions: number[] = [];
  const quad = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    positions.push(x0, y0, z0 - front, x1, y1, z1 - front, x1, y1, z1 - depth);
    positions.push(x0, y0, z0 - front, x1, y1, z1 - depth, x0, y0, z0 - depth);
  };
  for (const y of [height / 2, -height / 2])
    for (let index = 0; index < segments; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      quad(a.x, y, a.z, b.x, y, b.z);
    }
  for (const end of [points[0], points[segments]])
    quad(end.x, height / 2, end.z, end.x, -height / 2, end.z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One mesh holding the walls of every raised button on a panel, so they cost a single draw.
 * Walls stay at the buttons' rest pose; a pressed face sinks into them.
 */
export function createRaisedButtonWalls(root: THREE.Group, color: number): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const child of root.children) {
    if (!child.userData.raisedButton) continue;
    const width = Number(child.userData.labelWidth);
    const height = Number(child.userData.labelHeight);
    const depth = Number(child.userData.buttonDepth);
    const gap = Number(child.userData.buttonGap) || 0;
    const radians = Number(child.userData.faceRadians) || 0;
    // The bent face's edges sit forward of its center, so curved walls follow the same bend.
    const part = radians
      ? createCurvedButtonSides(
          width,
          height,
          radians,
          gap,
          depth,
          Number(child.userData.faceSegments) || 2,
        )
      : new THREE.BoxGeometry(width, height, depth - gap)
          .translate(0, 0, -(depth + gap) / 2)
          .toNonIndexed();
    part.deleteAttribute('uv');
    child.updateMatrix();
    parts.push(part.applyMatrix4(child.matrix));
  }
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) return null;
  const walls = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  walls.name = 'xr-button-walls';
  walls.raycast = () => undefined;
  return walls;
}
