import type {
  PaneDescriptor,
  TerminalDamageStats,
  TerminalMouseTrackingMode,
  TerminalRenderQuality,
  TerminalStatus,
} from './contracts';
import { type DiagnosticEntry, diagnostics } from './diagnostics';
import type { PaneController } from './workspace/pane-controller';
import type { WorkspaceScene, WorkspaceSceneState } from './xr/scene';

/** One attached terminal stream as the browser checks read it. */
export interface MuxXrStreamState {
  id: string;
  status: TerminalStatus;
  cols: number;
  rows: number;
  writable: boolean;
  mouseTracking: TerminalMouseTrackingMode;
  renderQuality: TerminalRenderQuality;
  canvasWidth: number;
  canvasHeight: number;
  damage: TerminalDamageStats | null;
}

export interface MuxXrPanelState {
  id: string;
  position: number[];
  quaternion: number[];
  scale: number;
}

export interface MuxXrState {
  buildId: string;
  demo: boolean;
  endpoint: string;
  selectedId: string | null;
  panes: PaneDescriptor[];
  attached: string[];
  scene: WorkspaceSceneState;
  panels: MuxXrPanelState[];
  streams: MuxXrStreamState[];
}

/**
 * The object installed at `window.__muxXR`. The private browser checks in `scripts/` drive the
 * running app through it, and that includes checks run against production builds.
 */
export interface MuxXrDebugApi {
  getState(): MuxXrState;
  getControlHints: WorkspaceScene['getControlHints'];
  /** `scripts/quest-frame-probe.ts` hides scene groups through this to price them on the headset. */
  getThreeScene(): WorkspaceScene['scene'];
  /** The diagnostics ring, newest first; checks assert a clean run produced no entries. */
  diagnostics(): readonly DiagnosticEntry[];
  checkForUpdate(): Promise<void>;
  startDemo(): void;
  connect(endpoint: string): Promise<void>;
  selectPane(id: string): void;
  closePane(id: string): void;
  togglePaneConnection(id: string): void;
}

declare global {
  interface Window {
    __muxXR?: MuxXrDebugApi;
  }
}

/** Installs the debug object. Installation is unconditional: private checks run on production builds. */
export function installDebugApi(api: MuxXrDebugApi, target: Window = window): void {
  target.__muxXR = api;
}

export interface DebugApiSources {
  buildId: string;
  scene: WorkspaceScene;
  panes: PaneController;
  checkForUpdate(): Promise<void>;
  startDemo(): void;
  connect(endpoint: string): Promise<void>;
}

/** Builds the debug object over the app's live pieces. */
export function createDebugApi(sources: DebugApiSources): MuxXrDebugApi {
  const { scene, panes } = sources;
  return {
    getState: () => ({
      buildId: sources.buildId,
      demo: panes.demo,
      endpoint: panes.endpoint,
      selectedId: panes.selectedId,
      panes: panes.snapshot.panes,
      attached: panes.ids(),
      scene: { ...scene.state },
      panels: scene.scene.children
        .filter((object) => object.name.startsWith('terminal-panel-'))
        .map((object) => ({
          id: object.userData.terminalId as string,
          position: object.position.toArray(),
          quaternion: object.quaternion.toArray(),
          scale: object.scale.x,
        })),
      streams: panes.surfaces().map((surface) => ({
        id: surface.pane.id,
        status: surface.status,
        cols: surface.cols,
        rows: surface.rows,
        writable: surface.canResizeGrid,
        mouseTracking: surface.mouseTracking ?? 'none',
        renderQuality: surface.renderQuality ?? 'full',
        canvasWidth: surface.canvas.width,
        canvasHeight: surface.canvas.height,
        damage: surface.damageStats ? { ...surface.damageStats } : null,
      })),
    }),
    getControlHints: () => scene.getControlHints(),
    getThreeScene: () => scene.scene,
    diagnostics: () => diagnostics.entries(),
    checkForUpdate: sources.checkForUpdate,
    startDemo: sources.startDemo,
    connect: sources.connect,
    selectPane: (id) => panes.selectPane(id),
    closePane: (id) => panes.closePane(id),
    togglePaneConnection: (id) => panes.toggleConnection(id),
  };
}
