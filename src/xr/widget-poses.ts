import { legacyPoseToWorld, type SavedUIPose } from './ui-poses';
import { type WidgetKey, widgetKeyKind } from './widget-registry';

const STORAGE_KEY = 'mux-xr:widget-poses:v2';
const LEGACY_STORAGE_KEY = 'mux-xr:widget-poses:v1';
const VERSION = 2;

/**
 * A saved widget pose. Pictures also keep their spawn slot (-1 for the Add Picture placeholder's
 * spot) and `placed` once the user grabbed them, so a reload neither stacks a new frame on a
 * restored one nor pins an unmoved frame against recenter.
 */
export interface WidgetPose extends SavedUIPose {
  slot?: number;
  placed?: true;
}

/** Poses by widget key: a singleton kind, or `<kind>:<id>` for multi-instance kinds. */
export type WidgetPoses = Partial<Record<WidgetKey, WidgetPose>>;

interface PoseDocument {
  version: 2;
  poses: WidgetPoses;
}

function validPose(value: unknown): value is SavedUIPose {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SavedUIPose>;
  if (!Array.isArray(candidate.position) || candidate.position.length !== 3) return false;
  if (!candidate.position.every((part) => typeof part === 'number' && Number.isFinite(part))) {
    return false;
  }
  if (Math.hypot(...candidate.position) > 20) return false;
  if (!Array.isArray(candidate.quaternion) || candidate.quaternion.length !== 4) return false;
  if (!candidate.quaternion.every((part) => typeof part === 'number' && Number.isFinite(part))) {
    return false;
  }
  const quaternionLength = Math.hypot(...candidate.quaternion);
  if (quaternionLength < 1e-8 || Math.abs(quaternionLength - 1) > 1e-4) return false;
  return (
    typeof candidate.scale === 'number' &&
    Number.isFinite(candidate.scale) &&
    candidate.scale >= 0.2 &&
    candidate.scale <= 3
  );
}

function clonePose(pose: WidgetPose): WidgetPose {
  const copy: WidgetPose = {
    position: [...pose.position] as SavedUIPose['position'],
    quaternion: [...pose.quaternion] as SavedUIPose['quaternion'],
    scale: pose.scale,
  };
  const { slot } = pose;
  if (typeof slot === 'number' && Number.isInteger(slot) && slot >= -1 && slot < 64)
    copy.slot = slot;
  if (pose.placed === true) copy.placed = true;
  return copy;
}

function emptyDocument(): PoseDocument {
  return { version: VERSION, poses: {} };
}

function readDocument(storage: Storage): PoseDocument {
  try {
    const current = storage.getItem(STORAGE_KEY);
    const raw = current ?? storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return emptyDocument();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyDocument();
    const document = parsed as { version?: unknown; poses?: WidgetPoses | null };
    if (
      document.version !== (current ? VERSION : 1) ||
      typeof document.poses !== 'object' ||
      document.poses === null
    ) {
      return emptyDocument();
    }
    const poses: WidgetPoses = {};
    for (const [key, pose] of Object.entries(document.poses)) {
      if (widgetKeyKind(key) && validPose(pose))
        poses[key] = current ? clonePose(pose) : legacyPoseToWorld(pose);
    }
    return { version: VERSION, poses };
  } catch {
    return emptyDocument();
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createWidgetPoseStore(storage: Storage | null = defaultStorage()): {
  read(): WidgetPoses;
  save(key: WidgetKey, pose: WidgetPose): boolean;
  remove(key: WidgetKey): boolean;
  clear(): boolean;
} {
  return {
    read(): WidgetPoses {
      if (!storage) return {};
      const { poses } = readDocument(storage);
      const copy: WidgetPoses = {};
      for (const [key, pose] of Object.entries(poses)) if (pose) copy[key] = clonePose(pose);
      return copy;
    },
    save(key, pose): boolean {
      if (!storage || !widgetKeyKind(key) || !validPose(pose)) return false;
      const document = readDocument(storage);
      document.poses[key] = clonePose(pose);
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(document));
        return true;
      } catch {
        return false;
      }
    },
    remove(key): boolean {
      if (!storage || !widgetKeyKind(key)) return false;
      const document = readDocument(storage);
      delete document.poses[key];
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
