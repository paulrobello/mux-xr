import { describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor, TerminalSurface, WorkspaceSnapshot } from '../src/contracts';
import type { OpenViewsProfile } from '../src/workspace/open-views';
import {
  createPaneController,
  type OpenViewsPort,
  type PaneControllerDeps,
  type PanePresenter,
} from '../src/workspace/pane-controller';

const pane = (id: string, over: Partial<PaneDescriptor> = {}): PaneDescriptor => ({
  id,
  title: `Pane ${id}`,
  workspaceId: 'w1',
  workspaceName: 'default',
  sessionId: 's1',
  sessionName: 'default',
  windowId: 'win1',
  windowName: 'win',
  ...over,
});

interface FakeSurface extends TerminalSurface {
  connects: number;
  disposed: boolean;
  bellAcks: number;
  emit(): void;
}

function fakeSurface(descriptor: PaneDescriptor): FakeSurface {
  const listeners = new Set<() => void>();
  const surface = {
    canvas: document.createElement('canvas'),
    pane: descriptor,
    revision: 0,
    cols: 80,
    rows: 24,
    status: 'connecting',
    error: null,
    canResizeGrid: true,
    connects: 0,
    disposed: false,
    bellAcks: 0,
    connect() {
      surface.connects += 1;
    },
    disconnect() {
      surface.status = 'disconnected';
    },
    acknowledgeBell() {
      surface.bellAcks += 1;
    },
    sendText: () => true,
    sendKey: () => true,
    paste: () => true,
    focus() {},
    resizeGrid: () => true,
    setColorMode: vi.fn(),
    dispose() {
      surface.disposed = true;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit() {
      for (const listener of [...listeners]) listener();
    },
  };
  return surface as unknown as FakeSurface;
}

function memoryViews(initial: OpenViewsProfile | null = null) {
  let saved: OpenViewsProfile | null = initial;
  const save = vi.fn((_server: string, profile: OpenViewsProfile) => {
    saved = profile;
    return true;
  });
  const port: OpenViewsPort = { read: () => saved, save };
  return {
    port,
    save,
    get saved() {
      return saved;
    },
  };
}

function setup(options: { views?: OpenViewsProfile | null; saveOk?: boolean } = {}) {
  const views = memoryViews(options.views ?? null);
  if (options.saveOk === false) views.save.mockReturnValue(false);
  const surfaces = new Map<string, FakeSurface>();
  const events: string[] = [];
  const presenter: PanePresenter = {
    addPane: (surface) => events.push(`add:${surface.pane.id}`),
    removePane: (id) => events.push(`remove:${id}`),
    select: (surface) => events.push(`select:${surface?.pane.id ?? 'none'}`),
    attachedChanged: (ids) => events.push(`attached:${ids.join(',')}`),
    snapshotChanged: (snapshot) => events.push(`snapshot:${snapshot.panes.length}`),
    idle: (message) => events.push(`idle:${message}`),
  };
  const second: PanePresenter = { addPane: () => events.push('second:add') };
  const deps = {
    createSurface: vi.fn((descriptor: PaneDescriptor) => {
      const surface = fakeSurface(descriptor);
      surfaces.set(descriptor.id, surface);
      return surface;
    }),
    colorMode: () => 'comfort' as const,
    presenters: [presenter, second],
    openViews: views.port,
    capturePose: vi.fn(() => null),
    restorePose: vi.fn(),
    cancelPendingInput: vi.fn(),
    notify: vi.fn(),
    reportMissingViews: vi.fn(),
    observeSnapshot: vi.fn(),
  } satisfies PaneControllerDeps;
  const controller = createPaneController(deps);
  return { controller, deps, views, surfaces, events };
}

const snapshotOf = (...panes: PaneDescriptor[]): WorkspaceSnapshot => ({ panes });

/** Makes `createSurface` throw for one pane id, as the live surface does for an id it cannot stream. */
function failFor(deps: ReturnType<typeof setup>['deps'], paneId: string): void {
  const create = deps.createSurface.getMockImplementation();
  deps.createSurface.mockImplementation((descriptor: PaneDescriptor) => {
    if (descriptor.id === paneId) throw new Error(`Invalid pane id: ${paneId}`);
    if (!create) throw new Error('createSurface has no implementation');
    return create(descriptor);
  });
}
const profile = (selectedId: string | null, ...panes: PaneDescriptor[]): OpenViewsProfile => ({
  views: panes.map((p) => ({
    paneId: p.id,
    workspaceId: p.workspaceId,
    sessionId: p.sessionId,
    windowId: p.windowId,
    title: p.title,
  })),
  selectedId,
});

describe('pane controller snapshots', () => {
  it('ignores a snapshot from an older generation', () => {
    const { controller, events } = setup();
    const stale = controller.beginConnection('http://a.test');
    controller.beginConnection('http://b.test');
    controller.applySnapshot(snapshotOf(pane('%1')), { generation: stale });
    expect(controller.snapshot.panes).toEqual([]);
    expect(controller.ids()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('accepts a snapshot from the current generation', () => {
    const { controller } = setup();
    const current = controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')), { generation: current });
    expect(controller.snapshot.panes).toHaveLength(1);
  });

  it('attaches the first panes the initial selection picks when nothing was saved', () => {
    const { controller } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1'), pane('%2'), pane('%3')));
    expect(controller.ids()).toEqual(['%1', '%2']);
    expect(controller.selectedId).toBe('%1');
  });

  it('waits for an authoritative snapshot before auto-attaching', () => {
    const { controller } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot({ panes: [] }, { authoritative: false });
    expect(controller.ids()).toEqual([]);
    controller.applySnapshot(snapshotOf(pane('%1')));
    expect(controller.ids()).toEqual(['%1']);
  });

  it('attaches the saved views, selects the saved one and restores its pose', () => {
    const saved = profile('%2', pane('%1'), pane('%2'));
    saved.views[1].pose = { position: [0, 1, -2], quaternion: [0, 0, 0, 1], scale: 1 };
    const { controller, deps } = setup({ views: saved });
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1'), pane('%2'), pane('%3')));
    expect(controller.ids()).toEqual(['%1', '%2']);
    expect(controller.selectedId).toBe('%2');
    expect(deps.restorePose).toHaveBeenCalledWith('%2', saved.views[1].pose);
    expect(deps.reportMissingViews).not.toHaveBeenCalled();
  });

  it('reports saved views that no longer exist and still attaches the rest', () => {
    const saved = profile(null, pane('%1'), pane('%9'));
    const { controller, deps } = setup({ views: saved });
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    expect(controller.ids()).toEqual(['%1']);
    expect(deps.reportMissingViews).toHaveBeenCalledWith(
      '1 saved terminal is no longer in mux: %9.',
    );
  });

  it('shows the idle message when no saved view matches', () => {
    const saved = profile(null, pane('%9'));
    const { controller, events } = setup({ views: saved });
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    expect(events).toContain('idle:No terminal views open. Choose a pane.');
    expect(controller.ids()).toEqual([]);
  });

  it('closes an attached pane that left the snapshot', () => {
    const { controller, surfaces } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1'), pane('%2')));
    controller.applySnapshot(snapshotOf(pane('%2')));
    expect(controller.ids()).toEqual(['%2']);
    expect(surfaces.get('%1')?.disposed).toBe(true);
    expect(controller.selectedId).toBe('%2');
  });

  it('does not attach saved panes in the demo and ignores saved views', () => {
    const saved = profile('%2', pane('%2'));
    const { controller, deps } = setup({ views: saved });
    controller.beginDemo();
    controller.applySnapshot(snapshotOf(pane('%1'), pane('%2'), pane('%3')));
    expect(controller.ids()).toEqual(['%1', '%2']);
    expect(deps.observeSnapshot).not.toHaveBeenCalled();
  });
});

describe('pane controller invalid pane ids', () => {
  it('reports a pane whose surface cannot be created and does not throw', () => {
    const { controller, deps, events } = setup();
    failFor(deps, 'bad');
    controller.beginConnection('http://a.test');
    expect(() => controller.applySnapshot(snapshotOf(pane('bad')))).not.toThrow();
    expect(deps.notify).toHaveBeenCalledWith('Could not open Pane bad: Invalid pane id: bad.');
    expect(controller.ids()).toEqual([]);
    expect(controller.selectedId).toBeNull();
    expect(events.filter((event) => event.startsWith('add:'))).toEqual([]);
  });

  it('does not restore a saved pose for a pane that failed to attach', () => {
    const saved = profile(null, pane('bad'));
    saved.views[0].pose = { position: [0, 1, -2], quaternion: [0, 0, 0, 1], scale: 1 };
    const { controller, deps } = setup({ views: saved });
    failFor(deps, 'bad');
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('bad')));
    expect(deps.restorePose).not.toHaveBeenCalled();
  });

  it('keeps attaching the valid panes around an invalid one', () => {
    const { controller, deps } = setup();
    failFor(deps, 'bad');
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('bad'), pane('%2')));
    expect(controller.ids()).toEqual(['%2']);
    expect(controller.selectedId).toBe('%2');
  });

  it('ignores a select for an id that is not in the snapshot', () => {
    const { controller, deps } = setup();
    controller.beginConnection('http://a.test');
    controller.selectPane('%404');
    expect(deps.createSurface).not.toHaveBeenCalled();
    expect(controller.selectedId).toBeNull();
  });
});

