import type { EnvironmentFactories } from './environment';
import { createAuroraTundraEnvironment } from './environments/aurora-tundra';
import { createCloudSummitEnvironment } from './environments/cloud-summit';
import { createDeepWaterEnvironment } from './environments/deep-water';
import { createDesertNightEnvironment } from './environments/desert-night';
import { createHangarDeckEnvironment } from './environments/hangar-deck';
import { createKoiGardenEnvironment } from './environments/koi-garden';
import { createMinimalStudioEnvironment } from './environments/minimal-studio';
import { createRainRooftopEnvironment } from './environments/rain-rooftop';

/** The built-in environments with their code bundled together, for consumers that need them at once. */
export const ENVIRONMENT_FACTORIES = {
  hangar: createHangarDeckEnvironment,
  'deep-water': createDeepWaterEnvironment,
  studio: createMinimalStudioEnvironment,
  desert: createDesertNightEnvironment,
  aurora: createAuroraTundraEnvironment,
  rooftop: createRainRooftopEnvironment,
  summit: createCloudSummitEnvironment,
  koi: createKoiGardenEnvironment,
} satisfies EnvironmentFactories;
