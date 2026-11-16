import type {
  PaneDescriptor,
  TerminalColorMode,
  TerminalSurface,
  WorkspaceSnapshot,
} from '../contracts';
import { reportSwallowed } from '../diagnostics';
import type { SavedUIPose } from '../xr/ui-poses';
import { initialPaneSelection } from './initial';
import { normalizeOpenViewsServer, type OpenViewsProfile, resolveOpenViews } from './open-views';

/**
 * One view of the open panes: the browser UI, the desktop panels or the XR scene. The controller
 * calls every presenter, in array order, and a presenter implements only the hooks it needs.
 */
export interface PanePresenter {
  /** A surface was created for a pane, before it connects. */
  addPane?(surface: TerminalSurface): void;
  removePane?(id: string): void;
  /** The selection moved to `surface`, or to nothing. */
  select?(surface: TerminalSurface | null): void;
  /** A surface changed status or size, or finished connecting for the first time. */
  paneChanged?(surface: TerminalSurface, selected: boolean): void;
  /** The attached set changed; ids are in attach order. */
  attachedChanged?(ids: string[]): void;
  /** The pane tree changed. Not called for a stale connection's snapshot. */
  snapshotChanged?(snapshot: WorkspaceSnapshot): void;
  /** No pane is open, with the text to show for it. */
  idle?(message: string): void;
}

export interface OpenViewsPort {
  read(serverKey: string): OpenViewsProfile | null;
  save(serverKey: string, profile: OpenViewsProfile): boolean;
}

export interface PaneControllerDeps {
  createSurface(pane: PaneDescriptor, source: { demo: boolean; endpoint: string }): TerminalSurface;
  colorMode(): TerminalColorMode;
  presenters: readonly PanePresenter[];
  openViews: OpenViewsPort;
  capturePose(paneId: string): SavedUIPose | null;
  restorePose(paneId: string, pose: SavedUIPose): void;
  /** Called when the selection is about to change or its pane is about to close. */
  cancelPendingInput(): void;
  /** Reports a pane that could not be opened. */
  notify(message: string): void;
  /** Saved views that no longer exist in mux, as one sentence. */
  reportMissingViews(message: string): void;
  /** An authoritative live snapshot arrived and stale panes are closed. Not called for the demo. */
  observeSnapshot?(panes: PaneDescriptor[]): void;
}

export interface SnapshotOptions {
  /** False for the empty placeholder shown while connecting. Defaults to true. */
  authoritative?: boolean;
  /** The generation the snapshot belongs to; a snapshot from an older one is ignored. */
  generation?: number;
}

export interface PaneController {
  readonly selectedId: string | null;
  readonly snapshot: WorkspaceSnapshot;
  readonly endpoint: string;
  readonly demo: boolean;
  readonly generation: number;
  get(id: string): TerminalSurface | undefined;
  /** Attached pane ids in attach order. */
  ids(): string[];
  /** Attached surfaces in attach order. */
  surfaces(): TerminalSurface[];
  /** Starts a live connection: bumps the generation and loads the saved views for `endpoint`. */
  beginConnection(endpoint: string): number;
  /** Starts the demo preview: bumps the generation and drops saved views. */
  beginDemo(): number;
  applySnapshot(next: WorkspaceSnapshot, options?: SnapshotOptions): void;
  selectPane(id: string): void;
  closePane(id: string): void;
  /** Closes every pane and clears the selection. */
  closeAll(): void;
  toggleConnection(id: string): void;
  /** Saves the open views for the live server; no-op in the demo, before attach and while paused. */
  persistOpenViews(): void;
  /** Runs `action` with open-view persistence paused, so closing panes does not overwrite the saved set. */
  quietly(action: () => void): void;
}

