import * as THREE from 'three';

export type UIPoseName = 'keyboard' | 'hud';

export interface SavedUIPose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

const STORAGE_KEY = 'mux-xr:ui-poses:v1';
const VERSION = 1;

interface PoseDocument {
  version: 1;
  poses: Partial<Record<UIPoseName, SavedUIPose>>;
}

function validPose(value: unknown, maxDistance = 20): value is SavedUIPose {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SavedUIPose>;
  if (!Array.isArray(candidate.position) || candidate.position.length !== 3) return false;
  if (!candidate.position.every((part) => typeof part === 'number' && Number.isFinite(part)))
    return false;
  if (Math.hypot(...candidate.position) > maxDistance) return false;
  if (!Array.isArray(candidate.quaternion) || candidate.quaternion.length !== 4) return false;
  if (!candidate.quaternion.every((part) => typeof part === 'number' && Number.isFinite(part)))
    return false;
  const quaternionLength = Math.hypot(...candidate.quaternion);
  if (quaternionLength < 1e-8 || Math.abs(quaternionLength - 1) > 1e-4) return false;
  return (
    typeof candidate.scale === 'number' &&
    Number.isFinite(candidate.scale) &&
    candidate.scale >= 0.2 &&
    candidate.scale <= 3
  );
}

function copyPose(pose: SavedUIPose): SavedUIPose {
  return {
    position: [...pose.position] as SavedUIPose['position'],
    quaternion: [...pose.quaternion] as SavedUIPose['quaternion'],
    scale: pose.scale,
  };
}

function readDocument(storage: Storage): PoseDocument {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: VERSION, poses: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { version: VERSION, poses: {} };
    const document = parsed as Partial<PoseDocument>;
    if (
      document.version !== VERSION ||
      typeof document.poses !== 'object' ||
      document.poses === null
    ) {
      return { version: VERSION, poses: {} };
    }
    const poses: Partial<Record<UIPoseName, SavedUIPose>> = {};
    for (const name of ['keyboard', 'hud'] as const) {
      if (validPose(document.poses[name])) poses[name] = copyPose(document.poses[name]);
    }
    return { version: VERSION, poses };
  } catch {
    return { version: VERSION, poses: {} };
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createUIPoseStore(storage: Storage | null = defaultStorage()): {
  read(name: UIPoseName): SavedUIPose | null;
  save(name: UIPoseName, pose: SavedUIPose): boolean;
  clear(): boolean;
} {
  return {
    read(name): SavedUIPose | null {
      if (!storage) return null;
      const pose = readDocument(storage).poses[name];
      return pose ? copyPose(pose) : null;
    },
    save(name, pose): boolean {
      if (!storage || !validPose(pose)) return false;
      const document = readDocument(storage);
      document.poses[name] = copyPose(pose);
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(document));
        return true;
      } catch {
        return false;
      }
    },
    clear(): boolean {
      if (!storage) return false;
      try {
        storage.removeItem(STORAGE_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function viewerYaw(viewer: THREE.Object3D): THREE.Quaternion {
  const worldQuaternion = viewer.getWorldQuaternion(new THREE.Quaternion());
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    forward.normalize(),
  );
}

export function captureUIPose(root: THREE.Object3D, viewer: THREE.Object3D): SavedUIPose {
  const viewerPosition = viewer.getWorldPosition(new THREE.Vector3());
  const yaw = viewerYaw(viewer);
  const inverseYaw = yaw.clone().invert();
  const rootPosition = root.getWorldPosition(new THREE.Vector3());
  const rootQuaternion = root.getWorldQuaternion(new THREE.Quaternion());
  const rootScale = root.getWorldScale(new THREE.Vector3());
  const position = rootPosition.sub(viewerPosition).applyQuaternion(inverseYaw);
  const quaternion = inverseYaw.multiply(rootQuaternion).normalize();
  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: Math.cbrt(rootScale.x * rootScale.y * rootScale.z),
  };
}

export function applyUIPose(
  root: THREE.Object3D,
  viewer: THREE.Object3D,
  pose: SavedUIPose,
  limits: [number, number],
  maxDistance = 20,
): void {
  if (!validPose(pose, maxDistance)) return;
  const yaw = viewerYaw(viewer);
  const viewerPosition = viewer.getWorldPosition(new THREE.Vector3());
  const worldPosition = new THREE.Vector3(...pose.position)
    .applyQuaternion(yaw)
    .add(viewerPosition);
  const worldQuaternion = yaw.multiply(new THREE.Quaternion(...pose.quaternion));
  const [low, high] = limits;
  const minimum = Number.isFinite(low) ? Math.min(low, high) : 0.2;
  const maximum = Number.isFinite(high) ? Math.max(low, high) : 3;
  const worldScale = Math.max(minimum, Math.min(maximum, pose.scale));
  const worldMatrix = new THREE.Matrix4().compose(
    worldPosition,
    worldQuaternion,
    new THREE.Vector3(worldScale, worldScale, worldScale),
  );
  if (root.parent) worldMatrix.premultiply(root.parent.matrixWorld.clone().invert());
  worldMatrix.decompose(root.position, root.quaternion, root.scale);
}
