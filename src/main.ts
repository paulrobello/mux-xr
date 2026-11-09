import './styles.css';
import type {
  KeyModifiers,
  QuickCommand,
  TerminalColorMode,
  TerminalMouseInput,
  TerminalSurface,
  WorkspaceActions,
  WorkspaceSnapshot,
} from './contracts';
import { createDemoSurface, demoSnapshot } from './demo';
import { createDesktopPanels, type DesktopPanels } from './desktop/panels';
import { loadObservatory } from './environment';
import { createLocalSpeechRecognition, isLocalSpeechSupported } from './local-speech';
import { executeQuickCommand, loadSharedCommands } from './quick-commands';
import { reloadAfterXR } from './reload';
import {
  createSpeechInput,
  type DictationAction,
  type DictationState,
  type SpeechInput,
} from './speech-input';
import { createTerminalSurface } from './terminal';
import { mountWorkspaceUI, type WorkspaceSettings, type WorkspaceUI } from './ui';
import { createUpdateChecker, type UpdateChecker } from './update-check';
import { shouldAutoReload } from './update-policy';
import { initialPaneSelection } from './workspace/initial';
import {
  createOpenViewsStore,
  normalizeOpenViewsServer,
  type OpenViewsProfile,
  resolveOpenViews,
} from './workspace/open-views';
import {
  createPaneCreator,
  type PaneCreationState,
  requestPaneCreate,
} from './workspace/pane-create';
import { createWorkspaceScene, type WorkspaceScene } from './xr';
import { createXREntryController, type XrEntryController } from './xr/entry';

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
const openViewsStore = createOpenViewsStore();
let pendingOpenViews: OpenViewsProfile | null = null;
let pauseViewPersistence = 0;
let lastLayoutRevision = 0;
let pendingRestoreNotice: string | null = null;
let ui: WorkspaceUI;
let scene: WorkspaceScene;
let desktop: DesktopPanels;
let disposeEnvironment: (() => void) | undefined;
const environmentAbort = new AbortController();
let applyingSettings = false;
let updateChecker: UpdateChecker | undefined;
let reloading = false;
let updateAvailable = false;
let enteringXR = false;
let xrEntryMode: 'vr' | 'ar' = 'vr';
let xrEntry: XrEntryController;
let speechInput: SpeechInput | undefined;
const DEMO_CREATION: PaneCreationState = {
  available: false,
  pending: false,
  reason: 'The demo preview cannot create terminals. Connect to a streamer.',
};
const paneCreator = createPaneCreator({
  request: (anchorPaneId, sessionId, token, signal) => {
    const current = generation;
    return requestPaneCreate(endpoint, anchorPaneId, sessionId, {
      signal,
      onLateReply: (outcome) => {
        if (current === generation) paneCreator.lateReply(outcome, token);
      },
    });
  },
  refreshTree: () => refreshMetadata?.(),
  attach: (paneId) => selectPane(paneId),
  notify: (message) => scene?.setNotice(message),
  onChange: (state) => publishPaneCreation(demo ? DEMO_CREATION : state),
});

function publishPaneCreation(state: PaneCreationState): void {
  ui?.setPaneCreation(state);
  scene?.setPaneCreation(state);
}

function createPane(sessionId: string): void {
  if (demo) {
    scene.setNotice(DEMO_CREATION.reason ?? null);
    return;
  }
  paneCreator.create(sessionId, snapshot.panes);
}

function maybeReloadUpdate(): void {
  if (shouldAutoReload(updateAvailable, scene.state.xrMode, enteringXR)) void reloadApp();
}

