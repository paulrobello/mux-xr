import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PaneDescriptor } from '../../../src/contracts';
import { createHierarchyTouchController } from '../../../src/xr/controllers/hierarchy-touch';
import type { HierarchyNavigator } from '../../../src/xr/hierarchy-navigator';
import { createHierarchyTouch, HIERARCHY_NEAR_ENTER } from '../../../src/xr/hierarchy-touch';
import type { TerminalPanel } from '../../../src/xr/scene';
import type { InputMode } from '../../../src/xr/scene-context';

const makePane = (id: string): PaneDescriptor => ({
  id,
  workspaceId: 'w1',
  workspaceName: 'Workspace',
  sessionId: 's1',
  sessionName: 'Session',
  windowId: 'win1',
  windowName: 'Window',
  title: `Pane ${id}`,
});

const makeDeps = () => {
  const controller = new THREE.Group();
  const hand = new THREE.Group();
  const root = new THREE.Group();
  // Node bodies only carry hover targets; label planes are excluded by their disposeLabel flag.
  const node = new THREE.Mesh(new THREE.SphereGeometry(0.02));
  node.userData.inputAction = 'hierarchyNode';
  root.add(node);
  const pane = new THREE.Mesh(new THREE.SphereGeometry(0.02));
  pane.userData.inputAction = 'pane';
  pane.userData.paneId = 'p1';
  pane.position.set(0.5, 0, 0);
  root.add(pane);
  const labelled = new THREE.Mesh(new THREE.SphereGeometry(0.02));
  labelled.userData.inputAction = 'hierarchyNode';
  labelled.userData.disposeLabel = true;
  root.add(labelled);
  root.updateMatrixWorld(true);

  const indexTip = new THREE.Vector3(0.06, 0, 0);
  const thumbTip = new THREE.Vector3(-0.06, 0, 0);
  const hierarchyTouch = createHierarchyTouch();

  return {
    controller,
    hand,
    root,
    node,
    pane,
    labelled,
    indexTip,
    thumbTip,
    hierarchyTouch,
    presenting: vi.fn(() => true),
    inputRoot: vi.fn(() => ({ visible: true }) as unknown as THREE.Group),
    inputMode: vi.fn((): InputMode => 'panes'),
    hierarchyNavigator: vi.fn(
      () => ({ root, transitioning: false }) as unknown as HierarchyNavigator,
    ),
    radialMenuVisible: vi.fn(() => false),
    warpEditActive: vi.fn(() => false),
    controllerRoots: vi.fn(() => [controller]),
    activeHand: vi.fn((): THREE.Group | undefined => hand),
    sampleHand: vi.fn(() => ({ tracked: true, pinching: false })),
    contactVisual: vi.fn(() => ({ indexTip, thumbTip })),
    dragStates: new Map<THREE.Group, { object: THREE.Group }>(),
    setLastSelectSource: vi.fn(),
    cueCount: vi.fn(() => 3),
    activateTarget: vi.fn(),
    inputTargetId: vi.fn(() => 't1'),
    pressCue: vi.fn(),
    headPosition: vi.fn(() => new THREE.Vector3(0, 0, -2)),
    accent: { hex: 0x112233, hover: 0x445566 },
    scene: new THREE.Scene(),
    panelSize: { width: 1.42, height: 0.8 },
    availablePanes: [makePane('p1'), makePane('p2')],
    captureGrab: vi.fn(),
    disposeObject: vi.fn(),
    handTrackingLost: new Set<THREE.Group>(),
    cue: vi.fn(),
    hideInput: vi.fn(),
    paneFocusActiveId: vi.fn((): string | null => null),
    endFocusMode: vi.fn(),
    actions: { selectPane: vi.fn() },
    panels: new Map([['p1', {} as TerminalPanel]]),
    restoreTerminalPose: vi.fn(),
    rememberTerminalPlacements: vi.fn(),
  };
};

