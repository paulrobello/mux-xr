import * as THREE from 'three';
import type { BackgroundMode } from '../contracts';
import { HANGAR_DECK_PANE_SAFE_RADIUS } from './environments/hangar-deck';
import { measurePanelBounds } from './panel-bounds';

const BACKGROUND_FLOOR_Y: Partial<Record<BackgroundMode, number>> = {
  observatory: 0.035,
  hangar: 0.035,
  'deep-water': 0.035,
  studio: 0.035,
  desert: 0.035,
  aurora: 0.035,
  rooftop: 0.035,
  summit: 0.035,
  koi: 0.035,
};
const PANEL_FLOOR_CLEARANCE = 0.06;

/** Environments whose walls end panes' usable space; others are unbounded. */
const BACKGROUND_PANE_SAFE_RADIUS: Partial<Record<BackgroundMode, number>> = {
  hangar: HANGAR_DECK_PANE_SAFE_RADIUS,
};

export function workspacePaneSafeRadius(
  background: BackgroundMode,
  xrMode: 'desktop' | 'vr' | 'ar',
): number | null {
  if (xrMode === 'ar') return null;
  return BACKGROUND_PANE_SAFE_RADIUS[background] ?? null;
}

/** Pulls each root's bounds center horizontally inside `radius` of the origin. */
export function keepLayoutInsideRadius(
  roots: readonly THREE.Group[],
  radius: number | null,
): boolean {
  if (radius === null) return false;
  let moved = false;
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) continue;
    const center = box.getCenter(new THREE.Vector3());
    const distance = Math.hypot(center.x, center.z);
    if (distance <= radius) continue;
    const scale = radius / distance - 1;
    const world = root.getWorldPosition(new THREE.Vector3());
    world.x += center.x * scale;
    world.z += center.z * scale;
    if (root.parent) root.parent.worldToLocal(world);
    root.position.copy(world);
    root.updateWorldMatrix(true, true);
    moved = true;
  }
  return moved;
}

export function workspaceFloorY(
  background: BackgroundMode,
  xrMode: 'desktop' | 'vr' | 'ar',
): number | null {
  if (xrMode === 'ar') return 0;
  return BACKGROUND_FLOOR_Y[background] ?? null;
}

function faceRootTowardEye(root: THREE.Group, eye: THREE.Vector3): void {
  const measured = measurePanelBounds(root);
  const center = measured.center.applyMatrix4(root.matrixWorld);
  const front = eye.clone().sub(center);
  if (front.lengthSq() < 1e-12) return;
  front.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  up.addScaledVector(front, -up.dot(front));
  if (up.lengthSq() < 1e-12) up.set(0, 0, 1).addScaledVector(front, -front.z);
  up.normalize();
  const right = up.clone().cross(front).normalize();
  const desiredWorld = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, front),
  );
  if (root.parent) {
    root.parent.updateWorldMatrix(true, false);
    const parentWorld = root.parent.getWorldQuaternion(new THREE.Quaternion());
    root.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
  } else {
    root.quaternion.copy(desiredWorld);
  }
}

export function keepLayoutAboveFloor(
  roots: readonly THREE.Group[],
  floorY: number | null,
  eye: THREE.Vector3,
): number {
  if (floorY === null || roots.length === 0) return 0;
  for (const root of roots) root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().makeEmpty();
  for (const root of roots) bounds.union(new THREE.Box3().setFromObject(root));
  if (bounds.isEmpty()) return 0;
  const offset = Math.max(0, floorY + PANEL_FLOOR_CLEARANCE - bounds.min.y);
  if (offset === 0) return 0;
  const worldDelta = new THREE.Vector3(0, offset, 0);
  const translateRoots = (delta: THREE.Vector3): void => {
    for (const root of roots) {
      const worldPosition = root.getWorldPosition(new THREE.Vector3()).add(delta);
      if (root.parent) root.parent.worldToLocal(worldPosition);
      root.position.copy(worldPosition);
    }
  };
  translateRoots(worldDelta);
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    faceRootTowardEye(root, eye);
  }
  const refacedBounds = new THREE.Box3().makeEmpty();
  for (const root of roots) refacedBounds.union(new THREE.Box3().setFromObject(root));
  const settlingOffset = Math.max(0, floorY + PANEL_FLOOR_CLEARANCE - refacedBounds.min.y);
  if (settlingOffset > 0) translateRoots(new THREE.Vector3(0, settlingOffset, 0));
  return offset + settlingOffset;
}
