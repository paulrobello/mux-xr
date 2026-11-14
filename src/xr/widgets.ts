import type { SpatialWidget } from '@par/xr-workspace/internal/widget';
import type { AgentRosterRow } from '../workspace/agent-roster';
import type { BellFeedEntry } from './bell-feed';
import type { PerfSample } from './perf-gauge';
import type { PictureImage } from './picture-image';
import type { StreamLinkInput } from './stream-health';

export { type ClockKind, createClockWidget } from '@par/xr-workspace/internal/clock-widget';
export { disposeOwned } from '@par/xr-workspace/internal/widget';

export interface Widget extends SpatialWidget {
  /** Receives every roster change; widgets that do not show agents omit it. */
  setAgentRoster?: (rows: readonly AgentRosterRow[]) => void;
  /** Receives every bell feed change, newest first; widgets that do not show bells omit it. */
  setBellFeed?: (entries: readonly BellFeedEntry[]) => void;
  /** Receives frame stats each time the scene's frame counter reports (about 2 Hz). */
  setPerfSample?: (sample: PerfSample) => void;
  /** Receives every pane stream about once a second, only while such a widget is mounted. */
  setStreamLinks?: (links: readonly StreamLinkInput[], nowMs: number) => void;
  /** Drops frame-time history; called when an XR session starts. */
  resetPerf?: () => void;
  /** Receives the focused pane, directory or roster hint, and hostname. Widgets dedupe repeats. */
  setFocusedPane?: (paneId: string | null, cwd: string | null, host?: string | null) => void;
  /** Applies a new texture anisotropy, already capped to the renderer maximum. */
  setTextureAnisotropy?: (anisotropy: number) => void;
  /** Receives the weather ZIP setting on mount and on each change; empty when none is set. */
  setWeatherZip?: (zip: string) => void;
  /** Gives a picture frame its depth map; frames take ownership of the image's canvas. */
  setPictureDepth?: (depth: PictureImage) => void;
}
