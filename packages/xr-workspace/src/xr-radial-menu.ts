import * as THREE from 'three';
import { createHandMenuGesture } from './hand-menu-gesture';
import { PlacementRays, type PlacementRayTarget } from './placement-ray';
import { createPointer } from './pointer';
import { createRadialMenu, type RadialMenu, type RadialMenuItem } from './radial-menu';
import { createStickRadialNavigation, type StickRadialNavigation } from './radial-stick-navigation';

type Choice<Action extends string> = Action | 'cancel';

/** Mount in an XR reference-space scene. Supply available actions each frame and forward selectstart/select. */
export function createXrRadialMenu<Action extends string>(
  scene: THREE.Scene,
  dispatch: (id: Action) => void,
) {
  const root = new THREE.Group();
  root.name = 'xr-radial-menu-host';
  root.scale.setScalar(0.63);
  scene.add(root);
  let menu: RadialMenu<Action> | undefined;
  let nav: StickRadialNavigation<Action, XRInputSource> | undefined;
  let owner: XRInputSource | undefined;
  let layout: readonly RadialMenuItem<Action>[] = [];
  const pressed = new Map<XRInputSource, boolean>();
  // A select can arrive after a second stick click closed the menu that owned its selectstart.
  const triggerStart = new Map<
    XRInputSource,
    { generation: number; action: Choice<Action> | null }
  >();
  const controllerRays = new PlacementRays(scene);
  controllerRays.group.name = 'wheel-controller-rays';
  const rayActions = new Map<XRInputSource, Choice<Action>>();
  const gesture = createHandMenuGesture();
  const pointer = createPointer();
  const aim = new THREE.Object3D();
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.0035, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd091, depthTest: false, depthWrite: false }),
  );
  dot.visible = false;
  dot.renderOrder = 1001;
  scene.add(dot);
  let handHover: Choice<Action> | null = null;
  let selecting: XRInputSource | undefined;
  let generation = 0;
  let previousTime: number | undefined;
  let disposed = false;

  function close() {
    menu?.close();
    nav?.reset();
    owner = undefined;
    handHover = null;
    selecting = undefined;
    rayActions.clear();
    controllerRays.clear();
    dot.visible = false;
  }
  function open(source: XRInputSource) {
    owner = source;
    generation++;
    for (const press of triggerStart.values()) press.generation = -1;
    menu?.open();
  }
  function discardMenu() {
    close();
    menu?.root.removeFromParent();
    menu?.dispose();
    menu = undefined;
    nav = undefined;
    layout = [];
  }
  function prepare(items: readonly RadialMenuItem<Action>[]) {
    discardMenu();
    layout = items;
    menu = createRadialMenu({ items });
    root.add(menu.root);
    nav = createStickRadialNavigation({
      menu,
      items: items.map((item) => item.id),
      onOpen: open,
      onClose: close,
    });
  }
  function matchesLayout(items: readonly RadialMenuItem<Action>[]) {
    return (
      items === layout ||
      (items.length === layout.length &&
        items.every((item, i) => item.id === layout[i].id && item.label === layout[i].label))
    );
  }
  function reset() {
    discardMenu();
    gesture.reset();
    pressed.clear();
    triggerStart.clear();
    previousTime = undefined;
  }
  return {
    get isModal() {
      return menu?.root.visible === true;
    },
    update(
      frame: XRFrame,
      reference: XRReferenceSpace,
      time: number,
      items: readonly RadialMenuItem<Action>[],
      busy: boolean,
    ) {
      if (disposed) return;
      const dt =
        previousTime === undefined ? 0 : THREE.MathUtils.clamp(time - previousTime, 0, 0.1);
      previousTime = time;
      menu?.update(dt);
      const sameLayout = matchesLayout(items);
      if (menu?.isOpen && !sameLayout) close();
      let opening: XRInputSource | undefined;
      let gripHeld = busy;
      let sticksDown = 0;
      for (const source of frame.session.inputSources) {
        const pad = source.gamepad;
        if (!pad || source.hand || !source.gripSpace || !pad.buttons[3]) continue;
        gripHeld ||= !!pad.buttons[1]?.pressed;
        const down = pad.buttons[3].pressed;
        if (down) sticksDown++;
        if (pressed.get(source) === false && down && !opening) opening = source;
        pressed.set(source, down);
      }
      for (const source of pressed.keys()) {
        if (!Array.from(frame.session.inputSources).includes(source)) {
          pressed.delete(source);
          triggerStart.delete(source);
          if (selecting === source) selecting = undefined;
        }
      }
      const toggle = gesture.update(frame, reference, time, !gripHeld && (!owner || !!owner.hand));
      if (owner && !Array.from(frame.session.inputSources).includes(owner)) close();
      const handPose = owner?.hand && frame.getPose(owner.targetRaySpace, reference);
      if (owner?.hand) {
        const wrist = owner.hand.get('wrist');
        if (toggle === owner || !wrist || !frame.getJointPose?.(wrist, reference)) close();
      } else if (
        owner &&
        (!pressed.has(owner) || !owner.gripSpace || !frame.getPose(owner.gripSpace, reference))
      ) {
        close();
      }
      const candidate = sticksDown === 0 ? toggle : sticksDown === 1 ? opening : undefined;
      if (!menu?.root.visible && candidate && !gripHeld && items.length >= 2) {
        const viewer = frame.getViewerPose(reference);
        if (
          !viewer ||
          (!candidate.hand &&
            (!candidate.gripSpace || !frame.getPose(candidate.gripSpace, reference)))
        )
          return;
        if (!menu || !sameLayout) prepare(items);
        root.quaternion.copy(viewer.transform.orientation);
        root.position
          .set(0, -0.035, -0.56)
          .applyQuaternion(root.quaternion)
          .add(viewer.transform.position);
        if (candidate.hand) open(candidate);
        else {
          nav?.update(candidate, { pressed: false, x: 0, y: 0 });
          nav?.update(candidate, { pressed: true, x: 0, y: 0 });
        }
      }
      if (owner?.hand && menu?.interactive && handPose) {
        aim.position.copy(handPose.transform.position);
        aim.quaternion.copy(handPose.transform.orientation);
        root.updateWorldMatrix(true, true);
        const hit = pointer.castFrom(aim, [menu.root]);
        handHover = hit ? menu.actionAt(hit.object) : null;
        dot.visible = !!hit && handHover !== null;
        if (hit) dot.position.copy(hit.point);
        menu.setHovered(
          selecting === owner ? (triggerStart.get(owner)?.action ?? null) : handHover,
        );
      } else if (owner?.hand && !handPose) {
        dot.visible = false;
        handHover = null;
        menu?.setHovered(null);
      } else if (!owner?.hand && owner?.gamepad && menu?.isOpen) {
        const pad = owner.gamepad,
          i = pad.axes.length >= 4 ? 2 : 0;
        nav?.update(owner, {
          pressed: pad.buttons[3].pressed,
          x: pad.axes[i] ?? 0,
          y: pad.axes[i + 1] ?? 0,
        });
        if (menu.interactive) {
          root.updateWorldMatrix(true, true);
          const beams: PlacementRayTarget[] = [];
          rayActions.clear();
          for (const source of frame.session.inputSources) {
            if (source.hand || !source.gamepad) continue;
            const pose = frame.getPose(source.targetRaySpace, reference);
            if (!pose) continue;
            aim.position.copy(pose.transform.position);
            aim.quaternion.copy(pose.transform.orientation);
            const hit = pointer.castFrom(aim, [menu.root]);
            const action = hit && menu.actionAt(hit.object);
            if (action) rayActions.set(source, action);
            beams.push({
              source,
              origin: aim.position.clone(),
              direction: new THREE.Vector3(0, 0, -1).applyQuaternion(aim.quaternion),
              distance: hit?.distance ?? 0.8,
              contact: !!action,
              valid: true,
            });
          }
          controllerRays.update(beams);
          const hovered =
            nav?.choice() ?? rayActions.get(owner) ?? rayActions.values().next().value ?? 'cancel';
          menu.setHovered(selecting ? (triggerStart.get(selecting)?.action ?? null) : hovered);
        }
      }
    },
    handleSelectStart(source: XRInputSource) {
      if (disposed) return;
      const aimed = rayActions.get(source);
      const eligible = menu?.interactive && (source === owner || aimed !== undefined);
      const action = owner?.hand ? handHover : nav?.selectionFor(source, aimed ?? null);
      triggerStart.set(source, {
        generation: menu?.root.visible ? (eligible ? generation : -1) : 0,
        action: action ?? null,
      });
      if (eligible) selecting = source;
    },
    handleSelect(source: XRInputSource) {
      const press = triggerStart.get(source);
      triggerStart.delete(source);
      if (selecting === source) selecting = undefined;
      if (!menu?.root.visible && !press?.generation) return false;
      if (menu?.interactive && press?.generation === generation) {
        if (owner?.hand && !press.action) return true;
        close();
        if (press.action && press.action !== 'cancel') dispatch(press.action);
      }
      return true;
    },
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      root.removeFromParent();
      dot.removeFromParent();
      dot.geometry.dispose();
      dot.material.dispose();
      controllerRays.dispose();
    },
  };
}
