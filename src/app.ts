import type { KeyModifiers, QuickCommand, TerminalMouseInput, WorkspaceActions } from './contracts';
import { createDebugApi, installDebugApi } from './debug-api';
import { createDemoSurface, demoAgents, demoSnapshot } from './demo';
import { createDesktopPanels } from './desktop/panels';
import { createEnvironmentManager, loadObservatory } from './environment';
import { createHostClipboardClient, createHostClipboardSecretStore } from './host-clipboard';
import { createDefaultPictureDepth } from './host-picture-depth';
import { hostServiceUrl } from './host-service';
import { createToastSubscription } from './host-toasts';
import { createKeyFlash, formatKeyIndicator, mountPageKeyIndicator } from './key-indicator';
import { installKeyboardRouter } from './keyboard-router';
import { createLocalSpeechRecognition, isLocalSpeechSupported } from './local-speech';
import {
  createIndexedDBPictureStorage,
  createIndexedDBRecentPictureStorage,
  createPictureLibrary,
  createRecentPictureLibrary,
} from './pictures/picture-store';
import { executeQuickCommand, loadSharedCommands } from './quick-commands';
import { reloadAfterXR } from './reload';
import {
  agentRosterLayout,
  browserStorage,
  createSettingsStore,
  type SettingsStore,
} from './settings/store';
import {
  createSpeechInput,
  type DictationAction,
  type DictationState,
  type SpeechInput,
} from './speech-input';
import { createTerminalSurface } from './terminal';
import { mountWorkspaceUI } from './ui';
import { mountPicturePicker } from './ui/pictures';
import { createUpdateChecker, type UpdateChecker } from './update-check';
import { shouldAutoReload } from './update-policy';
import {
  type AgentRosterLayout,
  agentRosterRows,
  createAgentRosterStore,
  sortAgentRows,
} from './workspace/agent-roster';
import { createOpenViewsStore } from './workspace/open-views';
import { createPaneController } from './workspace/pane-controller';
import {
  createPaneCreator,
  PANE_CREATE_WINDOW_NAME,
  type PaneCreationState,
  requestPaneCreate,
} from './workspace/pane-create';
import { createPictureController } from './workspace/pictures';
import { createWorkspaceScene } from './xr';
import { createXREntryController, type XrEntryMode } from './xr/entry';

export interface AppDeps {
  /** The device settings shared by the browser UI and the XR scene; a store over `localStorage` when omitted. */
  settings?: SettingsStore;
}

export interface App {
  /** Tears down every presenter and listener; safe to call twice. */
  dispose(): void;
  connect(endpoint: string): Promise<void>;
  startDemo(): void;
  /** The endpoint saved in the settings, trimmed; empty when none is saved. */
  savedEndpoint(): string;
  /** Fills the endpoint field without connecting and shows `message`. */
  proposeEndpoint(endpoint: string, message: string): void;
}

const DEMO_CREATION: PaneCreationState = {
  available: false,
  pending: false,
  reason: 'The demo preview cannot create terminals. Connect to a streamer.',
};

