import * as THREE from 'three';
import { createCurvedTerminalGeometry, terminalWarpPoint } from './terminal-warp';

export function curveKeyboardContent(root: THREE.Group, width: number, radians: number): void {
  for (const child of root.children) {
    if (child.name === 'input-backdrop') continue;
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
    mesh.geometry.dispose();
    mesh.geometry = createCurvedTerminalGeometry({
      width: keyWidth,
      height: keyHeight,
      radians: (radians * keyWidth) / width,
      segments: Math.max(2, Math.ceil((keyWidth / width) * 48)),
    });
  }
  root.userData.keyboardCurvature = THREE.MathUtils.radToDeg(radians);
}