describe('pane controller selection and closing', () => {
  it('attaches once, acknowledges the bell and cancels pending input when the selection moves', () => {
    const { controller, deps, surfaces } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot({ panes: [] }, { authoritative: false });
    controller.applySnapshot(snapshotOf(pane('%1'), pane('%2')));
    deps.cancelPendingInput.mockClear();
    controller.selectPane('%2');
    controller.selectPane('%2');
    expect(deps.createSurface).toHaveBeenCalledTimes(2);
    // Once when auto-attach selects it, then once for each of the two explicit selects.
    expect(surfaces.get('%2')?.bellAcks).toBe(3);
    expect(deps.cancelPendingInput).toHaveBeenCalledTimes(1);
    expect(surfaces.get('%2')?.setColorMode).toHaveBeenCalledWith('comfort');
    expect(surfaces.get('%2')?.connects).toBe(1);
  });

  it('calls every presenter in order for one event', () => {
    const { controller, events } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    expect(events.slice(0, 4)).toEqual(['snapshot:1', 'add:%1', 'second:add', 'attached:%1']);
  });

  it('close removes the surface, clears the selection and shows idle when none remain', () => {
    const { controller, surfaces, events } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    controller.closePane('%1');
    expect(controller.ids()).toEqual([]);
    expect(controller.selectedId).toBeNull();
    expect(surfaces.get('%1')?.disposed).toBe(true);
    expect(events).toContain('remove:%1');
    expect(events).toContain('select:none');
    expect(events).toContain('idle:Choose a pane to open a terminal view.');
  });

  it('closing the selected pane selects the next attached one', () => {
    const { controller } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1'), pane('%2')));
    controller.closePane('%1');
    expect(controller.selectedId).toBe('%2');
  });

  it('stops notifying presenters about a closed surface', () => {
    const { controller, surfaces } = setup();
    const changed = vi.fn();
    const live = createPaneController({
      createSurface: (descriptor) => {
        const surface = fakeSurface(descriptor);
        surfaces.set(descriptor.id, surface);
        return surface;
      },
      colorMode: () => 'comfort',
      presenters: [{ paneChanged: changed }],
      openViews: memoryViews().port,
      capturePose: () => null,
      restorePose: () => undefined,
      cancelPendingInput: () => undefined,
      notify: () => undefined,
      reportMissingViews: () => undefined,
    });
    live.beginConnection('http://a.test');
    live.applySnapshot(snapshotOf(pane('%1')));
    const surface = surfaces.get('%1');
    live.closePane('%1');
    changed.mockClear();
    surface?.emit();
    expect(changed).not.toHaveBeenCalled();
    expect(controller.ids()).toEqual([]);
  });

  it('toggles a surface between connected and disconnected', () => {
    const { controller, surfaces } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    const surface = surfaces.get('%1');
    if (!surface) throw new Error('surface missing');
    controller.toggleConnection('%1');
    expect(surface.status).toBe('disconnected');
    controller.toggleConnection('%1');
    expect(surface.connects).toBe(2);
    controller.toggleConnection('%404');
  });
});

