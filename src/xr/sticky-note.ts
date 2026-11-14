export * from '@par/xr-workspace/internal/sticky-note';

/**
 * Where Pin as note puts a new note, from the viewer's heading: in view, up and right of the
 * keyboard panel's transcript. The note counts as placed there, so recenter leaves it.
 */
export const STICKY_NOTE_PIN_OFFSET: readonly [number, number, number] = [0.32, 0.16, -0.85];

/** Later notes step nearer and toward the centre from `base`, wrapping after six. */
export function stickyNoteSpawnOffset(
  base: readonly [number, number, number],
  slot: number,
): [number, number, number] {
  const step = Math.max(0, Math.floor(slot)) % 6;
  return [base[0] - Math.sign(base[0]) * step * 0.07, base[1] - step * 0.04, base[2] + step * 0.03];
}
