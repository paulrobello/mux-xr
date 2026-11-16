/**
 * The selectable scene backgrounds: the one table the id list, picker labels, thumbnails and
 * settings select derive from. It imports nothing from Three.js so `contracts.ts` can build on it.
 * Saved settings hold these ids as strings, so an id must never change. A procedural world also
 * needs a loader under the same id in `ENVIRONMENT_LOADERS` (`@par/xr-workspace`).
 */
export const BACKGROUNDS = [
  { id: 'black', label: 'Black' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'observatory', label: 'Observatory' },
  { id: 'hangar', label: 'Hangar deck' },
  { id: 'deep-water', label: 'Deep-water station' },
  { id: 'studio', label: 'Minimal studio' },
  { id: 'desert', label: 'Desert night' },
  { id: 'aurora', label: 'Aurora tundra' },
  { id: 'koi', label: 'Koi garden' },
  { id: 'summit', label: 'Cloud summit' },
  { id: 'rooftop', label: 'Rain rooftop' },
] as const;

export type BackgroundId = (typeof BACKGROUNDS)[number]['id'];

export function backgroundThumbnail(id: BackgroundId): string {
  return `/assets/backgrounds/${id}.webp`;
}