export function createPaneController(deps: PaneControllerDeps): PaneController {
  const surfaces = new Map<string, TerminalSurface>();
  const unsubscribes = new Map<string, () => void>();
  let snapshot: WorkspaceSnapshot = { panes: [] };
  let selectedId: string | null = null;
  let endpoint = '';
  let demo = false;
  let generation = 0;
  let autoAttachPending = true;
  let pendingOpenViews: OpenViewsProfile | null = null;
  let pauseViewPersistence = 0;

  const each = (call: (presenter: PanePresenter) => void): void => {
    for (const presenter of deps.presenters) call(presenter);
  };
  const attachedIds = (): string[] => [...surfaces.keys()];

  function persistOpenViews(): void {
    if (demo || !endpoint || autoAttachPending || pauseViewPersistence) return;
    let server: string;
    try {
      server = normalizeOpenViewsServer(endpoint);
    } catch {
      return;
    }
    const views = [...surfaces.values()].map((surface) => {
      const pose = deps.capturePose(surface.pane.id);
      return {
        paneId: surface.pane.id,
        workspaceId: surface.pane.workspaceId,
        sessionId: surface.pane.sessionId,
        windowId: surface.pane.windowId,
        title: surface.pane.title,
        ...(pose ? { pose } : {}),
      };
    });
    if (!deps.openViews.save(server, { views, selectedId }))
      deps.notify('Open terminal views could not be saved on this device.');
  }

  function quietly(action: () => void): void {
    pauseViewPersistence++;
    try {
      action();
    } finally {
      pauseViewPersistence--;
    }
  }

  function addSurface(pane: PaneDescriptor): boolean {
    let surface: TerminalSurface;
    try {
      surface = deps.createSurface(pane, { demo, endpoint });
    } catch (error) {
      reportSwallowed('pane-controller.create-surface', error);
      deps.notify(
        `Could not open ${pane.title}: ${error instanceof Error ? error.message : 'unknown error'}.`,
      );
      return false;
    }
    surfaces.set(pane.id, surface);
    each((presenter) => presenter.addPane?.(surface));
    unsubscribes.set(
      pane.id,
      surface.subscribe(() =>
        each((presenter) => presenter.paneChanged?.(surface, selectedId === pane.id)),
      ),
    );
    surface.setColorMode(deps.colorMode());
    surface.connect();
    each((presenter) => presenter.paneChanged?.(surface, false));
    each((presenter) => presenter.attachedChanged?.(attachedIds()));
    return true;
  }

  function selectPane(id: string): void {
    const pane = snapshot.panes.find((item) => item.id === id);
    if (!pane) return;
    if (!surfaces.has(id) && !addSurface(pane)) return;
    const surface = surfaces.get(id);
    surface?.acknowledgeBell?.();
    if (selectedId === id) return;
    selectedId = id;
    deps.cancelPendingInput();
    each((presenter) => presenter.select?.(surface ?? null));
    persistOpenViews();
  }

  function closePane(id: string): void {
    if (selectedId === id) deps.cancelPendingInput();
    each((presenter) => presenter.removePane?.(id));
    unsubscribes.get(id)?.();
    unsubscribes.delete(id);
    surfaces.get(id)?.dispose();
    surfaces.delete(id);
    if (selectedId === id) selectedId = null;
    each((presenter) => presenter.attachedChanged?.(attachedIds()));
    const next = surfaces.keys().next().value;
    if (next && !selectedId) selectPane(next);
    else if (!selectedId) {
      each((presenter) => presenter.select?.(null));
      each((presenter) => presenter.idle?.('Choose a pane to open a terminal view.'));
    }
    persistOpenViews();
  }

  function restoreSavedViews(profile: OpenViewsProfile, panes: PaneDescriptor[]): void {
    const resolved = resolveOpenViews(profile, panes);
    for (const view of resolved.views) {
      selectPane(view.paneId);
      if (view.pose && surfaces.has(view.paneId)) deps.restorePose(view.paneId, view.pose);
    }
    if (resolved.selectedId) selectPane(resolved.selectedId);
    else if (resolved.views.length) selectPane(resolved.views[0].paneId);
    if (resolved.missing.length) {
      const ids = resolved.missing.map((view) => view.paneId).join(', ');
      const count = resolved.missing.length;
      deps.reportMissingViews(
        `${count} saved terminal${count === 1 ? ' is' : 's are'} no longer in mux: ${ids.slice(0, 100)}.`,
      );
    }
    if (!resolved.views.length)
      each((presenter) => presenter.idle?.('No terminal views open. Choose a pane.'));
  }

  function applySnapshot(next: WorkspaceSnapshot, options: SnapshotOptions = {}): void {
    const authoritative = options.authoritative ?? true;
    if (options.generation !== undefined && options.generation !== generation) return;
    quietly(() => {
      snapshot = next;
      each((presenter) => presenter.snapshotChanged?.(next));
      const valid = new Set(next.panes.map((pane) => pane.id));
      for (const id of attachedIds()) if (!valid.has(id)) closePane(id);
      if (authoritative && !demo) deps.observeSnapshot?.(next.panes);
      if (autoAttachPending && authoritative && (next.panes.length || pendingOpenViews !== null)) {
        autoAttachPending = false;
        if (!demo && pendingOpenViews !== null) {
          const saved = pendingOpenViews;
          pendingOpenViews = null;
          restoreSavedViews(saved, next.panes);
        } else {
          const initial = initialPaneSelection(next.panes);
          for (const pane of initial.panes) selectPane(pane.id);
          if (initial.activeId) selectPane(initial.activeId);
        }
      }
    });
    persistOpenViews();
  }

  return {
    get selectedId() {
      return selectedId;
    },
    get snapshot() {
      return snapshot;
    },
    get endpoint() {
      return endpoint;
    },
    get demo() {
      return demo;
    },
    get generation() {
      return generation;
    },
    get: (id) => surfaces.get(id),
    ids: attachedIds,
    surfaces: () => [...surfaces.values()],
    beginConnection(next) {
      generation += 1;
      demo = false;
      endpoint = next;
      autoAttachPending = true;
      try {
        pendingOpenViews = deps.openViews.read(normalizeOpenViewsServer(next));
      } catch {
        pendingOpenViews = null;
      }
      return generation;
    },
    beginDemo() {
      generation += 1;
      demo = true;
      pendingOpenViews = null;
      autoAttachPending = true;
      return generation;
    },
    applySnapshot,
    selectPane,
    closePane,
    closeAll() {
      for (const id of attachedIds()) closePane(id);
      selectedId = null;
    },
    toggleConnection(id) {
      const surface = surfaces.get(id);
      if (!surface) return;
      if (surface.status === 'connected' || surface.status === 'connecting') surface.disconnect();
      else surface.connect();
    },
    persistOpenViews,
    quietly,
  };
}
