import { createFrameUpdaters } from '@par/xr-workspace';

/** The scene's `registerFrameUpdater` over a real registry, plus the call that runs one frame. */
export function createTestFrameUpdaters() {
  const updaters = createFrameUpdaters();
  return { registerFrameUpdater: updaters.register, runFrame: updaters.update };
}
