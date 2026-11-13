import type * as THREE from 'three';
import { createAgentBoardWidget } from './agent-board';
import { createBellFeedWidget } from './bell-feed';
import { createBookingTimelineWidget } from './booking-timeline';
import { createDeskWindow, DESK_WINDOW_KIND } from './desk-window';
import { createHostLoadWidget } from './host-load';
import { createKanbanStripWidget } from './kanban-strip';
import { createMeshInboxWidget } from './mesh-inbox';
import { createPerfGaugeWidget } from './perf-gauge';
import { createPictureFrameWidget } from './picture-frame';
import { createRepoStatusWidget } from './repo-status-widget';
import { createServiceHealthWidget } from './service-health';
import { createStickyNoteWidget } from './sticky-note';
import { createStreamHealthWidget } from './stream-health';
import { createTimerWidget } from './timer-widget';
import { createWeatherWidget } from './weather-widget';
import { createClockWidget, type Widget } from './widgets';

export interface WidgetEntry {
  /** Registry key; also the persisted pose key. */
  kind: string;
  /** Name shown in the Widgets panel ("Add <name>" / "Hide <name>"). */
  displayName: string;
  /** Spawn position (x, y, z) in metres relative to the viewer's yaw-only heading. */
  spawnOffset: readonly [number, number, number];
  /** Uniform scale on spawn and recenter; 1 when omitted. */
  spawnScale?: number;
  /** Turn to face the viewer from the spawn offset (yaw only) on spawn and recenter. */
  faceViewer?: true;
  /** Many instances may coexist; each is keyed `<kind>:<id>` in the scene and the pose store. */
  multiInstance?: boolean;
  create: (envMap: THREE.Texture | null) => Widget;
}

/** Entry order is the Widgets panel order. */
export const WIDGET_REGISTRY = [
  {
    kind: 'digital-clock',
    displayName: 'Digital clock',
    spawnOffset: [-0.45, 0.3, -1.25],
    create: (envMap) => createClockWidget('digital-clock', envMap),
  },
  {
    kind: 'analog-clock',
    displayName: 'Analog clock',
    spawnOffset: [0.45, 0.3, -1.25],
    create: (envMap) => createClockWidget('analog-clock', envMap),
  },
  {
    kind: 'agent-board',
    displayName: 'Agent board',
    // Centred below both clocks and above the HUD, default or recentered.
    spawnOffset: [0, -0.27, -1.25],
    spawnScale: 0.8,
    create: (envMap) => createAgentBoardWidget(envMap),
  },
  {
    kind: 'timer',
    displayName: 'Timer',
    // Centred in the gap between the clock bodies (-0.14 to 0.16, so x +0.01); the widget is 0.27 m wide.
    spawnOffset: [0.01, 0.3, -1.25],
    create: (envMap) => createTimerWidget(envMap),
  },
  {
    kind: 'bell-feed',
    displayName: 'Bell feed',
    // To the right of the analog clock, clear of the agent board and both HUD poses.
    spawnOffset: [1.05, 0.15, -1.1],
    spawnScale: 0.8,
    faceViewer: true,
    create: (envMap) => createBellFeedWidget(envMap),
  },
  {
    kind: 'perf-gauge',
    displayName: 'Performance',
    // Left of the digital clock and nearer, clear of the clocks, the board and both HUD poses.
    spawnOffset: [-1, 0.15, -1.1],
    spawnScale: 0.9,
    faceViewer: true,
    create: (envMap) => createPerfGaugeWidget(envMap),
  },
  {
    kind: 'host-load',
    displayName: 'Host load',
    // Above and behind the perf gauge, below the upper picture row; the only clear spot this size.
    spawnOffset: [-1.15, 0.53, -1.3],
    spawnScale: 0.7,
    faceViewer: true,
    create: (envMap) => createHostLoadWidget(envMap),
  },
  {
    kind: 'stream-health',
    displayName: 'Stream health',
    // Left of host load and the weather banner, beside the other diagnostics; the only clear
    // spot at a readable scale once every earlier default is spawned.
    spawnOffset: [-1.6, 0.6, -1.1],
    spawnScale: 0.6,
    faceViewer: true,
    create: (envMap) => createStreamHealthWidget(envMap),
  },
  {
    kind: 'repo-status',
    displayName: 'Git & CI',
    // Right of the board, below the analog clock, near eye level; the only clear spot at this
    // scale once host load took the space above the perf gauge.
    spawnOffset: [0.6, -0.1, -1.4],
    spawnScale: 0.7,
    faceViewer: true,
    create: (envMap) => createRepoStatusWidget(envMap),
  },
  {
    kind: 'weather',
    displayName: 'Weather',
    // Above the left clock, right of host load and under the upper picture row; that gap is
    // short, so the widget is a wide banner at this scale.
    spawnOffset: [-0.6, 0.574, -1.32],
    spawnScale: 0.62,
    faceViewer: true,
    create: (envMap) => createWeatherWidget(envMap),
  },
  {
    kind: 'picture',
    displayName: 'Picture',
    // Lower left, below the perf gauge and left of the board; later frames step down-left.
    spawnOffset: [-0.95, -0.55, -1.15],
    spawnScale: 1,
    multiInstance: true,
    faceViewer: true,
    // The menu spawns the placeholder; pictures picked on the page fill it.
    create: (envMap) => createPictureFrameWidget(envMap),
  },
  {
    kind: 'kanban-strip',
    displayName: 'Kanban strip',
    // Centred below both HUD poses, a glance down. The Add Picture placeholder and the board fill
    // the eye-level gaps, so a grid search found no clearer spot near the middle at 0.7 scale.
    spawnOffset: [0, -0.9, -1.2],
    spawnScale: 0.7,
    faceViewer: true,
    create: (envMap) => createKanbanStripWidget(envMap),
  },
  {
    kind: 'booking-timeline',
    displayName: 'Host bookings',
    // Far left at eye level, past stream health; the grid search found no nearer clear spot this
    // size once the kanban strip took the space below the HUD.
    spawnOffset: [-2.5, 0.05, -1.6],
    spawnScale: 0.7,
    faceViewer: true,
    create: (envMap) => createBookingTimelineWidget(envMap),
  },
  {
    kind: 'service-health',
    displayName: 'Service health',
    // Far right just below eye level, mirroring the bookings panel; nearer spots this size overlap
    // the board, a HUD pose or a picture slot.
    spawnOffset: [2.65, -0.45, -1.6],
    spawnScale: 0.7,
    faceViewer: true,
    create: (envMap) => createServiceHealthWidget(envMap),
  },
  {
    kind: 'mesh-inbox',
    displayName: 'Mesh inbox',
    // Centred above both HUD poses, a glance up; every eye-level spot this size is taken.
    spawnOffset: [0, 1.55, -1.2],
    spawnScale: 0.7,
    faceViewer: true,
    create: (envMap) => createMeshInboxWidget(envMap),
  },
  {
    kind: 'sticky-note',
    displayName: 'Sticky note',
    // Pin as note places each note in view; this upper-right spot, the only one clear of every
    // default, picture slot and HUD pose, takes notes restored without a saved pose.
    spawnOffset: [1.45, 0.7, -1.1],
    spawnScale: 0.7,
    multiInstance: true,
    faceViewer: true,
    // The menu starts dictation; Pin as note creates each note with its text.
    create: (envMap) => createStickyNoteWidget(envMap),
  },
] as const satisfies readonly WidgetEntry[];

