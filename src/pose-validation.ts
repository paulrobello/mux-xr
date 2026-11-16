import type { SavedUIPose } from './stores/ui-poses';

/** The default farthest a saved pose may sit from the origin, in metres. */
export const DEFAULT_MAX_POSE_DISTANCE = 20;

/**
 * Whether a value read back from storage is a usable saved pose: a finite position within
 * `maxDistance` metres, a unit quaternion, and a scale in range.
 */
export function validPose(
  value: unknown,
  maxDistance = DEFAULT_MAX_POSE_DISTANCE,
): value is SavedUIPose {
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
