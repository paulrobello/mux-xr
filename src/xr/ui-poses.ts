import * as THREE from 'three';

export type UIPoseName = 'keyboard' | 'hud';

export interface SavedUIPose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

const STORAGE_KEY = 'mux-xr:ui-poses:v2';
const LEGACY_STORAGE_KEY = 'mux-xr:ui-poses:v1';
const VERSION = 2;

/** Height of the standing head that desktop layout and legacy v1 poses are measured from. */
export const NOMINAL_VIEWER_HEIGHT = 1.52;

interface PoseDocument {
  version: 2;
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

/**
 * v1 poses were stored relative to the head's position and heading at save time. They are
 * resolved once against the nominal standing head, which faces -Z from the floor origin.
 */
export function legacyPoseToWorld(pose: SavedUIPose): SavedUIPose {
  const world = copyPose(pose);
  world.position[1] += NOMINAL_VIEWER_HEIGHT;
  return world;
}

function readDocument(storage: Storage): PoseDocument {
  try {
    const current = storage.getItem(STORAGE_KEY);
    const raw = current ?? storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { version: VERSION, poses: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { version: VERSION, poses: {} };
    const document = parsed as { version?: unknown; poses?: Record<string, unknown> | null };
    if (
      document.version !== (current ? VERSION : 1) ||
      typeof document.poses !== 'object' ||
      document.poses === null
    ) {
      return { version: VERSION, poses: {} };
    }
    const poses: Partial<Record<UIPoseName, SavedUIPose>> = {};
    for (const name of ['keyboard', 'hud'] as const) {
      const pose = document.poses[name];
      if (validPose(pose)) poses[name] = current ? copyPose(pose) : legacyPoseToWorld(pose);
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
        storage.removeItem(LEGACY_STORAGE_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Saved poses are world (reference-space) transforms, so they stay put relative to the room. */
export function captureUIPose(root: THREE.Object3D): SavedUIPose {
  const position = root.getWorldPosition(new THREE.Vector3());
  const quaternion = root.getWorldQuaternion(new THREE.Quaternion()).normalize();
  const scale = root.getWorldScale(new THREE.Vector3());
  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: Math.cbrt(scale.x * scale.y * scale.z),
  };
}

export function applyUIPose(
  root: THREE.Object3D,
  pose: SavedUIPose,
  limits: [number, number],
  maxDistance = 20,
): void {
  if (!validPose(pose, maxDistance)) return;
  const [low, high] = limits;
  const minimum = Number.isFinite(low) ? Math.min(low, high) : 0.2;
  const maximum = Number.isFinite(high) ? Math.max(low, high) : 3;
  const worldScale = Math.max(minimum, Math.min(maximum, pose.scale));
  const worldMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...pose.position),
    new THREE.Quaternion(...pose.quaternion),
    new THREE.Vector3(worldScale, worldScale, worldScale),
  );
  if (root.parent) worldMatrix.premultiply(root.parent.matrixWorld.clone().invert());
  worldMatrix.decompose(root.position, root.quaternion, root.scale);
}
