import type * as THREE from 'three';
import type { PaneDescriptor, TerminalSurface } from '../../src/contracts';
import type { MuxXrDebugApi } from '../../src/debug-api';
import type { SpeechInput } from '../../src/speech-input';
import type { RadialMenu } from '../../src/xr/radial-menu';
import type { WorkspaceScene } from '../../src/xr/scene';

/** Per-frame counters the terminal capacity fixture collects in the page. */
export type BrowserMetrics = {
  frameCpuMs: number[];
  frameTimes: number[];
  fillTextCount: number;
  imageDataBytes: number;
  textureUploadBytes: number;
  textureUploadCount: number;
};

type ButtonPad = { buttons: Array<{ pressed: boolean }>; axes: number[] };

/**
 * The page globals the private browser checks read inside `page.evaluate`: the app's own
 * `window.__muxXR` plus every global a check's fixture page installs. A script reads only the
 * globals its own fixture defines, so a global here is present only on the page that sets it.
 */
export type FixtureWindow = Window & {
  __muxXR: MuxXrDebugApi;
  __questScene: THREE.Scene;
  __questThree: typeof THREE;
  __questControllers: THREE.Group[];
  __questCamera: THREE.PerspectiveCamera;
  __questRenderer: THREE.WebGLRenderer;
  __questHands: Array<THREE.Group & { joints: Record<string, THREE.Group> }>;
  __designScene: WorkspaceScene;
  __autoXR: { calls: number; activationAtRequest: boolean[] };
  __selectionScene: WorkspaceScene;
  __selectionSurfaces: Map<string, TerminalSurface>;
  __aimSelection(col: number, row: number): void;
  __clipboardWrite: Clipboard['writeText'];
  __rejectClipboard?: () => void;
  __focusPad: ButtonPad;
  __focusOriginal: { position: number[]; quaternion: number[]; scale: number[] };
  __radialPad: Pick<ButtonPad, 'buttons'>;
  __radialFreeze?: boolean;
  __testRadialMenu: RadialMenu;
  __widgetsPad: ButtonPad;
  __speechScene: WorkspaceScene;
  __speechInput: SpeechInput;
  __speechSurfaces: Map<string, TerminalSurface>;
  __speechStreams: MediaStream[];
  __sent: Array<{ id: string; text: string }>;
  __speech: SpeechInput;
  __surfaces: Map<string, TerminalSurface>;
  __bellScene: WorkspaceScene;
  __bellSurfaces: Map<string, TerminalSurface>;
  __bellSelect(id: string): void;
  __placementScene: WorkspaceScene;
  __placementSurfaces: Map<string, TerminalSurface>;
  __capacityMetrics: BrowserMetrics;
  __capacityResetMetrics: () => void;
  __demoSurface(pane: PaneDescriptor): TerminalSurface;
  __originalPose: string;
  __perf?: {
    renders: number;
    renderMs: number;
    calls: number;
    triangles: number;
    uploads: number;
    syncs: number;
    draws: Record<string, number>;
  };
};
