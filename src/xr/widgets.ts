import type { SpatialWidget } from '@par/xr-workspace';

export { type ClockKind, createClockWidget, disposeOwned } from '@par/xr-workspace';

/**
 * What the scene mounts. Data sources reach a widget through the channels in `widget-types.ts`,
 * which the registry subscribes in `create`, so the base interface stays free of per-source hooks.
 */
export type Widget = SpatialWidget;
