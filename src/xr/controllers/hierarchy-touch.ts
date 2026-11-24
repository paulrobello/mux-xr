import { createScalableLabel } from '@par/xr-workspace';
import * as THREE from 'three';
import type { PaneDescriptor, WorkspaceActions } from '../../contracts';
import { captureUIPose, type SavedUIPose } from '../../stores/ui-poses';
import type { AccentState } from '../accent-state';
import type { HierarchyNavigator } from '../hierarchy-navigator';
import { HIERARCHY_NEAR_ENTER, HIERARCHY_NEAR_EXIT, type HierarchyTouch } from '../hierarchy-touch';
import type { InputTarget, TerminalPanel } from '../scene';
import type { InputMode } from '../scene-context';
import type { UICue } from '../ui-feedback';

const PANE_PULL_START_SCALE = 0.12;
const PANE_PULL_GROW_DISTANCE = 0.25;
const PANE_PULL_MIN_TRAVEL = 0.1;
// A terminal 1.5 m away opens at scale 1, so nearer drops shrink to the same angular size.
const PANE_PULL_REFERENCE_DISTANCE = 1.5;

/**
 * Everything the hierarchy-touch controller needs from the scene closure. Getters keep live
 * values, matching the closure reads the code replaces.
 */
export interface HierarchyTouchDeps {
  presenting(): boolean;
  inputRoot(): THREE.Group | null;
  inputMode(): InputMode;
  hierarchyNavigator(): HierarchyNavigator | null;
  radialMenuVisible(): boolean;
  warpEditActive(): boolean;
  controllerRoots(): readonly THREE.Group[];
  activeHand(controller: THREE.Group): THREE.Group | undefined;
  sampleHand(controller: THREE.Group): { tracked: boolean; pinching: boolean } | null;
  contactVisual(
    controller: THREE.Group,
  ): { indexTip: THREE.Vector3; thumbTip: THREE.Vector3 } | undefined;
  dragStates: ReadonlyMap<THREE.Group, { object: THREE.Group }>;
  /** The shared pinch sampler; keyboard-ray suppression outside this controller also reads it. */
  hierarchyTouch: HierarchyTouch;
  setLastSelectSource(source: THREE.Group | null): void;
  cueCount(): number;
  activateTarget(target: InputTarget | null): void;
  inputTargetId(): string;
  pressCue(controller: THREE.Group, action: unknown, cues: number): void;
  headPosition(): THREE.Vector3;
  accent: AccentState;
  scene: THREE.Scene;
  /** Terminal card size; the pane-pull ghost mirrors a panel plane. */
  panelSize: { width: number; height: number };
  availablePanes: readonly PaneDescriptor[];
  captureGrab(controller: THREE.Group, object: THREE.Group, far?: boolean): void;
  disposeObject(object: THREE.Object3D): void;
  handTrackingLost: ReadonlySet<THREE.Group>;
  cue(kind: UICue, source?: THREE.Group | number | null): void;
  hideInput(): void;
  paneFocusActiveId(): string | null;
  endFocusMode(immediate?: boolean): void;
  actions: Pick<WorkspaceActions, 'selectPane'>;
  panels: ReadonlyMap<string, TerminalPanel>;
  restoreTerminalPose(id: string, pose: SavedUIPose): void;
  rememberTerminalPlacements(): void;
}

export interface HierarchyTouchController {
  updateHierarchyTouch(): void;
  hierarchyGrab(
    controller: THREE.Group,
    contactObject: THREE.Group | undefined,
    target: InputTarget | null,
  ): { pane: THREE.Object3D | null; tree: boolean };
  startPanePull(controller: THREE.Group, node: THREE.Object3D, far: boolean): void;
  finishPanePull(controller: THREE.Group, proxy: THREE.Group): void;
  updatePanePulls(): void;
  /** True while `object` is a live pane-pull ghost, so its release completes instead of dropping. */
  isPanePull(object: THREE.Group): boolean;
  /** Discards every pull, forgets the hands and retires the marker; the scene's dispose calls this. */
  dispose(): void;
}