describe('pane controller open-view persistence', () => {
  it('saves the open views and selection once the first attach has run', () => {
    const { controller, views } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1'), pane('%2')));
    expect(views.saved?.views.map((view) => view.paneId)).toEqual(['%1', '%2']);
    expect(views.saved?.selectedId).toBe('%1');
  });

  it('does not save before the first authoritative snapshot or in the demo', () => {
    const { controller, views } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot({ panes: [] }, { authoritative: false });
    expect(views.save).not.toHaveBeenCalled();
    controller.beginDemo();
    controller.applySnapshot(snapshotOf(pane('%1')));
    expect(views.save).not.toHaveBeenCalled();
  });

  it('does not overwrite the saved set while panes close for a reconnect', () => {
    const { controller, views } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    views.save.mockClear();
    controller.quietly(() => controller.closeAll());
    expect(views.save).not.toHaveBeenCalled();
    expect(controller.ids()).toEqual([]);
  });

  it('tells the user when the views cannot be saved', () => {
    const { controller, deps } = setup({ saveOk: false });
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    expect(deps.notify).toHaveBeenCalledWith(
      'Open terminal views could not be saved on this device.',
    );
  });

  it('captures each attached pane pose once per save', () => {
    const { controller, deps } = setup();
    controller.beginConnection('http://a.test');
    controller.applySnapshot(snapshotOf(pane('%1')));
    deps.capturePose.mockClear();
    controller.persistOpenViews();
    expect(deps.capturePose).toHaveBeenCalledTimes(1);
  });
});