async function enterXR(mode: 'vr' | 'ar'): Promise<void> {
  await xrEntry.start(mode).catch(() => undefined);
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

function persistOpenViews(): void {
  if (demo || !endpoint || autoAttachPending || pauseViewPersistence) return;
  let server: string;
  try {
    server = normalizeOpenViewsServer(endpoint);
  } catch {
    return;
  }
  const views = [...surfaces.values()].map((surface) => ({
    paneId: surface.pane.id,
    workspaceId: surface.pane.workspaceId,
    sessionId: surface.pane.sessionId,
    windowId: surface.pane.windowId,
    title: surface.pane.title,
    ...(scene.captureTerminalPose(surface.pane.id)
      ? { pose: scene.captureTerminalPose(surface.pane.id) ?? undefined }
      : {}),
  }));
  if (!openViewsStore.save(server, { views, selectedId }))
    scene.setNotice('Open terminal views could not be saved on this device.');
}
function withoutViewPersistence(action: () => void): void {
  pauseViewPersistence++;
  try {
    action();
  } finally {
    pauseViewPersistence--;
  }
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
      if (selectedId === id)
        ui.setConnection(surface.status, `${pane.title} · ${surface.error ?? surface.status}`);
      ui.setPaneStatus?.(id, surface.status);
      ui.setTerminalGrid(id, surface.cols, surface.rows, surface.canResizeGrid);
    });
    surface.setColorMode(ui.getSettings().colorMode);
    ui.setTerminalGrid(id, surface.cols, surface.rows, surface.canResizeGrid);
    surface.connect();
    ui.setPaneStatus?.(id, surface.status);
    ui.setAttachedPaneIds([...surfaces.keys()]);
  }
  surfaces.get(id)?.acknowledgeBell?.();
  if (selectedId === id) return;
  selectedId = id;
  speechInput?.dispatch('cancel');
  ui.setActivePane(id);
  desktop.select(id);
  syncCommands();
  scene.selectTerminal(id);
  const surface = surfaces.get(id);
  if (surface)
    ui.setConnection(surface.status, `${pane.title} · ${surface.error ?? surface.status}`);
  persistOpenViews();
}

function closePane(id: string): void {
  if (selectedId === id) speechInput?.dispatch('cancel');
  desktop.remove(id);
  scene.removeTerminal(id);
  surfaces.get(id)?.dispose();
  surfaces.delete(id);
  if (selectedId === id) selectedId = null;
  ui.setAttachedPaneIds([...surfaces.keys()]);
  const next = surfaces.keys().next().value;
  if (next && !selectedId) selectPane(next);
  else if (!selectedId) {
    ui.setActivePane(undefined);
    desktop.select(null);
    scene.selectTerminal(null);
    syncCommands();
    ui.setConnection('idle', 'Choose a pane to open a terminal view.');
  }
  persistOpenViews();
}

