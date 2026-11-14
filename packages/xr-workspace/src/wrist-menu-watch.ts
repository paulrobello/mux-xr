import * as THREE from 'three';
import type { HandContactProbe } from './hand-contact';
import { updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';

/** Surface gap at which a near hand stops counting as near. */
export const WRIST_WATCH_NEAR_EXIT_GAP = 0.055;
/** Distance from the watch origin to its farthest touch surface, the band. */
export const WRIST_WATCH_EXTENT = 0.06;
// A palm at least this far from the watch origin cannot bring any probe within the near-exit
// gap, provided every probe (with its radius) stays within 0.185 m of the palm.
export const WRIST_WATCH_PROBE_REACH = 0.3;

export interface WristMenuWatch {
  root: THREE.Group;
  update(wrist: THREE.Vector3, forward: THREE.Vector3, backNormal: THREE.Vector3): void;
  updateTime(nowMs: number): void;
  setUpdateAvailable(available: boolean): void;
  setVisible(visible: boolean): void;
  updateTouch(probes: readonly HandContactProbe[] | null): boolean;
  /** Records a hand too far from the watch to touch it, without sampling its probes. */
  touchOutOfReach(): void;
  readonly near: boolean;
  dispose(): void;
}

export function createWristMenuWatch(
  button: THREE.Mesh,
  envMap: THREE.Texture | null = null,
): WristMenuWatch {
  const root = new THREE.Group();
  root.name = 'xr-wrist-menu-watch';
  root.visible = false;
  const caseGeometry = new THREE.BoxGeometry(0.06, 0.044, 0.012);
  const caseMaterial = applyUIEnvironment(
    new THREE.MeshStandardMaterial({ color: 0x0b1725, roughness: 0.7, metalness: 0.3 }),
    envMap,
  );
  const watchCase = new THREE.Mesh(caseGeometry, caseMaterial);
  watchCase.name = 'xr-wrist-menu-watch-case';
  watchCase.raycast = () => undefined;
  const strapGeometry = new THREE.TorusGeometry(0.022, 0.005, 8, 20);
  const strapMaterial = applyUIEnvironment(
    new THREE.MeshStandardMaterial({ color: 0x17293a, roughness: 0.85, metalness: 0.1 }),
    envMap,
  );
  const strap = new THREE.Mesh(strapGeometry, strapMaterial);
  strap.rotation.x = Math.PI / 2;
  strap.name = 'xr-wrist-menu-watch-strap';
  strap.raycast = () => undefined;
  const updateIndicatorGeometry = new THREE.CircleGeometry(0.003, 16);
  const updateIndicatorMaterial = new THREE.MeshBasicMaterial({ color: 0x35d7ff });
  const updateIndicator = new THREE.Mesh(updateIndicatorGeometry, updateIndicatorMaterial);
  updateIndicator.name = 'xr-wrist-menu-update-indicator';
  updateIndicator.position.set(0.023, 0.016, 0.016);
  updateIndicator.userData.inputAction = 'wristMenu';
  updateIndicator.userData.helpText = 'Update available. Open menu to reload.';
  updateIndicator.visible = false;
  button.userData.inputAction = 'wristMenu';
  button.position.z = 0.009;
  root.add(strap, watchCase, button, updateIndicator);

  const basis = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const localProbe = new THREE.Vector3();
  const inverseRoot = new THREE.Matrix4();
  let near = false;
  let armed = false;
  let disposed = false;
  const date = new Date();
  let lastMinute = Number.NaN;

  const updateTime = (nowMs: number): void => {
    if (disposed || !Number.isFinite(nowMs)) return;
    const minute = Math.floor(nowMs / 60000);
    if (minute === lastMinute) return;
    lastMinute = minute;
    date.setTime(nowMs);
    const hours = date.getHours();
    const hour = hours % 12 || 12;
    const suffix = hours >= 12 ? 'PM' : 'AM';
    updateScalableLabel(button, `${hour}:${String(date.getMinutes()).padStart(2, '0')}\n${suffix}`);
  };
  const setUpdateAvailable = (available: boolean): void => {
    if (disposed) return;
    updateIndicator.visible = available;
  };

  const update = (
    wrist: THREE.Vector3,
    forward: THREE.Vector3,
    backNormal: THREE.Vector3,
  ): void => {
    if (disposed) return;
    up.copy(forward);
    normal.copy(backNormal);
    if (up.lengthSq() < 1e-8 || normal.lengthSq() < 1e-8) return;
    up.normalize();
    normal.normalize();
    right.crossVectors(up, normal);
    if (right.lengthSq() < 1e-8) return;
    right.normalize();
    normal.crossVectors(right, up).normalize();
    basis.makeBasis(right, up, normal);
    rotation.setFromRotationMatrix(basis);
    root.position.copy(wrist).addScaledVector(up, 0.012).addScaledVector(normal, 0.03);
    root.quaternion.copy(rotation);
    strap.position.set(0, -0.012, -0.03);
  };
  const setVisible = (visible: boolean): void => {
    root.visible = visible;
    if (!visible) {
      near = false;
      armed = false;
    }
  };
  const updateTouch = (probes: readonly HandContactProbe[] | null): boolean => {
    if (disposed || !root.visible || !probes || probes.length === 0) {
      near = false;
      armed = false;
      return false;
    }
    root.updateMatrixWorld(true);
    inverseRoot.copy(root.matrixWorld).invert();
    const halfX = 0.03;
    const halfY = 0.022;
    const halfZ = 0.006;
    let nearestSurfaceGap = Number.POSITIVE_INFINITY;
    for (const probe of probes) {
      if (!Number.isFinite(probe.radius) || probe.radius < 0) continue;
      localProbe.copy(probe.point).applyMatrix4(inverseRoot);
      const dx = Math.max(Math.abs(localProbe.x) - halfX, 0);
      const dy = Math.max(Math.abs(localProbe.y) - halfY, 0);
      const dz = Math.max(Math.abs(localProbe.z) - halfZ, 0);
      const caseDistance = Math.hypot(dx, dy, dz);
      const bandRadius = Math.hypot(
        localProbe.x - strap.position.x,
        localProbe.z - strap.position.z,
      );
      const bandDistance = Math.hypot(bandRadius - 0.022, localProbe.y - strap.position.y) - 0.005;
      nearestSurfaceGap = Math.min(
        nearestSurfaceGap,
        caseDistance - probe.radius,
        bandDistance - probe.radius,
      );
    }
    near = nearestSurfaceGap <= (near ? WRIST_WATCH_NEAR_EXIT_GAP : 0.045);
    if (nearestSurfaceGap >= 0.025) armed = true;
    if (!armed || nearestSurfaceGap > 0.004) return false;
    armed = false;
    return true;
  };
  // A hand too far to touch: the gap state updateTouch would reach from probes beyond 25 mm.
  const touchOutOfReach = (): void => {
    near = false;
    armed = !disposed && root.visible;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    near = false;
    root.visible = false;
    root.removeFromParent();
    root.remove(button);
    root.remove(watchCase, strap, updateIndicator);
    caseGeometry.dispose();
    caseMaterial.dispose();
    strapGeometry.dispose();
    strapMaterial.dispose();
    updateIndicatorGeometry.dispose();
    updateIndicatorMaterial.dispose();
    root.clear();
  };
  return {
    root,
    update,
    updateTime,
    setUpdateAvailable,
    setVisible,
    updateTouch,
    touchOutOfReach,
    get near() {
      return near;
    },
    dispose,
  };
}