// The desk window belongs to World settings, where it can request a passthrough session.
const DESK_WINDOW_ENTRY: WidgetEntry = {
  kind: DESK_WINDOW_KIND,
  displayName: 'Desk window',
  spawnOffset: [0, -0.72, -1.05],
  create: () => createDeskWindow(),
};

export type WidgetKind = (typeof WIDGET_REGISTRY)[number]['kind'] | typeof DESK_WINDOW_KIND;

export function widgetKinds(): WidgetKind[] {
  return WIDGET_REGISTRY.map((entry) => entry.kind);
}

/** The entry for a registered kind; throws when the kind has no entry. */
export function getWidgetEntry(kind: WidgetKind): WidgetEntry {
  const entry = findWidgetEntry(kind);
  if (!entry) throw new Error(`Unknown widget kind: ${String(kind)}`);
  return entry;
}

/** The entry for any value, or undefined when it is not a registered kind. */
export function findWidgetEntry(kind: unknown): WidgetEntry | undefined {
  if (kind === DESK_WINDOW_KIND) return DESK_WINDOW_ENTRY;
  return (WIDGET_REGISTRY as readonly WidgetEntry[]).find((entry) => entry.kind === kind);
}

export function isWidgetKind(kind: unknown): kind is WidgetKind {
  return findWidgetEntry(kind) !== undefined;
}

/** Yaw (radians, about +y) added to the viewer heading at spawn: toward the eye, or 0. */
export function widgetSpawnYaw(entry: WidgetEntry): number {
  if (!entry.faceViewer) return 0;
  const [x, , z] = entry.spawnOffset;
  return Math.atan2(-x, -z);
}

const INSTANCE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The scene and pose-store key for one widget: the kind, or `<kind>:<id>` for multi-instance kinds. */
export type WidgetKey = string;

export function widgetKey(kind: WidgetKind, id?: string): WidgetKey {
  return findWidgetEntry(kind)?.multiInstance && id ? `${kind}:${id}` : kind;
}

/** The kind a key belongs to, or undefined for unknown kinds and malformed instance keys. */
export function widgetKeyKind(key: unknown): WidgetKind | undefined {
  if (typeof key !== 'string') return undefined;
  const split = key.indexOf(':');
  const kind = split < 0 ? key : key.slice(0, split);
  const entry = findWidgetEntry(kind);
  if (!entry) return undefined;
  if (split < 0) return entry.multiInstance ? undefined : (kind as WidgetKind);
  return entry.multiInstance && INSTANCE_ID.test(key.slice(split + 1))
    ? (kind as WidgetKind)
    : undefined;
}
