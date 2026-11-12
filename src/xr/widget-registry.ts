import type * as THREE from 'three';
import { createAgentBoardWidget } from './agent-board';
import { createBellFeedWidget } from './bell-feed';
import { createPerfGaugeWidget } from './perf-gauge';
import { createTimerWidget } from './timer-widget';
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
] as const satisfies readonly WidgetEntry[];

/** Union of every registered kind; grows with each entry. */
export type WidgetKind = (typeof WIDGET_REGISTRY)[number]['kind'];

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