function togglePaneConnection(id: string): void {
  const surface = surfaces.get(id);
  if (!surface) return;
  if (surface.status === 'connected' || surface.status === 'connecting') surface.disconnect();
  else surface.connect();
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

function sendMouse(id: string, input: TerminalMouseInput): boolean {
  if (input.eventType === 'press') selectPane(id);
  return surfaces.get(id)?.sendMouse?.(input) ?? false;
}

function runCommand(command: QuickCommand, paneId: string): void {
  const result = executeQuickCommand(surfaces.get(paneId), command);
  if (result === 'unavailable') {
    notice('The command target is unavailable. Select a connected terminal.');
    return;
  }
  if (result === 'enter-failed') notice('Connection lost before Enter was sent.');
  ui.recordCommandRun(command.id);
  syncCommands();
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
    scene.setKeyboardCurvature(settings.keyboardCurvature);
    scene.setGazeInputEnabled(settings.gazeInput);
    scene.setTerminalFiltering(settings.filtering);
    scene.setWindowPreferences(settings.windowPreferences);
    scene.setHierarchyStyle(settings.hierarchyStyle);
    scene.setKeyborbMode(settings.keyborbMode);
    scene.setUISounds(settings.uiSounds);
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

function applySnapshot(next: WorkspaceSnapshot, authoritative = true): void {
  withoutViewPersistence(() => {
    snapshot = next;
    ui.update(next);
    scene.setAvailablePanes(next.panes);
    const valid = new Set(next.panes.map((pane) => pane.id));
    for (const id of [...surfaces.keys()]) if (!valid.has(id)) closePane(id);
    if (authoritative && !demo) paneCreator.observeSnapshot(next.panes);
    if (autoAttachPending && authoritative && (next.panes.length || pendingOpenViews !== null)) {
      autoAttachPending = false;
      if (!demo && pendingOpenViews !== null) {
        const resolved = resolveOpenViews(pendingOpenViews, next.panes);
        for (const view of resolved.views) {
          selectPane(view.paneId);
          if (view.pose) scene.restoreTerminalPose(view.paneId, view.pose);
        }
        if (resolved.selectedId) selectPane(resolved.selectedId);
        else if (resolved.views.length) selectPane(resolved.views[0].paneId);
        if (resolved.missing.length) {
          const ids = resolved.missing.map((view) => view.paneId).join(', ');
          const message = `${resolved.missing.length} saved terminal${resolved.missing.length === 1 ? ' is' : 's are'} no longer in mux: ${ids.slice(0, 100)}.`;
          pendingRestoreNotice = scene.state.xrMode === 'desktop' ? message : null;
          scene.setNotice(message);
        }
        if (!resolved.views.length)
          ui.setConnection('idle', 'No terminal views open. Choose a pane.');
        pendingOpenViews = null;
      } else {
        const initial = initialPaneSelection(next.panes);
        for (const pane of initial.panes) selectPane(pane.id);
        if (initial.activeId) selectPane(initial.activeId);
      }
    }
  });
  persistOpenViews();
}

function startDemo(): void {
  persistOpenViews();
  generation += 1;
  withoutViewPersistence(detachAll);
  pendingOpenViews = null;
  pendingRestoreNotice = null;
  demo = true;
  autoAttachPending = true;
  paneCreator.reset();
  ui.setDemoMode(true);
  applySnapshot(demoSnapshot);
  ui.setConnection('connected', 'Demo preview · synthetic terminals');
}

async function connect(nextEndpoint: string): Promise<void> {
  persistOpenViews();
  const current = ++generation;
  withoutViewPersistence(detachAll);
  demo = false;
  autoAttachPending = true;
  pendingRestoreNotice = null;
  endpoint = nextEndpoint;
  paneCreator.reset();
  try {
    pendingOpenViews = openViewsStore.read(normalizeOpenViewsServer(endpoint));
  } catch {
    pendingOpenViews = null;
  }
  applySnapshot({ panes: [] }, false);
  ui.setDemoMode(false);
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
  removeCommand: (id) => ui.deleteCommand(id),
  reloadApp: () => {
    void reloadApp();
  },
  selectPane,
  closePane,
  createPane,
  togglePaneConnection,
  sendText: (text) => {
    if (selectedId) sendText(selectedId, text);
  },
  sendKey: (key, modifiers) => {
    if (selectedId) sendKey(selectedId, key, modifiers);
  },
  runCommand,
  sendMouse,
  scrollTerminal: (id, lines, cell) => surfaces.get(id)?.scroll?.(lines, cell) ?? false,
  openCommands: () => {
    syncCommands();
    ui.openInput('commands');
  },
  openKeyboard: () => ui.openInput('keyboard'),
  setXREntryMode: (mode) => {
    xrEntryMode = mode;
    ui.setXREntryMode(mode);
  },
  exitPreview: () => desktop.showTerminals(),
  resizeGrid,
  setTerminalColorMode,
  setKeyboardBackground,
  dictationAction: (action: DictationAction) => speechInput?.dispatch(action),
  editDictation: (text: string) => speechInput?.editDraft(text),
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
  onCreatePane: createPane,
  onClosePane: (pane) => closePane(pane.id),
  onTogglePaneConnection: (pane) => togglePaneConnection(pane.id),
  onSendText: sendText,
  onPaste: (id) => {
    void scene.pasteClipboard(id);
  },
  onSendKey: sendKey,
  onRunCommand: runCommand,
  onResizeGrid: resizeGrid,
  onCommandsChange: syncCommands,
  onEnterXR: () => {
    void enterXR(xrEntryMode);
  },
  onPassthrough: () => {
    void enterXR('ar');
  },
  onSettingsChange: applySettings,
  onTerminalCurvature: (id, degrees) => scene.setTerminalCurvature(id, degrees),
  onTerminalOpacity: (id, opacity) => scene.setTerminalOpacity(id, opacity / 100),
  onDismissNotice: () => {
    pendingRestoreNotice = null;
    scene.setNotice(null);
  },
  onResetLayout: () => scene.resetLayout(),
  onArrange: (pattern) => {
    desktop.showPreview();
    scene.arrangeTerminals(pattern);
  },
  onWidgets: () => {
    desktop.showPreview();
    scene.showInput('widgets');
  },
  onMoveLayout: (direction) => {
    desktop.showPreview();
    scene.moveLayoutDepth(direction);
  },
  onDemo: startDemo,
  onDictationAction: (action) => speechInput?.dispatch(action),
  onDictationDraftChange: (text) => speechInput?.editDraft(text),
});
scene = createWorkspaceScene(ui.sceneHost, actions);
publishPaneCreation(paneCreator.state);
speechInput = createSpeechInput({
  recognitionFactory: isLocalSpeechSupported()
    ? () => {
        const url = new URL('/dictate', window.location.href);
        url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        url.port = '4242';
        return createLocalSpeechRecognition(url.href);
      }
    : undefined,
  getTargetPaneId: () => selectedId,
  canInsert: (target) => selectedId === target && surfaces.get(target)?.status === 'connected',
  onInsert: (target, text) => surfaces.get(target)?.sendText(text) ?? false,
  onState: (state: DictationState) => {
    ui.setDictationState(state);
    scene.setDictationState(state);
  },
});
xrEntry = createXREntryController({
  enter: async (mode) => {
    enteringXR = true;
    try {
      await scene.enterXR(mode);
      scene.setNotice(pendingRestoreNotice);
      pendingRestoreNotice = null;
    } finally {
      enteringXR = false;
      maybeReloadUpdate();
    }
  },
  isActive: () => scene.state.xrMode !== 'desktop',
  onError: (error) => notice(error instanceof Error ? error.message : 'Could not enter XR.'),
  onActivationRequired: () =>
    scene.setNotice('Automatic XR entry was blocked. Select Enter XR to continue.'),
  xr: navigator.xr,
  eventTarget: window,
  userActivation: () => navigator.userActivation?.isActive ?? false,
});
desktop = createDesktopPanels(ui.sceneHost, selectPane, {
  onClose: closePane,
  onToggleConnection: togglePaneConnection,
  onMouse: sendMouse,
  onScale: (direction) => scene.scaleSelectedPanel(direction),
  onReset: () => scene.resetLayout(),
});
const stopPresentation = scene.subscribe((state) => {
  if (!applyingSettings) {
    ui.setGazeInputEnabled(state.gazeInputEnabled);
    ui.setKeyboardBackgroundEnabled(state.keyboardBackgroundEnabled, false);
    ui.setKeyboardCurvature(state.keyboardCurvature, true);
    ui.setTerminalColorMode(state.terminalColorMode, false);
    ui.setTerminalFiltering(state.filtering, true);
    ui.setWindowPreferences(state.windowPreferences, true);
    ui.setHierarchyStyle(state.hierarchyStyle, true);
    ui.setKeyborbMode(state.keyborbMode, true);
    ui.setUISounds(state.uiSounds, true);
    ui.setFilteringCapabilities(Number(scene.scene.userData.maxAnisotropy ?? 1));
    for (const id of surfaces.keys()) {
      ui.setTerminalCurvature(id, scene.getTerminalCurvature(id));
      ui.setTerminalOpacity(id, scene.getTerminalOpacity(id) * 100);
    }
    if (state.arrangement && state.arrangement !== ui.getSettings().arrangement)
      ui.setArrangement(state.arrangement);
  }
  ui.setNotice(state.notice);
  ui.setToast(state.toast);
  if (state.layoutRevision !== lastLayoutRevision) {
    lastLayoutRevision = state.layoutRevision;
    persistOpenViews();
  }
  desktop.setImmersive(state.xrMode !== 'desktop');
  if (state.xrMode !== 'desktop') ui.closeInput();
  maybeReloadUpdate();
});
applySettings(ui.getSettings());
void loadSharedCommands(new URL('quick-commands.json', window.location.href).href).then(
  (commands) => {
    if (!commands.length) return;
    ui.setSharedCommands(commands);
    syncCommands();
  },
);
void loadObservatory(scene, environmentAbort.signal)
  .then((dispose) => {
    disposeEnvironment = dispose;
  })
  .catch((error: unknown) => {
    console.warn('Observatory unavailable; using the lightweight background.', error);
  });
if (scene.state.rendererError) notice(scene.state.rendererError);
void xrEntry.enableAutoStart().catch(() => undefined);

const params = new URLSearchParams(location.search);
if (params.get('demo') === '1') startDemo();
else if (params.get('server')) void connect(params.get('server') ?? '');
else if (ui.getSettings().endpoint.trim()) void connect(ui.getSettings().endpoint.trim());

window.addEventListener(
  'pagehide',
  () => {
    if (scene.state.xrMode !== 'desktop') scene.captureWorkspaceState();
    persistOpenViews();
    xrEntry.dispose();
    updateChecker?.dispose();
    environmentAbort.abort();
    speechInput?.dispose();
    withoutViewPersistence(detachAll);
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
        mouseTracking: surface.mouseTracking ?? 'none',
        renderQuality: surface.renderQuality ?? 'full',
        canvasWidth: surface.canvas.width,
        canvasHeight: surface.canvas.height,
      })),
    }),
    getControlHints: () => scene.getControlHints(),
    checkForUpdate: () => updateChecker?.poll() ?? Promise.resolve(),
    startDemo,
    connect,
    selectPane,
    closePane,
    togglePaneConnection,
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