/** Hierarchy hover, pinch commit and pane pulls, shown while the hierarchy root is reachable. */
export const createHierarchyTouchController = (
  deps: HierarchyTouchDeps,
): HierarchyTouchController => {
  const hierarchyTouchRoot = (): THREE.Group | null => {
    const navigator = deps.hierarchyNavigator();
    return deps.presenting() &&
      deps.inputRoot()?.visible &&
      deps.inputMode() === 'panes' &&
      navigator &&
      !navigator.transitioning &&
      !deps.radialMenuVisible() &&
      !deps.warpEditActive()
      ? navigator.root
      : null;
  };
  // Node bodies only: label planes share the action but their wide bounds would steal the hover.
  const hierarchyTargets = (root: THREE.Group | null, paneOnly = false): THREE.Object3D[] => {
    const targets: THREE.Object3D[] = [];
    if (!root) return targets;
    root.updateMatrixWorld(true);
    const collect = (object: THREE.Object3D): void => {
      if (object.userData.disposeLabel) return;
      const action = object.userData.inputAction;
      if (
        (object as THREE.Mesh).isMesh &&
        (action === 'pane' ||
          (!paneOnly && (action === 'hierarchyNode' || action === 'createPane')))
      )
        targets.push(object);
      for (const child of object.children) collect(child);
    };
    collect(root);
    return targets;
  };
  const hierarchyTouchMarker = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.05, 8, 48),
    new THREE.MeshBasicMaterial({ color: deps.accent.hex, transparent: true, opacity: 0.9 }),
  );
  hierarchyTouchMarker.name = 'hierarchy-touch-marker';
  hierarchyTouchMarker.raycast = () => undefined;
  hierarchyTouchMarker.visible = false;
  deps.scene.add(hierarchyTouchMarker);
  const markerSphere = new THREE.Sphere();
  const updateHierarchyTouch = (): void => {
    const root = deps.controllerRoots().some((controller) => deps.activeHand(controller))
      ? hierarchyTouchRoot()
      : null;
    const targets = hierarchyTargets(root);
    let marked: THREE.Object3D | null = null;
    for (const controller of deps.controllerRoots()) {
      const hand = deps.activeHand(controller);
      const gesture = hand ? deps.sampleHand(controller) : null;
      const visual = root && hand && gesture?.tracked ? deps.contactVisual(controller) : undefined;
      // A grab pinch or a held object owns the hand; its index-thumb gap is not a select.
      const free = visual && !gesture?.pinching && !deps.dragStates.has(controller);
      const sample = deps.hierarchyTouch.sample(
        controller,
        free ? visual.indexTip : null,
        free ? visual.thumbTip : null,
        targets,
      );
      marked ??= sample.hovered;
      if (!sample.committed) continue;
      deps.setLastSelectSource(controller);
      const cues = deps.cueCount();
      deps.activateTarget({
        kind: 'keyboard',
        terminalId: deps.inputTargetId(),
        object: sample.committed,
      });
      deps.pressCue(controller, sample.committed.userData.inputAction, cues);
      deps.setLastSelectSource(null);
      deps.hierarchyTouch.reset(controller);
      marked = null;
      break;
    }
    hierarchyTouchMarker.visible = Boolean(marked);
    if (!marked) return;
    const mesh = marked as THREE.Mesh;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    markerSphere.copy(mesh.geometry.boundingSphere as THREE.Sphere).applyMatrix4(mesh.matrixWorld);
    hierarchyTouchMarker.position.copy(markerSphere.center);
    hierarchyTouchMarker.scale.setScalar(markerSphere.radius * 1.2);
    hierarchyTouchMarker.lookAt(deps.headPosition());
  };
  const panePulls = new Set<THREE.Group>();
  // A hand at a node has its rays hidden, so no ray target can stand in for the whole-tree grab.
  const hierarchyGrab = (
    controller: THREE.Group,
    contactObject: THREE.Group | undefined,
    target: InputTarget | null,
  ): { pane: THREE.Object3D | null; tree: boolean } => {
    const none = { pane: null, tree: false };
    const root = hierarchyTouchRoot();
    if (!root || (contactObject && contactObject !== deps.inputRoot())) return none;
    const pulling = (node: THREE.Object3D): boolean =>
      [...panePulls].some((proxy) => proxy.userData.panePullId === node.userData.paneId);
    const hit = target?.object;
    if (hit) {
      const pane =
        hit.userData.inputAction === 'pane' && root.getObjectById(hit.id) && !pulling(hit)
          ? hit
          : null;
      return { pane, tree: false };
    }
    const visual = deps.contactVisual(controller);
    if (!visual) return none;
    const thumb = visual.thumbTip;
    const pane = deps.hierarchyTouch.nearest(
      thumb,
      hierarchyTargets(root, true),
      HIERARCHY_NEAR_ENTER,
    );
    if (pane) return { pane: pulling(pane) ? null : pane, tree: false };
    return {
      pane: null,
      tree:
        !contactObject &&
        Boolean(deps.hierarchyTouch.nearest(thumb, hierarchyTargets(root), HIERARCHY_NEAR_EXIT)),
    };
  };
  const panePullScale = (proxy: THREE.Group): number => {
    const start = proxy.userData.panePullStart as THREE.Vector3;
    const grown = THREE.MathUtils.clamp(
      proxy.position.distanceTo(start) / PANE_PULL_GROW_DISTANCE,
      0,
      1,
    );
    const target = THREE.MathUtils.clamp(
      proxy.position.distanceTo(deps.headPosition()) / PANE_PULL_REFERENCE_DISTANCE,
      0.3,
      1.8,
    );
    return THREE.MathUtils.lerp(PANE_PULL_START_SCALE, target, grown);
  };
  const startPanePull = (controller: THREE.Group, node: THREE.Object3D, far: boolean): void => {
    const paneId = node.userData.paneId as string;
    const title = deps.availablePanes.find((pane) => pane.id === paneId)?.title ?? paneId;
    const proxy = new THREE.Group();
    proxy.name = 'pane-pull-proxy';
    proxy.userData.panePullId = paneId;
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(deps.panelSize.width, deps.panelSize.height),
      new THREE.MeshBasicMaterial({
        color: 0x101820,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      }),
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(card.geometry),
      new THREE.LineBasicMaterial({ color: deps.accent.hex }),
    );
    const label = createScalableLabel(title, 1.1, 0.16);
    label.position.z = 0.01;
    proxy.add(card, edge, label);
    proxy.traverse((object) => {
      object.raycast = () => undefined;
    });
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(proxy.position);
    proxy.userData.panePullStart = proxy.position.clone();
    proxy.scale.setScalar(PANE_PULL_START_SCALE);
    proxy.lookAt(deps.headPosition());
    deps.scene.add(proxy);
    panePulls.add(proxy);
    deps.captureGrab(controller, proxy, far);
  };
  const discardPanePull = (proxy: THREE.Group): void => {
    panePulls.delete(proxy);
    deps.scene.remove(proxy);
    deps.disposeObject(proxy);
  };
  const finishPanePull = (controller: THREE.Group, proxy: THREE.Group): void => {
    const paneId = proxy.userData.panePullId as string;
    const travel = proxy.position.distanceTo(proxy.userData.panePullStart as THREE.Vector3);
    proxy.scale.setScalar(panePullScale(proxy));
    proxy.lookAt(deps.headPosition());
    proxy.updateMatrixWorld(true);
    const pose = captureUIPose(proxy);
    discardPanePull(proxy);
    // Tracking loss mid-pull is not a deliberate release, so it drops the ghost.
    if (
      deps.handTrackingLost.has(controller) ||
      travel < PANE_PULL_MIN_TRAVEL ||
      !deps.availablePanes.some((pane) => pane.id === paneId)
    ) {
      deps.cue('release', controller);
      return;
    }
    // Order matters: closing the hierarchy restores the visibility it recorded, then ending Focus
    // reveals its faded panels, and only then may selection run, so it rebuilds no hierarchy and
    // Focus cannot restore its pre-focus transform over the drop.
    deps.hideInput();
    if (deps.paneFocusActiveId()) deps.endFocusMode(true);
    deps.actions.selectPane(paneId);
    if (deps.panels.has(paneId)) {
      deps.restoreTerminalPose(paneId, pose);
      deps.rememberTerminalPlacements();
    }
    deps.cue('select', controller);
  };
  const updatePanePulls = (): void => {
    const held = new Set([...deps.dragStates.values()].map((drag) => drag.object));
    for (const proxy of panePulls) {
      if (!held.has(proxy)) {
        discardPanePull(proxy);
        continue;
      }
      proxy.scale.setScalar(panePullScale(proxy));
      proxy.lookAt(deps.headPosition());
    }
  };
  const dispose = (): void => {
    for (const proxy of [...panePulls]) discardPanePull(proxy);
    deps.hierarchyTouch.reset();
    deps.disposeObject(hierarchyTouchMarker);
  };

  return {
    updateHierarchyTouch,
    hierarchyGrab,
    startPanePull,
    finishPanePull,
    updatePanePulls,
    isPanePull: (object: THREE.Group): boolean => panePulls.has(object),
    dispose,
  };
};
