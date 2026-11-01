import './styles.css';
import type {
  KeyModifiers,
  QuickCommand,
  TerminalColorMode,
  TerminalSurface,
  WorkspaceActions,
  WorkspaceSnapshot,
} from './contracts';
import { createDemoSurface, demoSnapshot } from './demo';
import { createDesktopPanels, type DesktopPanels } from './desktop/panels';
import { loadObservatory } from './environment';
import { reloadAfterXR } from './reload';
import { createTerminalSurface } from './terminal';
import { mountWorkspaceUI, type WorkspaceSettings, type WorkspaceUI } from './ui';
import { createUpdateChecker, type UpdateChecker } from './update-check';
import { shouldAutoReload } from './update-policy';
import { initialPaneSelection } from './workspace/initial';
import { createWorkspaceScene, type WorkspaceScene } from './xr';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application mount is missing');
const runningBuildId =
  document.querySelector<HTMLMetaElement>('meta[name="build-fingerprint"]')?.content ??
  'development';
const surfaces = new Map<string, TerminalSurface>();
let snapshot: WorkspaceSnapshot = { panes: [] };
let selectedId: string | null = null;
let endpoint = '';
let demo = false;
let generation = 0;
let stopMetadata: (() => void) | undefined;
let refreshMetadata: (() => void) | undefined;
let autoAttachPending = true;
let ui: WorkspaceUI;
let scene: WorkspaceScene;
let desktop: DesktopPanels;
let disposeEnvironment: (() => void) | undefined;
let applyingSettings = false;
let updateChecker: UpdateChecker | undefined;
let reloading = false;
let updateAvailable = false;
let enteringXR = false;

function maybeReloadUpdate(): void {
  if (shouldAutoReload(updateAvailable, scene.state.xrMode, enteringXR)) void reloadApp();
}

async function enterXR(mode: 'vr' | 'ar'): Promise<void> {
  enteringXR = true;
  try {
    await scene.enterXR(mode);
  } catch (error) {
    notice(error instanceof Error ? error.message : 'Could not enter XR.');
  } finally {
    enteringXR = false;
    maybeReloadUpdate();
  }
}

