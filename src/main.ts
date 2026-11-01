import './styles.css';
import type {
  KeyModifiers,
  QuickCommand,
  TerminalSurface,
  WorkspaceActions,
  WorkspaceSnapshot,
} from './contracts';
import { createDemoSurface, demoSnapshot } from './demo';
import { createDesktopPanels, type DesktopPanels } from './desktop/panels';
import { loadObservatory } from './environment';
import { createTerminalSurface } from './terminal';
import { mountWorkspaceUI, type WorkspaceUI } from './ui';
import { createWorkspaceScene, type WorkspaceScene } from './xr';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Application mount is missing');
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

function notice(message: string): void {
  ui.setConnection('disconnected', message);
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
    });
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

function sendKey(id: string, key: string, modifiers?: KeyModifiers): void {
  if (!surfaces.get(id)?.sendKey(key, modifiers))
    notice('Terminal is disconnected. Reconnect before sending input.');
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
    for (const pane of next.panes.slice(0, 2)) selectPane(pane.id);
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
};

ui = mountWorkspaceUI(app, {
  onConnect: (value) => {
    void connect(value);
  },
  onRefresh: () => refreshMetadata?.(),
  onSelectPane: (pane) => selectPane(pane.id),
  onClosePane: (pane) => closePane(pane.id),
  onSendText: sendText,
  onSendKey: sendKey,
  onRunCommand: runCommand,
  onCommandsChange: syncCommands,
  onEnterXR: () => {
    void scene.enterXR('vr').catch((error: Error) => notice(error.message));
  },
  onPassthrough: () => {
    void scene.enterXR('ar').catch((error: Error) => notice(error.message));
  },
  onSettingsChange: (settings) => {
    scene?.setBackground(settings.background);
    scene?.setGazeEnabled(settings.gazeEmphasis);
  },
  onResetLayout: () => scene.resetLayout(),
  onDemo: startDemo,
});
scene = createWorkspaceScene(ui.sceneHost, actions);
desktop = createDesktopPanels(ui.sceneHost, selectPane);
const stopPresentation = scene.subscribe((state) => {
  desktop.setImmersive(state.xrMode !== 'desktop');
});
const settings = ui.getSettings();
scene.setBackground(settings.background);
scene.setGazeEnabled(settings.gazeEmphasis);
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

window.addEventListener(
  'pagehide',
  () => {
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
      demo,
      endpoint,
      selectedId,
      panes: snapshot.panes,
      attached: [...surfaces.keys()],
      scene: { ...scene.state },
    }),
    startDemo,
    connect,
    selectPane,
    closePane,
  },
});