/** Host part of an endpoint for status text; falls back to the raw value when unparseable. */
function endpointHostLabel(value: string): string {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

/**
 * Builds the workspace: the settings store, then the browser UI, the XR scene and the desktop
 * panels, then the pane controller that drives all three. Every callback below reaches a later
 * binding only when it runs, and nothing runs before this function returns.
 */
export function createApp(root: HTMLElement, deps: AppDeps = {}): App {
  const runningBuildId =
    document.querySelector<HTMLMetaElement>('meta[name="build-fingerprint"]')?.content ??
    'development';
  const settingsStore = deps.settings ?? createSettingsStore(browserStorage());
  const agentRoster = createAgentRosterStore();
  const environmentAbort = new AbortController();
  let rosterLayout: AgentRosterLayout = agentRosterLayout(settingsStore.get());
  let stopMetadata: (() => void) | undefined;
  let refreshMetadata: (() => void) | undefined;
  let lastLayoutRevision = 0;
  let pendingRestoreNotice: string | null = null;
  let disposeEnvironment: (() => void) | undefined;
  let updateChecker: UpdateChecker | undefined;
  let reloading = false;
  let updateAvailable = false;
  let enteringXR = false;
  let xrEntryMode: XrEntryMode = 'vr';
  let disposed = false;

  const hostClipboardSecret = createHostClipboardSecretStore();
  const hostClipboard = createHostClipboardClient({
    url: () => hostServiceUrl('/clipboard', window.location),
    secret: () => hostClipboardSecret.get(),
  });
  // Toasts outside programs post to the host service; it needs the host clipboard pairing secret.
  // Declared first because the UI and scene callbacks below stop, start and dismiss through it.
  const toastSubscription = createToastSubscription({
    url: () => hostServiceUrl('/toasts', window.location),
    secret: () => hostClipboardSecret.get(),
    onEnvelope: (envelope) => scene.receiveToast(envelope),
  });

  const paneCreator = createPaneCreator({
    request: (anchorPaneId, sessionId, token, signal) => {
      const current = panes.generation;
      return requestPaneCreate(panes.endpoint, anchorPaneId, sessionId, {
        signal,
        name: PANE_CREATE_WINDOW_NAME,
        onLateReply: (outcome) => {
          if (current === panes.generation) paneCreator.lateReply(outcome, token);
        },
      });
    },
    refreshTree: () => refreshMetadata?.(),
    attach: (paneId) => {
      panes.selectPane(paneId);
      scene.closePaneSelector();
    },
    notify: (message) => scene.setNotice(message),
    onChange: (state) => publishPaneCreation(panes.demo ? DEMO_CREATION : state),
  });

  const syncAgentRoster = (): void => {
    const rows = agentRosterRows(
      panes.demo ? demoAgents : agentRoster.entries(),
      panes.snapshot.panes,
    );
    ui.setAgentRoster(sortAgentRows(rows, rosterLayout.sort));
    // XR keeps pane order: a re-sort after a state change would move a node under the ray.
    scene.setAgentRoster(rows, rosterLayout);
  };

  const publishPaneCreation = (state: PaneCreationState): void => {
    ui.setPaneCreation(state);
    scene.setPaneCreation(state);
  };

  const createPane = (sessionId: string): void => {
    if (panes.demo) {
      scene.setNotice(DEMO_CREATION.reason ?? null);
      return;
    }
    paneCreator.create(sessionId, panes.snapshot.panes);
  };

  const maybeReloadUpdate = (): void => {
    if (shouldAutoReload(updateAvailable, scene.state.xrMode, enteringXR)) void reloadApp();
  };

  const enterXR = async (mode: XrEntryMode): Promise<void> => {
    await xrEntry.start(mode).catch(() => undefined);
  };

  const reloadApp = async (): Promise<void> => {
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
  };

  /** `feed` records the notice in the XR bell feed; pass it only for errors the user did not just cause. */
  const notice = (message: string, feed = false): void => {
    ui.setConnection('disconnected', message);
    scene.setNotice(message, { feed });
  };

  const syncCommands = (): void => {
    scene.setQuickCommands(panes.selectedId ? ui.getCommandsForPane(panes.selectedId) : []);
  };

  const sendKey = (id: string, key: string, modifiers?: KeyModifiers): boolean => {
    const sent = panes.get(id)?.sendKey(key, modifiers) ?? false;
    if (!sent) notice('Terminal is disconnected. Reconnect before sending input.');
    else scene.setNotice(null);
    return sent;
  };

  const sendText = (id: string, text: string): void => {
    if (!panes.get(id)?.sendText(text))
      notice('Terminal is disconnected. Reconnect before sending input.');
  };

  const sendMouse = (id: string, input: TerminalMouseInput): boolean => {
    if (input.eventType === 'press') panes.selectPane(id);
    return panes.get(id)?.sendMouse?.(input) ?? false;
  };

  const runCommand = (command: QuickCommand, paneId: string): void => {
    const result = executeQuickCommand(panes.get(paneId), command);
    if (result === 'unavailable') {
      notice('The command target is unavailable. Select a connected terminal.');
      return;
    }
    if (result === 'enter-failed') notice('Connection lost before Enter was sent.');
    ui.recordCommandRun(command.id);
    syncCommands();
  };

  const resizeGrid = (paneId: string, cols: number, rows: number): boolean =>
    panes.get(paneId)?.resizeGrid(cols, rows) ?? false;

  const detach = (): void => {
    stopMetadata?.();
    stopMetadata = undefined;
    refreshMetadata = undefined;
    panes.closeAll();
  };

  const startDemo = (): void => {
    panes.persistOpenViews();
    panes.beginDemo();
    panes.quietly(detach);
    pendingRestoreNotice = null;
    agentRoster.clear();
    paneCreator.reset();
    ui.setDemoMode(true);
    panes.applySnapshot(demoSnapshot);
    ui.setConnection('connected', 'Demo preview · synthetic terminals');
  };

  const connect = async (nextEndpoint: string): Promise<void> => {
    panes.persistOpenViews();
    const current = panes.beginConnection(nextEndpoint);
    panes.quietly(detach);
    agentRoster.clear();
    pendingRestoreNotice = null;
    paneCreator.reset();
    panes.applySnapshot({ panes: [] }, { authoritative: false });
    ui.setDemoMode(false);
    ui.setConnection('connecting', `Connecting to ${endpointHostLabel(nextEndpoint)}…`);
    try {
      const { connectHierarchy } = await import('./workspace/hierarchy');
      const connection = await connectHierarchy(
        nextEndpoint,
        (next) => panes.applySnapshot(next, { generation: current }),
        (message) => {
          if (current === panes.generation) notice(message, true);
        },
        {
          replace: (entries) => {
            if (current === panes.generation) agentRoster.replace(entries);
          },
          apply: (entry, released) => {
            if (current === panes.generation) agentRoster.apply(entry, released);
          },
        },
      );
      if (current !== panes.generation) connection.disconnect();
      else {
        stopMetadata = connection.disconnect;
        refreshMetadata = connection.refresh;
      }
    } catch (error) {
      if (current === panes.generation)
        notice(error instanceof Error ? error.message : 'Connection failed', true);
    }
  };

  const actions: WorkspaceActions = {
    readHostClipboard: () => hostClipboard.read(),
    writeHostClipboard: (text) => hostClipboard.write(text),
    saveCommand: (command) => ui.addCommand(command),
    removeCommand: (id) => ui.deleteCommand(id),
    reloadApp: () => {
      void reloadApp();
    },
    selectPane: (id) => panes.selectPane(id),
    closePane: (id) => panes.closePane(id),
    createPane,
    togglePaneConnection: (id) => panes.toggleConnection(id),
    sendText: (text) => {
      if (panes.selectedId) sendText(panes.selectedId, text);
    },
    sendKey: (key, modifiers) => {
      if (panes.selectedId) sendKey(panes.selectedId, key, modifiers);
    },
    runCommand,
    sendMouse,
    scrollTerminal: (id, lines, cell) => panes.get(id)?.scroll?.(lines, cell) ?? false,
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
    setTerminalColorMode: (mode) => ui.setTerminalColorMode(mode),
    setKeyboardBackground: (enabled) => ui.setKeyboardBackgroundEnabled(enabled),
    dictationAction: (action: DictationAction) => speechInput.dispatch(action),
    editDictation: (text: string) => speechInput.editDraft(text),
  };

  const ui = mountWorkspaceUI(
    root,
    {
      onReloadApp: () => {
        void reloadApp();
      },
      onConnect: (value) => {
        void connect(value);
      },
      onRefresh: () => refreshMetadata?.(),
      onSelectPane: (pane) => panes.selectPane(pane.id),
      onCreatePane: createPane,
      onClosePane: (pane) => panes.closePane(pane.id),
      onTogglePaneConnection: (pane) => panes.toggleConnection(pane.id),
      onSendText: sendText,
      onPaste: (id) => {
        void scene.pasteClipboard(id);
      },
      onHostToQuest: () => {
        void scene.copyHostToQuest();
      },
      onQuestToHost: () => {
        void scene.copyQuestToHost();
      },
      isHostClipboardPaired: () => hostClipboardSecret.get() !== null,
      onHostClipboardSecret: (secret) => {
        let saved = true;
        if (secret === null) hostClipboardSecret.forget();
        else saved = hostClipboardSecret.set(secret);
        // Resubscribe at once with the new secret instead of waiting out a refusal's backoff.
        toastSubscription.stop();
        toastSubscription.start();
        return saved;
      },
      onSendKey: sendKey,
      onRunCommand: runCommand,
      onResizeGrid: resizeGrid,
      onCommandsChange: syncCommands,
      onEnterXR: () => {
        void enterXR(xrEntryMode);
      },
      onPassthrough: (mode) => {
        void enterXR(mode);
      },
      onTerminalCurvature: (id, degrees) => scene.setTerminalCurvature(id, degrees),
      onTerminalOpacity: (id, opacity) => scene.setTerminalOpacity(id, opacity / 100),
      onTerminalReset: (id) => scene.resetTerminalAppearance(id),
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
      onDictationAction: (action) => speechInput.dispatch(action),
      onDictationDraftChange: (text) => speechInput.editDraft(text),
    },
    { settings: settingsStore },
  );
  const pictures = createPictureController({
    library: createPictureLibrary(createIndexedDBPictureStorage()),
    recent: createRecentPictureLibrary(createIndexedDBRecentPictureStorage()),
    scene: () => scene,
    notify: (message) => scene.notifyPicture(message),
    depth: createDefaultPictureDepth(),
  });
  const scene = createWorkspaceScene(ui.sceneHost, actions, {
    onToastDismissed: (id) => toastSubscription.dismiss(id),
    onPictureClosed: (id) => pictures.closed(id),
    onPictureDepthView: (id, view) => pictures.setDepthView(id, view),
    pictures,
    settings: settingsStore,
  });
  const desktop = createDesktopPanels(ui.sceneHost, (id) => panes.selectPane(id), {
    onClose: (id) => panes.closePane(id),
    onToggleConnection: (id) => panes.toggleConnection(id),
    onMouse: sendMouse,
    onScale: (direction) => scene.scaleSelectedPanel(direction),
    onReset: () => scene.resetLayout(),
  });

  // Presenter order is the order each pane event reaches the views: UI, desktop panels, scene.
  const panes = createPaneController({
    createSurface: (pane, source) =>
      source.demo ? createDemoSurface(pane) : createTerminalSurface(source.endpoint, pane),
    colorMode: () => settingsStore.get().colorMode,
    openViews: createOpenViewsStore(),
    capturePose: (id) => scene.captureTerminalPose(id),
    restorePose: (id, pose) => scene.restoreTerminalPose(id, pose),
    cancelPendingInput: () => speechInput.dispatch('cancel'),
    notify: (message) => scene.setNotice(message),
    reportMissingViews: (message) => {
      pendingRestoreNotice = scene.state.xrMode === 'desktop' ? message : null;
      scene.setNotice(message, { feed: true });
    },
    observeSnapshot: (list) => paneCreator.observeSnapshot(list),
    presenters: [
      {
        paneChanged(surface, selected) {
          if (selected)
            ui.setConnection(
              surface.status,
              `${surface.pane.title} · ${surface.error ?? surface.status}`,
            );
          ui.setPaneStatus?.(surface.pane.id, surface.status, surface.process);
          ui.setTerminalGrid(surface.pane.id, surface.cols, surface.rows, surface.canResizeGrid);
          if (!panes.demo) paneCreator.observeCapability(surface.paneCreateAllowed);
        },
        attachedChanged: (ids) => ui.setAttachedPaneIds(ids),
        snapshotChanged(next) {
          ui.update(next);
          syncAgentRoster();
        },
        select(surface) {
          ui.setActivePane(surface?.pane.id);
          if (surface)
            ui.setConnection(
              surface.status,
              `${surface.pane.title} · ${surface.error ?? surface.status}`,
            );
        },
        idle: (message) => ui.setConnection('idle', message),
      },
      {
        addPane: (surface) => desktop.add(surface),
        removePane: (id) => desktop.remove(id),
        select: (surface) => desktop.select(surface?.pane.id ?? null),
      },
      {
        addPane: (surface) => scene.addTerminal(surface),
        removePane: (id) => scene.removeTerminal(id),
        snapshotChanged: (next) => scene.setAvailablePanes(next.panes),
        select(surface) {
          if (surface) {
            syncCommands();
            scene.selectTerminal(surface.pane.id);
          } else {
            scene.selectTerminal(null);
            syncCommands();
          }
        },
      },
    ],
  });

  toastSubscription.start();
  const setPageKey = mountPageKeyIndicator(document.body);
  const keyFlash = createKeyFlash((text) => {
    setPageKey(text);
    scene.setKeyIndicator(text?.replace('⌨', 'Key') ?? null);
  });
  const disposeKeyboardRouter = installKeyboardRouter(document, {
    selectedPaneId: () => panes.selectedId,
    isConnected: (id) => panes.get(id)?.status === 'connected',
    applicationCursor: (id) => panes.get(id)?.applicationCursor ?? false,
    sendBytes: sendText,
    textEntryActive: () => scene.isTextEntryActive(),
    typeTextEntry: (key) => scene.typeTextEntryKey(key),
    xrPresenting: () => scene.state.xrMode !== 'desktop',
    xrEntryFallbackArmed: () => xrEntry.isFallbackArmed(),
    onKey: (label, sent) => keyFlash.flash(formatKeyIndicator(label, sent)),
  });
  const sidebar = root.querySelector<HTMLElement>('.sidebar');
  if (sidebar)
    mountPicturePicker(sidebar, {
      onFile: (file) => pictures.addFile(file),
      onUrl: (url) => pictures.addUrl(url),
    });
  void pictures.restore();
  publishPaneCreation(paneCreator.state);
  const stopRoster = agentRoster.subscribe(syncAgentRoster);
  const speechInput: SpeechInput = createSpeechInput({
    recognitionFactory: isLocalSpeechSupported()
      ? () => createLocalSpeechRecognition(hostServiceUrl('/dictate', window.location))
      : undefined,
    getTargetPaneId: () => panes.selectedId,
    canInsert: (target) => panes.selectedId === target && panes.get(target)?.status === 'connected',
    onInsert: (target, text) => panes.get(target)?.sendText(text) ?? false,
    onState: (state: DictationState) => {
      ui.setDictationState(state);
      scene.setDictationState(state);
    },
  });
  const xrEntry = createXREntryController({
    enter: async (mode) => {
      enteringXR = true;
      try {
        await scene.enterXR(mode);
        xrEntryMode = 'vr';
        ui.setXREntryMode('vr');
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
      scene.setNotice('Automatic XR entry was blocked. Select Enter XR to continue.', {
        feed: true,
      }),
    xr: navigator.xr,
    eventTarget: window,
    userActivation: () => navigator.userActivation?.isActive ?? false,
  });
  const stopPresentation = scene.subscribe((state) => {
    for (const surface of panes.surfaces()) {
      ui.setTerminalCurvature(surface.pane.id, scene.getTerminalCurvature(surface.pane.id));
      ui.setTerminalOpacity(surface.pane.id, scene.getTerminalOpacity(surface.pane.id) * 100);
    }
    if (state.arrangement && state.arrangement !== settingsStore.get().arrangement)
      ui.setArrangement(state.arrangement);
    ui.setNotice(state.notice);
    ui.setToast(state.toast);
    if (state.layoutRevision !== lastLayoutRevision) {
      lastLayoutRevision = state.layoutRevision;
      panes.persistOpenViews();
    }
    desktop.setImmersive(state.xrMode !== 'desktop');
    if (state.xrMode !== 'desktop') ui.closeInput();
    maybeReloadUpdate();
  });
  ui.setFilteringCapabilities(scene.maxAnisotropy);
  // Terminal color mode and the roster layout are the only settings the scene does not present.
  const stopSettingsSync = settingsStore.subscribe((next, previous) => {
    if (next.colorMode !== previous.colorMode)
      for (const surface of panes.surfaces()) surface.setColorMode(next.colorMode);
    if (
      next.agentRows !== previous.agentRows ||
      next.agentRowsCustom !== previous.agentRowsCustom ||
      next.agentsSort !== previous.agentsSort
    ) {
      rosterLayout = agentRosterLayout(next);
      syncAgentRoster();
    }
  });
  void loadSharedCommands(new URL('quick-commands.json', window.location.href).href).then(
    (commands) => {
      if (!commands.length) return;
      ui.setSharedCommands(commands);
      syncCommands();
    },
  );
  const disposeEnvironmentManager = createEnvironmentManager(scene);
  void loadObservatory(scene, environmentAbort.signal)
    .then((dispose) => {
      disposeEnvironment = dispose;
    })
    .catch((error: unknown) => {
      console.warn('Observatory unavailable; using the lightweight background.', error);
    });
  if (scene.state.rendererError) notice(scene.state.rendererError);
  void xrEntry.enableAutoStart().catch(() => undefined);

  installDebugApi(
    createDebugApi({
      buildId: runningBuildId,
      scene,
      panes,
      checkForUpdate: () => updateChecker?.poll() ?? Promise.resolve(),
      startDemo,
      connect,
    }),
  );

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

  return {
    connect,
    startDemo,
    savedEndpoint: () => settingsStore.get().endpoint.trim(),
    proposeEndpoint(endpoint, message) {
      ui.setEndpointDraft(endpoint);
      notice(message);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (scene.state.xrMode !== 'desktop') scene.captureWorkspaceState();
      panes.persistOpenViews();
      xrEntry.dispose();
      disposeKeyboardRouter();
      keyFlash.dispose();
      updateChecker?.dispose();
      environmentAbort.abort();
      speechInput.dispose();
      toastSubscription.stop();
      panes.quietly(detach);
      stopRoster();
      stopPresentation();
      stopSettingsSync();
      desktop.dispose();
      disposeEnvironment?.();
      disposeEnvironmentManager();
      scene.dispose();
      ui.destroy();
    },
  };
}
