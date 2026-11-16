/**
 * The selectable scene backgrounds: the one table the id list, picker labels, thumbnails, settings
 * select and environment loaders derive from. Nothing here imports Three.js at load time, so
 * `contracts.ts` can build on it: a world's code arrives through a lazy `import()` the first time
 * it is selected. Saved settings hold these ids as strings, so an id must never change. An entry
 * without `load` is drawn by the scene itself.
 */
import type { EnvironmentFactory } from '@par/xr-workspace';

export interface BackgroundDescriptor {
  readonly id: string;
  readonly label: string;
  /** Fetches the world's factory; absent for backgrounds the scene draws itself. */
  readonly load?: () => Promise<EnvironmentFactory>;
}

export const BACKGROUNDS = [
  { id: 'black', label: 'Black' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'observatory', label: 'Observatory' },
  {
    id: 'hangar',
    label: 'Hangar deck',
    load: () =>
      import('@par/xr-workspace/environments/hangar-deck').then(
        (module) => module.createHangarDeckEnvironment,
      ),
  },
  {
    id: 'deep-water',
    label: 'Deep-water station',
    load: () =>
      import('@par/xr-workspace/environments/deep-water').then(
        (module) => module.createDeepWaterEnvironment,
      ),
  },
  {
    id: 'studio',
    label: 'Minimal studio',
    load: () =>
      import('@par/xr-workspace/environments/minimal-studio').then(
        (module) => module.createMinimalStudioEnvironment,
      ),
  },
  {
    id: 'desert',
    label: 'Desert night',
    load: () =>
      import('@par/xr-workspace/environments/desert-night').then(
        (module) => module.createDesertNightEnvironment,
      ),
  },
  {
    id: 'aurora',
    label: 'Aurora tundra',
    load: () =>
      import('@par/xr-workspace/environments/aurora-tundra').then(
        (module) => module.createAuroraTundraEnvironment,
      ),
  },
  {
    id: 'koi',
    label: 'Koi garden',
    load: () =>
      import('@par/xr-workspace/environments/koi-garden').then(
        (module) => module.createKoiGardenEnvironment,
      ),
  },
  {
    id: 'summit',
    label: 'Cloud summit',
    load: () =>
      import('@par/xr-workspace/environments/cloud-summit').then(
        (module) => module.createCloudSummitEnvironment,
      ),
  },
  {
    id: 'rooftop',
    label: 'Rain rooftop',
    load: () =>
      import('@par/xr-workspace/environments/rain-rooftop').then(
        (module) => module.createRainRooftopEnvironment,
      ),
  },
] as const satisfies readonly BackgroundDescriptor[];

export type BackgroundId = (typeof BACKGROUNDS)[number]['id'];

export function backgroundThumbnail(id: BackgroundId): string {
  return `/assets/backgrounds/${id}.webp`;
}