const makeFixture = () => {
  const deps = makeDeps();
  const ctl = createHierarchyTouchController(deps);
  return { ...deps, deps, ctl };
};

/** One pinch cycle: open near, close, open again — the sampler needs an open frame before it latches. */
const pinchCycle = (fixture: ReturnType<typeof makeFixture>): void => {
  fixture.ctl.updateHierarchyTouch();
  fixture.indexTip.set(0.008, 0, 0);
  fixture.thumbTip.set(-0.008, 0, 0);
  fixture.ctl.updateHierarchyTouch();
  fixture.indexTip.set(0.06, 0, 0);
  fixture.thumbTip.set(-0.06, 0, 0);
  fixture.ctl.updateHierarchyTouch();
};

const pullProxy = (fixture: ReturnType<typeof makeFixture>): THREE.Group => {
  fixture.ctl.startPanePull(fixture.controller, fixture.pane, true);
  const proxy = fixture.scene.children.find((child) => child.name === 'pane-pull-proxy');
  expect(proxy).toBeDefined();
  return proxy as THREE.Group;
};

describe('hierarchy-touch controller', () => {
  it('hovers and commits a pinch on a node body, cueing and resetting the hand', () => {
    const f = makeFixture();
    f.ctl.updateHierarchyTouch();
    expect(f.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(true);
    pinchCycle(f);
    expect(f.activateTarget).toHaveBeenCalledWith({
      kind: 'keyboard',
      terminalId: 't1',
      object: f.node,
    });
    expect(f.pressCue).toHaveBeenCalledWith(f.controller, 'hierarchyNode', 3);
    expect(f.setLastSelectSource).toHaveBeenNthCalledWith(1, f.controller);
    expect(f.setLastSelectSource).toHaveBeenLastCalledWith(null);
    // The commit consumed the hand, so the marker hides and the sampler forgets the hand.
    expect(f.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(false);
    expect(f.hierarchyTouch.near(f.controller)).toBe(false);
  });

  it('ignores label planes and non-pane input modes', () => {
    const f = makeFixture();
    f.labelled.position.set(0, 0, 0);
    f.node.position.set(9, 9, 9);
    f.pane.position.set(9, 9, 9);
    f.root.updateMatrixWorld(true);
    pinchCycle(f);
    expect(f.activateTarget).not.toHaveBeenCalled();

    const off = makeFixture();
    off.deps.inputMode.mockReturnValue('commands');
    pinchCycle(off);
    expect(off.activateTarget).not.toHaveBeenCalled();
    expect(off.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(false);
  });

  it('hides the marker when no hand is tracked', () => {
    const f = makeFixture();
    f.deps.activeHand.mockReturnValue(undefined);
    f.ctl.updateHierarchyTouch();
    expect(f.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(false);
    expect(f.deps.contactVisual).not.toHaveBeenCalled();
  });

  it('hierarchyGrab returns the ray-hit pane and refuses one already pulling', () => {
    const f = makeFixture();
    expect(f.ctl.hierarchyGrab(f.controller, undefined, null)).toEqual({ pane: null, tree: true });
    const target = { kind: 'keyboard', terminalId: '', object: f.pane } as never;
    expect(f.ctl.hierarchyGrab(f.controller, undefined, target)).toEqual({
      pane: f.pane,
      tree: false,
    });
    const proxy = pullProxy(f);
    expect(f.ctl.hierarchyGrab(f.controller, undefined, target)).toEqual({
      pane: null,
      tree: false,
    });
    expect(f.captureGrab).toHaveBeenCalledWith(f.controller, proxy, true);
  });

  it('hierarchyGrab keeps tree grabs off contact objects', () => {
    const f = makeFixture();
    const other = new THREE.Group();
    expect(f.ctl.hierarchyGrab(f.controller, other, null)).toEqual({ pane: null, tree: false });
  });

  it('starts a pane pull with a ghost card and grabs it', () => {
    const f = makeFixture();
    const proxy = pullProxy(f);
    expect(proxy.userData.panePullId).toBe('p1');
    expect(f.captureGrab).toHaveBeenCalledWith(f.controller, proxy, true);
  });

  it('drops a short pull without selecting', () => {
    const f = makeFixture();
    const proxy = pullProxy(f);
    proxy.position.set(0.55, 0, 0); // 0.05 from the spawn point, below PANE_PULL_MIN_TRAVEL.
    f.ctl.finishPanePull(f.controller, proxy);
    expect(f.cue).toHaveBeenCalledWith('release', f.controller);
    expect(f.actions.selectPane).not.toHaveBeenCalled();
    expect(f.scene.children.find((child) => child.name === 'pane-pull-proxy')).toBeUndefined();
  });

  it('completes a full pull: hide input, end focus, select, restore pose', () => {
    const f = makeFixture();
    f.deps.paneFocusActiveId.mockReturnValue('focus-1');
    const proxy = pullProxy(f);
    proxy.position.set(1, 0, 0);
    f.ctl.finishPanePull(f.controller, proxy);
    expect(f.hideInput).toHaveBeenCalled();
    expect(f.endFocusMode).toHaveBeenCalledWith(true);
    expect(f.actions.selectPane).toHaveBeenCalledWith('p1');
    expect(f.restoreTerminalPose).toHaveBeenCalledTimes(1);
    expect(f.rememberTerminalPlacements).toHaveBeenCalled();
    expect(f.cue).toHaveBeenCalledWith('select', f.controller);
    expect(f.hideInput.mock.invocationCallOrder[0]).toBeLessThan(
      f.actions.selectPane.mock.invocationCallOrder[0],
    );
  });

  it('drops the pull when the pane vanished or tracking was lost', () => {
    const f = makeFixture();
    f.deps.availablePanes.length = 0;
    const proxy = pullProxy(f);
    proxy.position.set(1, 0, 0);
    f.ctl.finishPanePull(f.controller, proxy);
    expect(f.actions.selectPane).not.toHaveBeenCalled();
    expect(f.cue).toHaveBeenCalledWith('release', f.controller);

    const g = makeFixture();
    const gproxy = pullProxy(g);
    gproxy.position.set(1, 0, 0);
    g.deps.handTrackingLost.add(g.controller);
    g.ctl.finishPanePull(g.controller, gproxy);
    expect(g.actions.selectPane).not.toHaveBeenCalled();
    expect(g.cue).toHaveBeenCalledWith('release', g.controller);
  });

  it('updatePanePulls discards an unheld pull and keeps a held one', () => {
    const f = makeFixture();
    pullProxy(f);
    // Not held by any drag: the next frame discards it.
    f.ctl.updatePanePulls();
    expect(f.scene.children.find((child) => child.name === 'pane-pull-proxy')).toBeUndefined();

    const proxy = pullProxy(f);
    f.deps.dragStates.set(f.controller, { object: proxy });
    proxy.position.set(0.25, 0, 0); // Past PANE_PULL_GROW_DISTANCE, fully grown.
    f.ctl.updatePanePulls();
    expect(f.scene.children.find((child) => child.name === 'pane-pull-proxy')).toBe(proxy);
    expect(f.captureGrab).toHaveBeenCalledTimes(2);
  });

  it('dispose discards pulls, forgets hands and retires the marker', () => {
    const f = makeFixture();
    pullProxy(f);
    f.ctl.updateHierarchyTouch(); // Prime a hover so the sampler holds controller state.
    expect(f.hierarchyTouch.near(f.controller)).toBe(true);
    f.ctl.dispose();
    expect(f.scene.children.find((child) => child.name === 'pane-pull-proxy')).toBeUndefined();
    expect(f.hierarchyTouch.near(f.controller)).toBe(false);
    expect(f.disposeObject).toHaveBeenCalled();
  });

  it('keeps the sampler radius contract', () => {
    expect(HIERARCHY_NEAR_ENTER).toBeGreaterThan(0);
  });
});