async function reloadApp(): Promise<void> {
  if (reloading) return;
  reloading = true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await reloadAfterXR(
      () =>
        Promise.race([
          scene.exitXR(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('XR exit timed out')), 10_000);
          }),
        ]),
      window.location,
    );
  } catch {
    reloading = false;
    notice('Could not exit XR. Leave immersive mode, then try Reload again.');
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function notice(message: string): void {
  ui.setConnection('disconnected', message);
  scene?.setNotice(message);
}

function syncCommands(): void {
  scene.setQuickCommands(selectedId ? ui.getCommandsForPane(selectedId) : []);
}

function selectPane(id: string): void {
  const pane = snapshot.panes.find((item) => item.id === id);
  if (!pane) return;
  if (!surfaces.has(id)) {
    const surface = demo ? createDemoSurface(pane) : createTerminalSurface(endpoint, pane);
    surfaces.set(id, surface);
    desktop.add(surface);
    scene.addTerminal(surface);
    surface.subscribe(() => {
      if (selectedId === id) ui.setConnection(surface.status, `${pane.title} · ${surface.status}`);
      ui.setTerminalGrid(id, surface.cols, surface.rows, surface.canResizeGrid);
    });
    surface.setColorMode(ui.getSettings().colorMode);
    ui.setTerminalGrid(id, surface.cols, surface.rows, surface.canResizeGrid);
    surface.connect();
    ui.setAttachedPaneIds([...surfaces.keys()]);
  }
  if (selectedId === id) return;
  selectedId = id;
  ui.setActivePane(id);
  desktop.select(id);
  syncCommands();
  scene.selectTerminal(id);
  const surface = surfaces.get(id);
  if (surface) ui.setConnection(surface.status, `${pane.title} · ${surface.status}`);
}

function closePane(id: string): void {
  desktop.remove(id);
  scene.removeTerminal(id);
  surfaces.get(id)?.dispose();
  surfaces.delete(id);
  if (selectedId === id) selectedId = null;
  ui.setAttachedPaneIds([...surfaces.keys()]);
  const next = surfaces.keys().next().value;
  if (next && !selectedId) selectPane(next);
}

function sendKey(id: string, key: string, modifiers?: KeyModifiers): boolean {
  const sent = surfaces.get(id)?.sendKey(key, modifiers) ?? false;
  if (!sent) notice('Terminal is disconnected. Reconnect before sending input.');
  else scene.setNotice(null);
  return sent;
}

function sendText(id: string, text: string): void {
  if (!surfaces.get(id)?.sendText(text))
    notice('Terminal is disconnected. Reconnect before sending input.');
}

function runCommand(command: QuickCommand, paneId: string): void {
  const surface = surfaces.get(paneId);
  if (!surface?.sendText(command.text)) {
    notice('The command target is unavailable. Select a connected terminal.');
    return;
  }
  if (command.sendNewline && !surface.sendKey('Enter'))
    notice('Connection lost before Enter was sent.');
}

function resizeGrid(paneId: string, cols: number, rows: number): boolean {
  return surfaces.get(paneId)?.resizeGrid(cols, rows) ?? false;
}

function setTerminalColorMode(mode: TerminalColorMode): void {
  ui.setTerminalColorMode(mode);
}

function setKeyboardBackground(enabled: boolean): void {
  ui.setKeyboardBackgroundEnabled(enabled);
}

function applySettings(settings: WorkspaceSettings): void {
  if (!scene || applyingSettings) return;
  applyingSettings = true;
  try {
    scene.setTerminalColorMode(settings.colorMode);
    scene.setKeyboardBackgroundEnabled(settings.keyboardBackground);
    scene.setGazeInputEnabled(settings.gazeInput);
    scene.setBackground(settings.background);
    for (const surface of surfaces.values()) surface.setColorMode(settings.colorMode);
  } finally {
    applyingSettings = false;
  }
}

function detachAll(): void {
  stopMetadata?.();
  stopMetadata = undefined;
  refreshMetadata = undefined;
  for (const id of [...surfaces.keys()]) closePane(id);
  selectedId = null;
}

function applySnapshot(next: WorkspaceSnapshot): void {
  snapshot = next;
  ui.update(next);
  scene.setAvailablePanes(next.panes);
  const valid = new Set(next.panes.map((pane) => pane.id));
  for (const id of [...surfaces.keys()]) if (!valid.has(id)) closePane(id);
  if (autoAttachPending && next.panes.length) {
    autoAttachPending = false;
    const initial = initialPaneSelection(next.panes);
    for (const pane of initial.panes) selectPane(pane.id);
    if (initial.activeId) selectPane(initial.activeId);
  }
}

function startDemo(): void {
  generation += 1;
  detachAll();
  demo = true;
  autoAttachPending = true;
  ui.setDemoMode(true);
  applySnapshot(demoSnapshot);
  ui.setConnection('connected', 'Demo preview · synthetic terminals');
}

async function connect(nextEndpoint: string): Promise<void> {
  const current = ++generation;
  detachAll();
  demo = false;
  autoAttachPending = true;
  applySnapshot({ panes: [] });
  ui.setDemoMode(false);
  endpoint = nextEndpoint;
  ui.setConnection('connecting', 'Connecting to your streamer…');
  try {
    const { connectHierarchy } = await import('./workspace/hierarchy');
    const connection = await connectHierarchy(
      endpoint,
      (next) => {
        if (current === generation) applySnapshot(next);
      },
      (message) => {
        if (current === generation) notice(message);
      },
    );
    if (current !== generation) connection.disconnect();
    else {
      stopMetadata = connection.disconnect;
      refreshMetadata = connection.refresh;
    }
  } catch (error) {
    if (current === generation)
      notice(error instanceof Error ? error.message : 'Connection failed');
  }
}

const actions: WorkspaceActions = {
  saveCommand: (command) => ui.addCommand(command),
  reloadApp: () => {
    void reloadApp();
  },
  selectPane,
  closePane,
  sendText: (text) => {
    if (selectedId) sendText(selectedId, text);
  },
  sendKey: (key, modifiers) => {
    if (selectedId) sendKey(selectedId, key, modifiers);
  },
  runCommand,
  openCommands: () => {
    syncCommands();
    ui.openInput('commands');
  },
  openKeyboard: () => ui.openInput('keyboard'),
  exitPreview: () => desktop.showTerminals(),
  resizeGrid,
  setTerminalColorMode,
  setKeyboardBackground,
};

ui = mountWorkspaceUI(app, {
  onReloadApp: () => {
    void reloadApp();
  },
  onConnect: (value) => {
    void connect(value);
  },
  onRefresh: () => refreshMetadata?.(),
  onSelectPane: (pane) => selectPane(pane.id),
  onClosePane: (pane) => closePane(pane.id),
  onSendText: sendText,
  onSendKey: sendKey,
  onRunCommand: runCommand,
  onResizeGrid: resizeGrid,
  onCommandsChange: syncCommands,
  onEnterXR: () => {
    void enterXR('vr');
  },
  onPassthrough: () => {
    void enterXR('ar');
  },
  onSettingsChange: applySettings,
  onResetLayout: () => scene.resetLayout(),
  onArrange: (pattern) => {
    desktop.showPreview();
    scene.arrangeTerminals(pattern);
  },
  onDemo: startDemo,
});
scene = createWorkspaceScene(ui.sceneHost, actions);
desktop = createDesktopPanels(ui.sceneHost, selectPane, {
  onScale: (direction) => scene.scaleSelectedPanel(direction),
  onReset: () => scene.resetLayout(),
});
const stopPresentation = scene.subscribe((state) => {
  if (!applyingSettings) {
    ui.setGazeInputEnabled(state.gazeInputEnabled);
    ui.setKeyboardBackgroundEnabled(state.keyboardBackgroundEnabled, false);
    ui.setTerminalColorMode(state.terminalColorMode, false);
    if (state.arrangement && state.arrangement !== ui.getSettings().arrangement)
      ui.setArrangement(state.arrangement);
  }
  desktop.setImmersive(state.xrMode !== 'desktop');
  if (state.xrMode !== 'desktop') ui.closeInput();
  maybeReloadUpdate();
});
applySettings(ui.getSettings());
void loadObservatory(scene)
  .then((dispose) => {
    disposeEnvironment = dispose;
  })
  .catch((error: unknown) => {
    console.warn('Observatory unavailable; using the lightweight background.', error);
  });
if (scene.state.rendererError) notice(scene.state.rendererError);

const params = new URLSearchParams(location.search);
if (params.get('demo') === '1') startDemo();
else if (params.get('server')) void connect(params.get('server') ?? '');
else if (ui.getSettings().endpoint.trim()) void connect(ui.getSettings().endpoint.trim());

window.addEventListener(
  'pagehide',
  () => {
    updateChecker?.dispose();
    detachAll();
    stopPresentation();
    desktop.dispose();
    disposeEnvironment?.();
    scene.dispose();
    ui.destroy();
  },
  { once: true },
);

Object.assign(window, {
  __muxXR: {
    getState: () => ({
      buildId: runningBuildId,
      demo,
      endpoint,
      selectedId,
      panes: snapshot.panes,
      attached: [...surfaces.keys()],
      scene: { ...scene.state },
      panels: scene.scene.children
        .filter((object) => object.name.startsWith('terminal-panel-'))
        .map((object) => ({
          id: object.userData.terminalId as string,
          position: object.position.toArray(),
          quaternion: object.quaternion.toArray(),
          scale: object.scale.x,
        })),
      streams: [...surfaces.values()].map((surface) => ({
        id: surface.pane.id,
        status: surface.status,
        cols: surface.cols,
        rows: surface.rows,
        writable: surface.canResizeGrid,
      })),
    }),
    getControlHints: () => scene.getControlHints(),
    checkForUpdate: () => updateChecker?.poll() ?? Promise.resolve(),
    startDemo,
    connect,
    selectPane,
    closePane,
  },
});

if (/^[a-f0-9]{64}$/.test(runningBuildId)) {
  updateChecker = createUpdateChecker({
    runningBuildId,
    url: new URL('/version.json', window.location.href).href,
    onChange: (manifest) => {
      updateAvailable = manifest !== null;
      ui.setUpdateAvailable(manifest !== null);
      scene.setUpdateAvailable(manifest !== null);
      maybeReloadUpdate();
      if (scene.state.xrMode === 'desktop') window.dispatchEvent(new Event('resize'));
    },
  });
  updateChecker.start();
}
