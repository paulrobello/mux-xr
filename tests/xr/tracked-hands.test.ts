import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@par/xr-workspace', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).withLabelsAndCountingHand(
    await importOriginal<typeof import('@par/xr-workspace')>(),
  ),
);
vi.mock('three', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).createThreeMock(
    await importOriginal<typeof import('three')>(),
  ),
);

import * as THREE from 'three';
import type { createWorkspaceScene } from '../../src/xr/scene';
import {
  aimController,
  aimControllerAtScreen,
  connectController,
  fakeXR,
  fixture,
  handPoses,
  hit,
  objectWithData,
  resetXRControllers,
} from '../helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

  describe('tracked hand sources', () => {
    type Hand = THREE.Group & { joints: Record<string, THREE.Group> };
    const cleanups: Array<() => void> = [];
    afterEach(() => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      vi.unstubAllGlobals();
    });
    const setup = (
      keyborbMode: 'off' | 'on' | 'auto' = 'off',
      options?: Parameters<typeof fixture>[0],
    ) => {
      const value = fixture(options);
      value.workspace.setKeyborbMode(keyborbMode);
      cleanups.push(() => {
        value.workspace.dispose();
        value.container.remove();
      });
      value.workspace.selectTerminal('pane-a');
      return value;
    };
    const connectHand = (index = 0): Hand => {
      const hand = fakeXR.hands[index] as Hand;
      hand.visible = true;
      for (const name of ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip']) {
        const joint = new THREE.Group();
        joint.position.set(index ? -0.2 : 0.2, 1.2, -0.4);
        hand.joints[name] = joint;
        hand.add(joint);
      }
      hand.joints['index-finger-tip'].position.x += 0.08;
      hand.joints['middle-finger-tip'].position.y += 0.08;
      const data = {
        hand: new Map(Object.keys(hand.joints).map((jointName) => [jointName, { jointName }])),
        handedness: index ? 'left' : 'right',
      };
      (fakeXR.controllers[index] as THREE.Group).dispatchEvent({
        type: 'connected',
        data,
      } as never);
      hand.dispatchEvent({ type: 'connected', data } as never);
      fakeXR.frame?.(1);
      return hand;
    };
    const nativeEvent = (index: number, type: string): void => {
      (fakeXR.controllers[index] as THREE.Group).dispatchEvent({ type } as never);
      (fakeXR.hands[index] as Hand).dispatchEvent({ type } as never);
    };
    const pinch = (hand: Hand, held: boolean): void => {
      hand.joints['middle-finger-tip'].position.copy(hand.joints['thumb-tip'].position);
      if (!held) hand.joints['middle-finger-tip'].position.y += 0.08;
    };
    const contactKey = (
      workspace: ReturnType<typeof createWorkspaceScene>,
      hand: Hand,
      key: string,
      depth: number,
      time: number,
    ): void => contactControl(workspace, hand, { inputAction: 'key', key }, depth, time);
    const contactControl = (
      workspace: ReturnType<typeof createWorkspaceScene>,
      hand: Hand,
      data: Record<string, unknown>,
      depth: number,
      time: number,
    ): void => {
      const button = objectWithData(workspace, data);
      const point = button.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        button.getWorldQuaternion(new THREE.Quaternion()),
      );
      hand.joints.wrist.position
        .copy(point)
        .add(new THREE.Vector3(0, -0.12, 0))
        .addScaledVector(normal, 0.08);
      hand.joints['thumb-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new THREE.Vector3(-0.06, 0.04, 0));
      hand.joints['middle-finger-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new THREE.Vector3(0, 0.17, 0));
      hand.joints['index-finger-tip'].position.copy(point).addScaledVector(normal, depth);
      fakeXR.frame?.(time);
    };

    // Index and thumb tips straddle the node; the middle finger stays clear of a grab pinch.
    const pinchAt = (hand: Hand, point: THREE.Vector3, gap: number, time: number): void => {
      hand.joints.wrist.position.copy(point).add(new THREE.Vector3(0, -0.12, 0.1));
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0, gap / 2, 0.02));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(0, -gap / 2, 0.02));
      hand.joints['middle-finger-tip'].position
        .copy(hand.joints.wrist.position)
        .add(new THREE.Vector3(0.05, 0.17, 0));
      fakeXR.frame?.(time);
    };

    it('selects a hierarchy pane node with a touch pinch and swallows its native select', () => {
      const { workspace, actions } = setup('off');
      connectController(0);
      workspace.showInput('panes');
      for (const title of ['Workspace', 'Session', 'Window']) {
        hit(workspace, { inputAction: 'hierarchyNode', originalTitle: title });
        for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(100 + frame * 16);
      }
      vi.mocked(actions.selectPane).mockClear();
      const hand = connectHand();
      const node = objectWithData(workspace, { inputAction: 'pane', paneId: 'pane-b' });
      workspace.scene.updateMatrixWorld(true);
      const point = node.getWorldPosition(new THREE.Vector3());
      pinchAt(hand, point, 0.08, 1000);
      pinchAt(hand, point, 0.08, 1016);
      expect(workspace.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(true);
      pinchAt(hand, point, 0.02, 1032);
      nativeEvent(0, 'selectstart');
      expect(actions.selectPane).not.toHaveBeenCalled();
      pinchAt(hand, point, 0.08, 1048);
      nativeEvent(0, 'selectend');
      expect(actions.selectPane).toHaveBeenCalledTimes(1);
      expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
      expect(workspace.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(false);
    });

    it('grabs the whole hierarchy with a hand closed at a non-pane node', () => {
      const { workspace } = setup('off');
      connectController(0);
      workspace.showInput('panes');
      const hand = connectHand();
      const node = objectWithData(workspace, {
        inputAction: 'hierarchyNode',
        originalTitle: 'Session',
      });
      workspace.scene.updateMatrixWorld(true);
      // Within pinch reach of the node but clear of the fingertip and palm contact probes.
      const mesh = node as THREE.Mesh;
      mesh.geometry.computeBoundingSphere();
      const bounds = (mesh.geometry.boundingSphere as THREE.Sphere)
        .clone()
        .applyMatrix4(mesh.matrixWorld);
      const point = bounds.center.clone().add(new THREE.Vector3(0, 0, bounds.radius + 0.06));
      pinchAt(hand, point, 0.08, 1000);
      expect(workspace.scene.getObjectByName('hierarchy-touch-marker')?.visible).toBe(true);
      const root = workspace.scene.getObjectByName('hierarchy-navigator')?.parent;
      const before = root?.position.clone() ?? new THREE.Vector3();
      pinch(hand, true);
      fakeXR.frame?.(1016);
      expect(workspace.scene.getObjectByName('pane-pull-proxy')).toBeUndefined();
      for (const joint of Object.values(hand.joints)) joint.position.x += 0.3;
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(1032 + frame * 16);
      expect(root?.position.distanceTo(before)).toBeGreaterThan(0.2);
    });

    it('ignores a hierarchy pinch that closed away from every node', () => {
      const { workspace, actions } = setup('off');
      connectController(0);
      workspace.showInput('panes');
      const hand = connectHand();
      const node = objectWithData(workspace, {
        inputAction: 'hierarchyNode',
        originalTitle: 'Session',
      });
      workspace.scene.updateMatrixWorld(true);
      const point = node.getWorldPosition(new THREE.Vector3());
      const path = workspace.scene.getObjectByName('hierarchy-navigator')?.userData.hierarchyPath;
      pinchAt(hand, point.clone().add(new THREE.Vector3(0, 0.4, 0)), 0.02, 1000);
      pinchAt(hand, point, 0.02, 1016);
      pinchAt(hand, point, 0.08, 1032);
      expect(
        workspace.scene.getObjectByName('hierarchy-navigator')?.userData.hierarchyPath,
      ).toEqual(path);
      expect(actions.selectPane).not.toHaveBeenCalled();
    });

    it('uses the native controller ray despite stray palm metadata', () => {
      const { workspace } = setup('off');
      connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const visual = workspace.scene.getObjectByName('xr-cartoon-hand');
      const line = controller.children.find((child) => child instanceof THREE.Line) as THREE.Line;
      if (!visual || !line) throw new Error('Tracked hand ray fixtures missing');
      const palmPosition = new THREE.Vector3(0.42, 1.18, -0.72);
      const palmNormal = new THREE.Vector3(0.6, 0.2, -0.77).normalize();
      visual.userData.renderedPalmPosition = palmPosition;
      visual.userData.renderedPalmDirection = palmNormal;
      controller.position.set(-0.3, 0.8, 0.4);
      controller.rotation.set(0.2, -0.35, 0.1);
      controller.scale.set(1.7, 0.8, 1.3);
      fakeXR.frame?.(32);
      const nativeOrigin = controller.getWorldPosition(new THREE.Vector3());
      const nativeDirection = controller.getWorldDirection(new THREE.Vector3());
      expect(line.getWorldPosition(new THREE.Vector3()).distanceTo(nativeOrigin)).toBeLessThan(
        1e-6,
      );
      expect(line.getWorldDirection(new THREE.Vector3()).distanceTo(nativeDirection)).toBeLessThan(
        1e-6,
      );
    });

    it('switches Auto on hand source changes without moving or retargeting the keyboard', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      expect(workspace.state.keyborbEnabled).toBe(false);
      let root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      root.position.set(0.2, 1.1, -0.9);
      root.rotation.set(0.1, 0.2, -0.1);
      root.scale.setScalar(0.5);
      const position = root.position.clone();
      const quaternion = root.quaternion.clone();
      connectHand();
      expect(workspace.state.keyborbEnabled).toBe(true);
      root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      expect(root.position.distanceTo(position)).toBeLessThan(1e-8);
      expect(root.quaternion.angleTo(quaternion)).toBeLessThan(1e-8);
      expect(root.scale.x).toBe(0.5);
      expect(workspace.state.inputTargetId).toBe('pane-a');
      expect(actions.sendKey).not.toHaveBeenCalled();
      connectController(0);
      expect(workspace.state.keyborbEnabled).toBe(false);
      expect(objectWithData(workspace, { key: 'a' }).userData.keyborb).toBeUndefined();
    });

    it('renders all 68 spherical keys and keeps them spherical on a curved keyboard', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      workspace.setKeyboardCurvature(60);
      const root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const keys = root.children.filter((child) => child.userData.inputAction === 'key');
      expect(keys).toHaveLength(68);
      for (const key of keys) {
        expect((key as THREE.Mesh).geometry).toBeInstanceOf(THREE.SphereGeometry);
        expect(key.userData.labelText).toBeTruthy();
        expect((key as THREE.Mesh).material).toMatchObject({
          transparent: true,
          depthWrite: false,
        });
      }
      hit(workspace, { key: 'a' });
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hit(workspace, { key: 'Shift' });
      expect(objectWithData(workspace, { key: 'b' }).userData.labelText).toBe('B');
      hit(workspace, { key: 'b' });
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', { shift: true });
      expect(objectWithData(workspace, { key: 'b' }).userData.labelText).toBe('b');
      const key = objectWithData(workspace, { key: 'a' }) as THREE.Mesh;
      const disposeGeometry = vi.spyOn(key.geometry, 'dispose');
      const disposeMaterial = vi.spyOn(key.material as THREE.Material, 'dispose');
      workspace.setKeyborbMode('off');
      expect(disposeGeometry).toHaveBeenCalledOnce();
      expect(disposeMaterial).toHaveBeenCalledOnce();
    });

    it('requires pinch selection instead of typing from Keyborb hand contact', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      expect(workspace.state.keyborbEnabled).toBe(true);
      contactKey(workspace, hand, 'a', 0.06, 20);
      contactKey(workspace, hand, 'a', 0.004, 40);
      fakeXR.frame?.(60);
      expect(actions.sendKey).not.toHaveBeenCalled();
      const orb = objectWithData(workspace, { inputAction: 'key', key: 'a' });
      const point = orb.getWorldPosition(new THREE.Vector3());
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.04, 0, 0));
      fakeXR.frame?.(80);
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.02, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.02, 0, 0));
      fakeXR.frame?.(90);
      expect(actions.sendKey).not.toHaveBeenCalled();
      expect(
        (orb as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>).material.uniforms.pressed
          .value,
      ).toBe(1);
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.04, 0, 0));
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(100 + frame * 16);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      const rebuiltOrb = objectWithData(workspace, { inputAction: 'key', key: 'a' }) as THREE.Mesh<
        THREE.SphereGeometry,
        THREE.ShaderMaterial
      >;
      expect(rebuiltOrb.material.uniforms.pressed.value).toBeGreaterThan(0);
      for (let frame = 0; frame < 20; frame++) fakeXR.frame?.(170 + frame * 16);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hand.joints['index-finger-tip'].position.x += 0.08;
      fakeXR.frame?.(500);
      expect(rebuiltOrb.material.uniforms.pressed.value).toBe(0);
      nativeEvent(0, 'selectend');
      nativeEvent(0, 'select');
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      expect(
        (fakeXR.controllers[0] as THREE.Group).children.find((child) => child instanceof THREE.Line)
          ?.visible,
      ).toBe(false);
      workspace.setKeyborbMode('off');
      expect(workspace.state.keyborbEnabled).toBe(false);
      workspace.setKeyborbMode('on');
      connectController(0);
      expect(workspace.state.keyborbEnabled).toBe(true);
    });

    it('poses a tracked hand once per frame however often keyboard proximity is checked', () => {
      const { workspace } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const key = objectWithData(workspace, { inputAction: 'key', key: 'g' });
      const point = key.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 0.05));
      hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.04, 0, 0));
      fakeXR.frame?.(20);
      const before = handPoses.count;
      fakeXR.frame?.(40);
      expect(handPoses.count - before).toBe(1);
      const visual = workspace.scene.children.find(
        (object) => object.name === 'xr-cartoon-hand' && object.userData.handedness === 'right',
      );
      if (!visual) throw new Error('Hand visual missing');
      const tip = (): number => (visual.userData.indexTip as THREE.Vector3).x;
      const framed = tip();
      // three moves the joints to the event's own frame before dispatching it.
      hand.joints['index-finger-tip'].position.x += 0.05;
      nativeEvent(0, 'selectstart');
      expect(tip() - framed).toBeCloseTo(0.05, 3);
      nativeEvent(0, 'selectend');
      const events = handPoses.count;
      fakeXR.frame?.(60);
      expect(handPoses.count - events).toBe(1);
    });

    it('targets the rendered finger midpoint while using tracked separation for the pinch', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const rawKey = objectWithData(workspace, { inputAction: 'key', key: 'a' });
      const visibleKey = objectWithData(workspace, { inputAction: 'key', key: 'b' });
      const rawPoint = rawKey.getWorldPosition(new THREE.Vector3());
      const visiblePoint = visibleKey
        .getWorldPosition(new THREE.Vector3())
        .add(new THREE.Vector3(0, 0, 0.06));
      const visual = workspace.scene.children.find(
        (object) => object.name === 'xr-cartoon-hand' && object.userData.handedness === 'right',
      );
      if (!visual) throw new Error('Hand visual missing');
      visual.userData.keyborbPoint = visiblePoint;
      hand.joints['index-finger-tip'].position.copy(rawPoint).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(rawPoint).add(new THREE.Vector3(-0.04, 0, 0));
      fakeXR.frame?.(20);
      hand.joints['index-finger-tip'].position.copy(rawPoint).add(new THREE.Vector3(0.02, 0, 0));
      hand.joints['thumb-tip'].position.copy(rawPoint).add(new THREE.Vector3(-0.02, 0, 0));
      fakeXR.frame?.(40);
      expect(actions.sendKey).not.toHaveBeenCalled();
      hand.joints['index-finger-tip'].position.copy(rawPoint).add(new THREE.Vector3(0.04, 0, 0));
      hand.joints['thumb-tip'].position.copy(rawPoint).add(new THREE.Vector3(-0.04, 0, 0));
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(60 + frame * 20);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('b', undefined);
    });

    it('starts and stops dictation from a pinch on the Keyborb Mic orb', () => {
      const { workspace, actions } = setup('on');
      const dictationAction = vi.fn();
      actions.dictationAction = dictationAction;
      const idle = { supported: true, status: 'idle', transcript: '', error: null } as const;
      workspace.setDictationState(idle);
      workspace.showInput('keyboard');
      const hand = connectHand();
      const pinchOrb = (start: number): void => {
        const mic = workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh;
        const point = mic.getWorldPosition(new THREE.Vector3());
        const spread = (gap: number): void => {
          hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(gap, 0, 0));
          hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-gap, 0, 0));
        };
        const before = dictationAction.mock.calls.length;
        spread(0.04);
        fakeXR.frame?.(start);
        spread(0.02);
        fakeXR.frame?.(start + 20);
        expect(dictationAction).toHaveBeenCalledTimes(before);
        spread(0.04);
        for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(start + 40 + frame * 20);
      };
      const mic = workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh;
      expect(mic.geometry).toBeInstanceOf(THREE.SphereGeometry);
      expect(mic.userData.labelText).toBe('Mic');
      pinchOrb(20);
      expect(dictationAction).toHaveBeenCalledExactlyOnceWith('start');
      expect(actions.sendKey).not.toHaveBeenCalled();
      workspace.setDictationState({ ...idle, status: 'listening' });
      expect(
        (workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh).userData.labelText,
      ).toBe('Stop');
      pinchOrb(400);
      expect(dictationAction).toHaveBeenLastCalledWith('stop');
      expect(dictationAction).toHaveBeenCalledTimes(2);
      workspace.setDictationState({ ...idle, status: 'transcribing' });
      expect(
        (workspace.scene.getObjectByName('keyborb-dictation') as THREE.Mesh).userData.inputAction,
      ).toBe('noop');
    });

    it('draws all orb shells in one instanced call that follows the orbs', () => {
      const { workspace } = setup('on');
      workspace.showInput('keyboard');
      connectHand();
      fakeXR.frame?.(16);
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const orbs = keyboard.children.filter(
        (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> =>
          child.userData.keyborb === true,
      );
      const shells = keyboard.getObjectByName('keyborb-shells') as THREE.InstancedMesh;
      expect(orbs.length).toBeGreaterThan(60);
      expect(shells.count).toBe(orbs.length);
      expect(keyboard.getObjectByName('keyborb-glyphs')).toBeDefined();
      for (const orb of orbs) expect(orb.material.visible).toBe(false);
      const index = orbs.findIndex((orb) => orb.userData.key === 'g');
      orbs[index].material.uniforms.pressed.value = 1;
      fakeXR.frame?.(32);
      const pressed = shells.geometry.getAttribute('instancePressed') as THREE.BufferAttribute;
      expect(pressed.getX(index)).toBe(1);
      const matrix = new THREE.Matrix4();
      shells.getMatrixAt(index, matrix);
      expect(
        new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(orbs[index].position),
      ).toBeLessThan(1e-6);
    });

    it('drops the panel Dictation button when the Keyborb Mic orb is shown', () => {
      const idle = { supported: true, status: 'idle', transcript: '', error: null } as const;
      const orb = setup('on');
      orb.workspace.setDictationState(idle);
      orb.workspace.showInput('keyboard');
      connectHand();
      fakeXR.frame?.(16);
      expect(orb.workspace.scene.getObjectByName('keyborb-dictation')).toBeDefined();
      expect(orb.workspace.scene.getObjectByName('xr-dictate-button')).toBeUndefined();
      const headings = () => {
        let count = 0;
        orb.workspace.scene.traverse((object) => {
          if (object.name === 'xr-dictation-transcript-heading') count += 1;
        });
        return count;
      };
      expect(headings()).toBe(0);
      orb.workspace.setDictationState({ ...idle, status: 'review', transcript: 'hello' });
      expect(orb.workspace.scene.getObjectByName('xr-dictate-button')).toBeUndefined();
      expect(headings()).toBe(1);
      orb.workspace.setDictationState({ ...idle, status: 'review', transcript: 'hello there' });
      expect(headings()).toBe(1);
      const insert = [] as THREE.Object3D[];
      orb.workspace.scene.traverse((object) => {
        if (object.userData.dictationAction === 'insert') insert.push(object);
      });
      expect(insert).toHaveLength(1);
      orb.workspace.setDictationState(idle);
      expect(headings()).toBe(0);
      orb.workspace.dispose();
      orb.container.remove();
      const flat = setup('off');
      flat.workspace.setDictationState(idle);
      flat.workspace.showInput('keyboard');
      expect(flat.workspace.scene.getObjectByName('xr-dictate-button')?.userData.labelText).toBe(
        'Dictation',
      );
    });

    it('scrolls from a hand index pinch on the edge strip and stops when Focus changes', () => {
      const { workspace, actions } = setup('off');
      actions.scrollTerminal = vi.fn(() => true);
      connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const strip = workspace.scene
        .getObjectByName('terminal-panel-pane-b')
        ?.getObjectByName('terminal-scroll-strip') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      const rest = strip.material.opacity;
      const line = 0.8 / 24;
      const aim = (y: number, time: number): void => {
        aimControllerAtScreen(controller, strip, new THREE.Vector3(0, y, 0));
        fakeXR.frame?.(time);
      };
      aim(0, 10);
      nativeEvent(0, 'selectstart');
      aim(-line * 0.6, 20);
      aim(-line * 2.7, 30);
      expect(actions.scrollTerminal).toHaveBeenCalledExactlyOnceWith('pane-b', -2);
      expect(strip.material.opacity).toBeGreaterThan(rest);
      expect(workspace.state.selectedTerminalId).toBe('pane-b');
      workspace.toggleFocusMode('pane-b');
      aim(-line * 9, 40);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
      expect(strip.material.opacity).toBe(rest);
    });

    it('offers the Mic orb only on a Keyborb text keyboard with speech support', () => {
      const { workspace } = setup('off');
      workspace.showInput('keyboard');
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeUndefined();
      workspace.setDictationState({ supported: true, status: 'idle', transcript: '', error: null });
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeUndefined();
      workspace.setKeyborbMode('on');
      workspace.showInput('keyboard');
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeDefined();
      workspace.setDictationState({
        supported: false,
        status: 'idle',
        transcript: '',
        error: null,
      });
      expect(workspace.scene.getObjectByName('keyborb-dictation')).toBeUndefined();
    });

    it('changes Keyborb modes through native Settings controls', () => {
      const { workspace } = setup('off');
      workspace.showInput('settings');
      hit(workspace, { inputAction: 'keyborbMode', keyborbMode: 'on' });
      expect(workspace.state.keyborbMode).toBe('on');
      expect(workspace.state.keyborbEnabled).toBe(true);
      hit(workspace, { inputAction: 'keyborbMode', keyborbMode: 'auto' });
      expect(workspace.state.keyborbMode).toBe('auto');
      expect(workspace.state.keyborbEnabled).toBe(false);
      connectHand();
      expect(workspace.state.keyborbEnabled).toBe(true);
      nativeEvent(0, 'disconnected');
      expect(workspace.state.keyborbEnabled).toBe(false);
    });

    it('accepts native Keyborb pinches after a natural opening with other fingers relaxed', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const point = objectWithData(workspace, { inputAction: 'key', key: 'a' }).getWorldPosition(
        new THREE.Vector3(),
      );
      hand.joints['index-finger-tip'].position.copy(point);
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.048, 0, 0));
      hand.joints['middle-finger-tip'].position
        .copy(hand.joints['thumb-tip'].position)
        .add(new THREE.Vector3(0, 0.03, 0));
      hand.joints.wrist.visible = false;
      fakeXR.frame?.(10);
      hand.joints.wrist.visible = true;
      fakeXR.frame?.(20);
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.02, 0, 0));
      fakeXR.frame?.(40);
      expect(actions.sendKey).not.toHaveBeenCalled();
      hit(workspace, { inputAction: 'key', key: 'a' });
      expect(actions.sendKey).not.toHaveBeenCalled();
      hit(workspace, { inputAction: 'key', key: 'a' });
      fakeXR.frame?.(60);
      expect(actions.sendKey).not.toHaveBeenCalled();
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hit(workspace, { inputAction: 'key', key: 'a' });
      fakeXR.frame?.(80);
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).toHaveBeenCalledTimes(1);
    });

    it('does not type a native Keyborb release while the other hand grabs a window', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const point = objectWithData(workspace, { inputAction: 'key', key: 'a' }).getWorldPosition(
        new THREE.Vector3(),
      );
      hand.joints['index-finger-tip'].position.copy(point);
      hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-0.07, 0, 0));
      fakeXR.frame?.(20);
      hit(workspace, { inputAction: 'key', key: 'a' });
      const other = fakeXR.controllers[1] as THREE.Group;
      aimController(other, objectWithData(workspace, { terminalId: 'pane-b' }));
      other.dispatchEvent({ type: 'squeezestart' } as never);
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).not.toHaveBeenCalled();
    });

    const holdKeyborbA = (workspace: ReturnType<typeof createWorkspaceScene>, hand: Hand) => {
      const orb = objectWithData(workspace, { inputAction: 'key', key: 'a' });
      const point = orb.getWorldPosition(new THREE.Vector3());
      const spread = (gap: number): void => {
        hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(gap, 0, 0));
        hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(-gap, 0, 0));
      };
      spread(0.04);
      fakeXR.frame?.(80);
      spread(0.02);
      fakeXR.frame?.(90);
      expect(
        (orb as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>).material.uniforms.pressed
          .value,
      ).toBe(1);
      return spread;
    };

    it.each(['thumb-tip', 'index-finger-tip', 'wrist', 'middle-finger-tip'])(
      'keeps a held Keyborb key through a brief %s tracking dropout',
      (joint) => {
        const { workspace, actions } = setup('auto');
        workspace.showInput('keyboard');
        const hand = connectHand();
        const spread = holdKeyborbA(workspace, hand);
        hand.joints[joint].visible = false;
        fakeXR.frame?.(106);
        fakeXR.frame?.(122);
        hand.joints[joint].visible = true;
        fakeXR.frame?.(138);
        expect(actions.sendKey).not.toHaveBeenCalled();
        spread(0.04);
        for (let frame = 0; frame < 6; frame++) fakeXR.frame?.(160 + frame * 16);
        expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      },
    );

    it('types a held Keyborb key when the native release lands in a tracking gap', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      holdKeyborbA(workspace, hand);
      hit(workspace, { inputAction: 'key', key: 'a' });
      hand.joints['thumb-tip'].visible = false;
      fakeXR.frame?.(106);
      nativeEvent(0, 'selectend');
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      hand.joints['thumb-tip'].visible = true;
      for (let frame = 0; frame < 6; frame++) fakeXR.frame?.(122 + frame * 16);
      expect(actions.sendKey).toHaveBeenCalledOnce();
    });

    it('drops a held Keyborb key when tracking stays lost past the grace', () => {
      const { workspace, actions } = setup('auto');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const spread = holdKeyborbA(workspace, hand);
      hand.joints['thumb-tip'].visible = false;
      for (let frame = 0; frame < 12; frame++) fakeXR.frame?.(106 + frame * 16);
      hand.joints['thumb-tip'].visible = true;
      spread(0.04);
      for (let frame = 0; frame < 6; frame++) fakeXR.frame?.(320 + frame * 16);
      expect(actions.sendKey).not.toHaveBeenCalled();
    });

    it.each(['off', 'on'] as const)(
      'suppresses both distant rays when either hand is near the %s keyboard',
      (mode) => {
        const { workspace, actions } = setup(mode);
        workspace.showInput('keyboard');
        const near = connectHand(0);
        const far = connectHand(1);
        const other = fakeXR.controllers[1] as THREE.Group;
        const panel = objectWithData(workspace, { terminalId: 'pane-b' });
        aimController(other, panel);
        contactKey(workspace, near, 'a', 0.06, 20);
        for (const controller of fakeXR.controllers as THREE.Group[])
          expect(controller.children.find((child) => child instanceof THREE.Line)?.visible).toBe(
            false,
          );
        vi.mocked(actions.selectPane).mockClear();
        nativeEvent(1, 'selectstart');
        expect(workspace.state.selectedTerminalId).toBe('pane-a');
        expect(actions.selectPane).not.toHaveBeenCalledWith('pane-b');
        const position = panel.position.clone();
        pinch(far, true);
        fakeXR.frame?.(40);
        for (const joint of Object.values(far.joints)) joint.position.x += 0.1;
        fakeXR.frame?.(60);
        expect(panel.position.distanceTo(position)).toBeLessThan(1e-8);
        pinch(far, false);
        for (const hand of [near, far])
          for (const joint of Object.values(hand.joints)) joint.position.z += 2;
        fakeXR.frame?.(80);
        for (const controller of fakeXR.controllers as THREE.Group[])
          expect(controller.children.find((child) => child instanceof THREE.Line)?.visible).toBe(
            true,
          );
        aimController(other, panel);
        nativeEvent(1, 'selectstart');
        expect(workspace.state.selectedTerminalId).toBe('pane-b');
      },
    );

    it('keeps forgiving pinch modifier holds and cancels held pinches when retargeting', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand();
      const pose = (key: string, gap: number, time: number): void => {
        const button = objectWithData(workspace, { inputAction: 'key', key });
        const point = button.getWorldPosition(new THREE.Vector3());
        hand.joints['index-finger-tip'].position.copy(point).add(new THREE.Vector3(-gap / 2, 0, 0));
        hand.joints['thumb-tip'].position.copy(point).add(new THREE.Vector3(gap / 2, 0, 0));
        hand.joints['middle-finger-tip'].position
          .copy(hand.joints['thumb-tip'].position)
          .add(new THREE.Vector3(0, 0.12, 0));
        fakeXR.frame?.(time);
      };
      pose('Shift', 0.08, 100);
      pose('Shift', 0.04, 120);
      expect(objectWithData(workspace, { key: 'Shift' }).userData.activeState).toBe(true);
      nativeEvent(0, 'selectend');
      fakeXR.frame?.(800);
      const shift = objectWithData(workspace, { key: 'Shift' });
      expect(shift.userData.locked).toBe(true);
      expect(shift.userData.keyborbLabel.userData.labelText).toBe('Shift\nlock');
      pose('Shift', 0.08, 900);
      pose('Shift', 0.08, 910);
      pose('b', 0.04, 930);
      expect(actions.sendKey).not.toHaveBeenCalled();
      for (let frame = 0; frame < 3; frame++) pose('b', 0.08, 950 + frame * 20);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('b', { shift: true });
      pose('b', 0.04, 1020);
      workspace.selectTerminal('pane-b');
      for (let frame = 0; frame < 3; frame++) pose('b', 0.08, 1040 + frame * 20);
      expect(actions.sendKey).toHaveBeenCalledTimes(1);
      pose('b', 0.04, 1120);
      for (let frame = 0; frame < 3; frame++) pose('b', 0.08, 1140 + frame * 20);
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', undefined);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
      expect(workspace.state.inputTargetId).toBe('pane-b');
    });

    it('accepts both hands pinching separate orbs in the same frame', () => {
      const { workspace, actions } = setup('on');
      workspace.showInput('keyboard');
      const hands = [connectHand(0), connectHand(1)];
      const points = ['a', 'b'].map((key) =>
        objectWithData(workspace, { inputAction: 'key', key }).getWorldPosition(
          new THREE.Vector3(),
        ),
      );
      const pose = (gap: number): void => {
        for (const [index, hand] of hands.entries()) {
          hand.joints['index-finger-tip'].position
            .copy(points[index])
            .add(new THREE.Vector3(-gap / 2, 0, 0));
          hand.joints['thumb-tip'].position
            .copy(points[index])
            .add(new THREE.Vector3(gap / 2, 0, 0));
          hand.joints['middle-finger-tip'].position
            .copy(hand.joints['thumb-tip'].position)
            .add(new THREE.Vector3(0, 0.12, 0));
        }
      };
      pose(0.08);
      fakeXR.frame?.(100);
      pose(0.04);
      fakeXR.frame?.(120);
      expect(actions.sendKey).not.toHaveBeenCalled();
      pose(0.08);
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(140 + frame * 20);
      expect(vi.mocked(actions.sendKey).mock.calls).toEqual([
        ['a', undefined],
        ['b', undefined],
      ]);
      fakeXR.frame?.(240);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
    });

    it('hides both hand rays and types once per index poke without ray selection', () => {
      const { workspace, actions } = setup();
      workspace.showInput('keyboard');
      const hand = connectHand(0);
      connectHand(1);
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.set(5, 5, 0);
      contactKey(workspace, hand, 'a', 0.06, 20);
      const ray = controller.children.find((node) => node instanceof THREE.Line);
      expect(ray?.visible).toBe(false);
      expect(
        (fakeXR.controllers[1] as THREE.Group).children.find((node) => node instanceof THREE.Line)
          ?.visible,
      ).toBe(false);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      expect(actions.sendKey).not.toHaveBeenCalled();
      contactKey(workspace, hand, 'a', 0.004, 40);
      fakeXR.frame?.(60);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      contactKey(workspace, hand, 'a', 0.06, 80);
      contactKey(workspace, hand, 'a', 0.004, 100);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
      for (const joint of Object.values(hand.joints)) joint.position.z += 1;
      fakeXR.frame?.(120);
      expect(ray?.visible).toBe(true);
    });

    it.each(['off', 'on'] as const)(
      'pokes the raised Close button once with Keyborb %s and ignores a hovering fingertip',
      (keyborbMode) => {
        const play = vi.fn();
        const { workspace } = setup(keyborbMode, { feedback: { play, dispose: vi.fn() } });
        workspace.showInput('keyboard');
        const hand = connectHand(0);
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        expect(workspace.state.keyborbEnabled).toBe(keyborbMode === 'on');
        const close = { inputAction: 'close' };
        expect(objectWithData(workspace, close).userData.raisedButton).toBe(true);
        contactControl(workspace, hand, close, 0.06, 20);
        for (let frame = 0; frame < 4; frame++)
          contactControl(workspace, hand, close, 0.025, 40 + frame * 20);
        expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
        expect(play).not.toHaveBeenCalled();
        contactControl(workspace, hand, close, 0.004, 140);
        expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
        expect(play.mock.calls.map(([kind]) => kind)).toEqual(['select']);
      },
    );

    it.each(['off', 'on'] as const)(
      'toggles a raised panel button once per held poke with Keyborb %s',
      (keyborbMode) => {
        const { workspace, actions } = setup(keyborbMode);
        workspace.showInput('keyboard');
        const hand = connectHand(0);
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        const backing = { inputAction: 'keyboardBackground' };
        contactControl(workspace, hand, backing, 0.06, 20);
        for (let frame = 0; frame < 6; frame++)
          contactControl(workspace, hand, backing, 0.004, 40 + frame * 20);
        expect(workspace.state.keyboardBackgroundEnabled).toBe(false);
        contactControl(workspace, hand, backing, 0.06, 200);
        contactControl(workspace, hand, backing, 0.004, 220);
        expect(workspace.state.keyboardBackgroundEnabled).toBe(true);
        expect(actions.sendKey).not.toHaveBeenCalled();
      },
    );

    it('keeps the press-twice confirm on a poked Keyborb strip command', () => {
      vi.useFakeTimers();
      try {
        const { workspace, actions } = setup('on');
        const risky = {
          id: 'risky',
          label: 'risky',
          text: 'echo risky',
          sendNewline: true,
          pinned: true,
          confirm: true,
        };
        workspace.setQuickCommands([risky]);
        workspace.showInput('keyboard');
        const hand = connectHand(0);
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        const strip = { inputAction: 'stripCommand', commandId: 'risky' };
        contactControl(workspace, hand, strip, 0.06, 20);
        contactControl(workspace, hand, strip, 0.004, 40);
        expect(actions.runCommand).not.toHaveBeenCalled();
        expect(objectWithData(workspace, strip).userData.armed).toBe(true);
        vi.advanceTimersByTime(400);
        contactControl(workspace, hand, strip, 0.06, 60);
        contactControl(workspace, hand, strip, 0.004, 80);
        expect(actions.runCommand).toHaveBeenCalledExactlyOnceWith(risky, 'pane-a');
      } finally {
        vi.useRealTimers();
      }
    });

    it('pokes a raised button with a controller-held hand but never pokes a Keyborb orb', () => {
      const { workspace, actions } = setup('on');
      connectController(0);
      workspace.showInput('keyboard');
      const controller = fakeXR.controllers[0] as THREE.Group;
      fakeXR.frame?.(10);
      const visual = objectWithData(workspace, { handedness: 'right' });
      const touch = (data: Record<string, unknown>, depth: number, time: number): void => {
        const button = objectWithData(workspace, data);
        workspace.scene.updateMatrixWorld(true);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          button.getWorldQuaternion(new THREE.Quaternion()),
        );
        const point = button.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, depth);
        controller.position.add(point.sub(visual.userData.indexTip as THREE.Vector3));
        fakeXR.frame?.(time);
      };
      const key = { inputAction: 'key', key: 'a' };
      touch(key, 0.06, 20);
      touch(key, 0.06, 40);
      touch(key, 0.004, 60);
      touch(key, -0.02, 80);
      expect(actions.sendKey).not.toHaveBeenCalled();
      const close = { inputAction: 'close' };
      touch(close, 0.06, 100);
      touch(close, 0.06, 120);
      touch(close, 0.004, 140);
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    });

    it('keeps a poked Backing button sunk across its rebuild, then eases it back', () => {
      const { workspace } = setup('on');
      workspace.showInput('keyboard');
      const hand = connectHand(0);
      (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
      const backing = { inputAction: 'keyboardBackground' };
      const rest = objectWithData(workspace, backing).position.z;
      contactControl(workspace, hand, backing, 0.06, 20);
      contactControl(workspace, hand, backing, 0.004, 40);
      expect(workspace.state.keyboardBackgroundEnabled).toBe(false);
      fakeXR.frame?.(60);
      const rebuilt = objectWithData(workspace, backing);
      expect(rebuilt.position.z).toBeLessThan(rest - 0.01);
      fakeXR.frame?.(200);
      expect(rebuilt.position.z).toBeLessThan(rest - 0.001);
      fakeXR.frame?.(300);
      expect(rebuilt.position.z).toBeCloseTo(rest);
    });

    it('bends the raised walls with the face on a curved keyboard', () => {
      const { workspace } = setup('off');
      workspace.showInput('keyboard');
      workspace.setKeyboardCurvature(60);
      const paste = objectWithData(workspace, { inputAction: 'pasteClipboard' }) as THREE.Mesh;
      const root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const merged = root.getObjectByName('xr-button-walls') as THREE.Mesh;
      paste.geometry.computeBoundingBox();
      const face = paste.geometry.boundingBox as THREE.Box3;
      paste.updateMatrix();
      const toFace = paste.matrix.clone().invert();
      const positions = merged.geometry.getAttribute('position');
      const point = new THREE.Vector3();
      const walls = new THREE.Box3();
      const halfWidth = Number(paste.userData.labelWidth) / 2 + 1e-4;
      const halfHeight = Number(paste.userData.labelHeight) / 2 + 1e-4;
      for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index).applyMatrix4(toFace);
        if (Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight && point.z > -0.05)
          walls.expandByPoint(point);
      }
      expect(face.max.z).toBeGreaterThan(0.005);
      expect(walls.max.z).toBeGreaterThan(face.max.z - 0.003);
      expect(walls.min.z).toBeLessThan(-0.025);
    });

    it('raises keyboard panel controls with depth and keeps ray hover and select', () => {
      const { workspace } = setup('on');
      connectController(0);
      workspace.showInput('keyboard');
      for (const data of [
        { inputAction: 'close' },
        { inputAction: 'keyboardBackground' },
        { inputAction: 'gazeInput' },
        { inputAction: 'keyboardCurvature', delta: 10 },
        { inputAction: 'pasteClipboard' },
      ]) {
        const button = objectWithData(workspace, data) as THREE.Mesh;
        expect(button.userData.raisedButton, JSON.stringify(data)).toBe(true);
        expect(button.position.z).toBeGreaterThan(0.02);
      }
      expect(
        objectWithData(workspace, { inputAction: 'key', key: 'a' }).userData.raisedButton,
      ).toBe(undefined);
      const root = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const walls: THREE.Object3D[] = [];
      root.traverse((object) => {
        if (object.name === 'xr-button-walls') walls.push(object);
      });
      expect(walls).toHaveLength(1);
      expect(walls[0].parent).toBe(root);
      const raycast = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
      expect(raycast.intersectObject(walls[0])).toEqual([]);
      const close = objectWithData(workspace, { inputAction: 'close' }) as THREE.Mesh;
      aimController(fakeXR.controllers[0] as THREE.Group, close);
      workspace.scene.updateMatrixWorld(true);
      fakeXR.frame?.(20);
      expect((close.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(0xffffff);
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
      const paste = objectWithData(workspace, { inputAction: 'pasteClipboard' });
      const rest = paste.position.z;
      hit(workspace, { inputAction: 'pasteClipboard' });
      expect(paste.position.z).toBeLessThan(rest - 0.01);
      fakeXR.frame?.(400);
      expect(paste.position.z).toBeCloseTo(rest);
      const disposeWalls = vi.spyOn((walls[0] as THREE.Mesh).geometry, 'dispose');
      hit(workspace, { inputAction: 'close' });
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
      expect(disposeWalls).toHaveBeenCalledOnce();
    });

    it('keeps poke modifier holds through rebuilds and cancels held contact when retargeting', () => {
      const { workspace, actions } = setup();
      workspace.showInput('keyboard');
      const hand = connectHand();
      contactKey(workspace, hand, 'Shift', 0.06, 20);
      contactKey(workspace, hand, 'Shift', 0.004, 40);
      fakeXR.frame?.(60);
      fakeXR.frame?.(660);
      contactKey(workspace, hand, 'Shift', 0.06, 680);
      contactKey(workspace, hand, 'b', 0.06, 700);
      contactKey(workspace, hand, 'b', 0.004, 720);
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', { shift: true });
      const count = vi.mocked(actions.sendKey).mock.calls.length;
      workspace.selectTerminal('pane-b');
      fakeXR.frame?.(740);
      expect(actions.sendKey).toHaveBeenCalledTimes(count);
      contactKey(workspace, hand, 'c', 0.06, 760);
      contactKey(workspace, hand, 'c', 0.004, 780);
      expect(actions.sendKey).toHaveBeenLastCalledWith('c', undefined);
      expect(workspace.state.inputTargetId).toBe('pane-b');
    });

    it('grips a contacted keyboard with its ray elsewhere and never pokes while gripping', () => {
      const { workspace, actions, left } = setup();
      workspace.showInput('keyboard');
      const hand = connectHand();
      (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
      contactKey(workspace, hand, 'a', 0.015, 20);
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const before = keyboard.position.clone();
      hand.joints['index-finger-tip'].position.z -= 0.011;
      pinch(hand, true);
      fakeXR.frame?.(40);
      const movement = new THREE.Vector3(0.1, 0.03, 0);
      for (const joint of Object.values(hand.joints)) joint.position.add(movement);
      fakeXR.frame?.(60);
      expect(keyboard.position.clone().sub(before).distanceTo(movement)).toBeLessThan(1e-5);
      pinch(hand, false);
      fakeXR.frame?.(80);
      expect(actions.sendKey).not.toHaveBeenCalled();
      expect(left.resizeGrid).not.toHaveBeenCalled();
    });

    it.each(['retarget', 'mode'] as const)(
      'cancels an empty held contact grip on %s change',
      (change) => {
        const { workspace } = setup();
        workspace.showInput('keyboard');
        const hand = connectHand();
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        for (const joint of Object.values(hand.joints)) joint.position.addScalar(5);
        fakeXR.frame?.(20);
        pinch(hand, true);
        fakeXR.frame?.(40);
        if (change === 'retarget') workspace.selectTerminal('pane-b');
        else {
          workspace.showInput('commands');
          workspace.showInput('keyboard');
        }
        const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
        const key = objectWithData(workspace, { inputAction: 'key', key: 'a' });
        const point = key.getWorldPosition(new THREE.Vector3());
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          key.getWorldQuaternion(new THREE.Quaternion()),
        );
        const movement = point.addScaledVector(normal, 0.015).sub(hand.joints.wrist.position);
        for (const joint of Object.values(hand.joints)) joint.position.add(movement);
        fakeXR.frame?.(60);
        const before = keyboard.position.clone();
        for (const joint of Object.values(hand.joints)) joint.position.x += 0.1;
        fakeXR.frame?.(80);
        expect(keyboard.position.distanceTo(before)).toBeLessThan(1e-5);
      },
    );

    it.each(['panel', 'hud', 'widget'] as const)(
      'contact-grips the actual %s owner rather than the focused pane',
      (kind) => {
        const { workspace, actions } = setup();
        workspace.selectTerminal('pane-b');
        if (kind === 'widget') {
          workspace.showInput('widgets');
          hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
          workspace.hideInput();
        }
        const hand = connectHand();
        const object = (
          kind === 'widget'
            ? objectWithData(workspace, { inputAction: 'grabWidget', widgetKind: 'digital-clock' })
            : workspace.scene.getObjectByName(
                kind === 'panel' ? 'terminal-panel-pane-a' : 'xr-workspace-hud',
              )
        ) as THREE.Group;
        const point = object.getWorldPosition(new THREE.Vector3());
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
          object.getWorldQuaternion(new THREE.Quaternion()),
        );
        hand.joints.wrist.position
          .copy(point)
          .add(new THREE.Vector3(0, -0.047, 0))
          .addScaledVector(normal, 0.02);
        hand.joints['thumb-tip'].position
          .copy(hand.joints.wrist.position)
          .add(new THREE.Vector3(-0.06, 0.04, 0));
        hand.joints['middle-finger-tip'].position
          .copy(hand.joints.wrist.position)
          .add(new THREE.Vector3(0, 0.17, 0));
        hand.joints['index-finger-tip'].position
          .copy(hand.joints.wrist.position)
          .add(new THREE.Vector3(0, 0.12, 0));
        (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
        fakeXR.frame?.(20);
        const before = object.position.clone();
        const other = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
        const otherBefore = other.position.clone();
        pinch(hand, true);
        fakeXR.frame?.(40);
        for (const joint of Object.values(hand.joints)) joint.position.x += 0.1;
        fakeXR.frame?.(60);
        expect(object.position.x - before.x).toBeCloseTo(0.1);
        expect(other.position.distanceTo(otherBefore)).toBeLessThan(1e-5);
        expect(actions.sendKey).not.toHaveBeenCalled();
      },
    );

    it('reels a far hand-grabbed window in as the wrist pulls toward the head', () => {
      const { workspace } = setup();
      const hand = connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const panel = objectWithData(workspace, { terminalId: 'pane-a' }) as THREE.Group;
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const wrist = head.clone().add(new THREE.Vector3(0.1, -0.3, -0.45));
      const shift = wrist.clone().sub(hand.joints.wrist.position);
      for (const joint of Object.values(hand.joints)) joint.position.add(shift);
      aimController(controller, panel, 2);
      fakeXR.frame?.(10);
      const before = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      pinch(hand, true);
      fakeXR.frame?.(20);
      const pull = head.clone().sub(wrist).multiplyScalar(0.5);
      for (const joint of Object.values(hand.joints)) joint.position.add(pull);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(40 + frame * 16);
      const after = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      expect(after).toBeLessThan(before * 0.65);
      pinch(hand, false);
      fakeXR.frame?.(800);
    });

    const farHandGrab = (workspace: ReturnType<typeof createWorkspaceScene>) => {
      const hand = connectHand();
      const controller = fakeXR.controllers[0] as THREE.Group;
      const panel = objectWithData(workspace, { terminalId: 'pane-a' }) as THREE.Group;
      const camera = fakeXR.camera as THREE.Object3D;
      const head = camera.getWorldPosition(new THREE.Vector3());
      const wrist = head.clone().add(new THREE.Vector3(0.1, -0.3, -0.45));
      const shift = wrist.clone().sub(hand.joints.wrist.position);
      for (const joint of Object.values(hand.joints)) joint.position.add(shift);
      aimController(controller, panel, 2);
      fakeXR.frame?.(10);
      const before = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      pinch(hand, true);
      fakeXR.frame?.(20);
      return { hand, controller, panel, camera, head, wrist, before };
    };

    it('carries a far hand-grabbed window at its distance while walking', () => {
      const { workspace } = setup();
      const { hand, controller, panel, camera, before } = farHandGrab(workspace);
      const start = camera.position.clone();
      cleanups.push(() => {
        camera.position.copy(start);
        camera.updateMatrixWorld(true);
      });
      const step = new THREE.Vector3(0, 0, -0.6);
      for (const joint of Object.values(hand.joints)) joint.position.add(step);
      controller.position.add(step);
      camera.position.add(step);
      camera.updateMatrixWorld(true);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(40 + frame * 16);
      const head = camera.getWorldPosition(new THREE.Vector3());
      const after = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
      expect(Math.abs(after - before)).toBeLessThan(before * 0.03);
      pinch(hand, false);
      fakeXR.frame?.(800);
    });

    it.each([90, -90])(
      'keeps a far hand-grabbed window distance through a %i degree body turn',
      (degrees) => {
        const { workspace } = setup();
        const { hand, controller, panel, camera, head, before } = farHandGrab(workspace);
        const start = camera.quaternion.clone();
        cleanups.push(() => {
          camera.quaternion.copy(start);
          camera.updateMatrixWorld(true);
        });
        const axis = new THREE.Vector3(0, 1, 0);
        const step = THREE.MathUtils.degToRad(degrees / 9);
        const yaw = new THREE.Quaternion().setFromAxisAngle(axis, step);
        for (let turn = 0; turn < 9; turn++) {
          for (const object of [...Object.values(hand.joints), controller]) {
            object.position.sub(head).applyAxisAngle(axis, step).add(head);
            object.quaternion.premultiply(yaw);
          }
          camera.quaternion.premultiply(yaw);
          camera.updateMatrixWorld(true);
          for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(40 + turn * 64 + frame * 16);
        }
        for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(700 + frame * 16);
        const after = panel.getWorldPosition(new THREE.Vector3()).distanceTo(head);
        expect(Math.abs(after - before)).toBeLessThan(before * 0.03);
        pinch(hand, false);
        fakeXR.frame?.(1300);
      },
    );

    it('keeps a far hand-grabbed window depth through a sideways arm sweep', () => {
      const { workspace } = setup();
      const { hand, panel, head, wrist } = farHandGrab(workspace);
      const offset = panel.getWorldPosition(new THREE.Vector3()).sub(wrist).length();
      // Sweep the wrist 25 degrees across the body around a shoulder beside the head.
      const shoulder = head.clone().add(new THREE.Vector3(0.18, -0.25, 0));
      const arm = wrist.clone().sub(shoulder);
      const swept = shoulder
        .clone()
        .add(arm.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(25)));
      const move = swept.sub(wrist);
      for (const joint of Object.values(hand.joints)) joint.position.add(move);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(40 + frame * 16);
      const now = panel.getWorldPosition(new THREE.Vector3()).sub(hand.joints.wrist.position);
      expect(Math.abs(now.length() - offset)).toBeLessThan(offset * 0.05);
      pinch(hand, false);
      fakeXR.frame?.(800);
    });

    it('keeps a far hand-grabbed window level, in place and facing the head through a wrist roll', () => {
      const { workspace } = setup();
      const { hand, controller, panel } = farHandGrab(workspace);
      for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
      const before = panel.getWorldPosition(new THREE.Vector3());
      const roll = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, -1),
        THREE.MathUtils.degToRad(40),
      );
      hand.joints.wrist.quaternion.multiply(roll);
      controller.quaternion.multiply(roll);
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(600 + frame * 16);
      const rotation = panel.getWorldQuaternion(new THREE.Quaternion());
      expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(0.01);
      expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).y)).toBeLessThan(0.01);
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const toHead = head.sub(before).setY(0).normalize();
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).setY(0).normalize();
      expect(front.dot(toHead)).toBeGreaterThan(0.99);
      pinch(hand, false);
      fakeXR.frame?.(1400);
    });

    const expectLevelFacingHead = (panel: THREE.Object3D): void => {
      const rotation = panel.getWorldQuaternion(new THREE.Quaternion());
      expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).y)).toBeLessThan(0.01);
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const toHead = head.sub(panel.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).setY(0).normalize();
      expect(front.dot(toHead)).toBeGreaterThan(0.99);
    };

    it('keeps a far hand-grabbed window on the ray while the wrist bends', () => {
      const { workspace } = setup();
      const { hand, panel } = farHandGrab(workspace);
      for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
      const before = panel.getWorldPosition(new THREE.Vector3());
      hand.joints.wrist.quaternion.setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(25), 0, 'YXZ'),
      );
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(600 + frame * 16);
      expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(0.01);
      pinch(hand, false);
      fakeXR.frame?.(1400);
    });

    it('swings a far hand-grabbed window with the ray, level and facing the head', () => {
      const { workspace } = setup();
      const { hand, controller, panel } = farHandGrab(workspace);
      for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
      const wrist = hand.joints.wrist.getWorldPosition(new THREE.Vector3());
      const yaw = THREE.MathUtils.degToRad(20);
      const expected = panel
        .getWorldPosition(new THREE.Vector3())
        .sub(wrist)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        .add(wrist);
      controller.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      );
      for (let frame = 0; frame < 40; frame++) fakeXR.frame?.(600 + frame * 16);
      expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(0.02);
      expectLevelFacingHead(panel);
      pinch(hand, false);
      fakeXR.frame?.(1400);
    });

    it.each([90, 100])(
      'keeps the last heading when the grabbing ray points %d degrees up',
      (degrees) => {
        const { workspace } = setup();
        const { hand, controller, panel } = farHandGrab(workspace);
        const yaw = 0.5;
        // Pitching about the held heading's right axis leaves the pane's sideways offset alone.
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const wrist = hand.joints.wrist.getWorldPosition(new THREE.Vector3());
        const sideways = (): number =>
          panel.getWorldPosition(new THREE.Vector3()).sub(wrist).dot(right);
        controller.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
        for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(40 + frame * 16);
        const before = sideways();
        expect(Math.abs(before)).toBeGreaterThan(0.05);
        controller.quaternion.setFromEuler(
          new THREE.Euler(THREE.MathUtils.degToRad(degrees), yaw, 0, 'YXZ'),
        );
        for (let frame = 0; frame < 30; frame++) fakeXR.frame?.(600 + frame * 16);
        expect(sideways()).toBeCloseTo(before, 2);
        pinch(hand, false);
        fakeXR.frame?.(1400);
      },
    );

    it.each([
      ['up', Math.PI / 2],
      ['down', -Math.PI / 2],
    ])('spawns a panel on the facing side while looking straight %s', (_label, pitch) => {
      const { workspace } = setup();
      const camera = fakeXR.camera as THREE.Object3D;
      camera.rotation.set(pitch, 0.5, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      workspace.showInput('settings');
      const panel = workspace.scene.getObjectByName('xr-settings-controls');
      if (!panel) throw new Error('Settings missing');
      const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
      const expected = new THREE.Vector3(0, -0.2, -1.15)
        .applyQuaternion(heading)
        .add(camera.getWorldPosition(new THREE.Vector3()));
      expect(panel.position.distanceTo(expected)).toBeLessThan(1e-6);
    });

    it('spawns the hand keyboard low, near and tilted toward the user on the head heading', () => {
      const { workspace } = setup();
      connectHand();
      const camera = fakeXR.camera as THREE.Object3D;
      camera.rotation.set(-0.6, 0.5, 0, 'YXZ');
      camera.updateMatrixWorld(true);
      workspace.showInput('keyboard');
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
      if (!keyboard) throw new Error('Keyboard missing');
      const eye = camera.getWorldPosition(new THREE.Vector3());
      const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
      const expected = new THREE.Vector3(0, -0.4, -0.45).applyQuaternion(heading).add(eye);
      expect(keyboard.position.distanceTo(expected)).toBeLessThan(1e-6);
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(keyboard.quaternion);
      expect(front.y).toBeCloseTo(0.5, 5);
      const toEye = eye.sub(keyboard.position).setY(0).normalize();
      expect(front.setY(0).normalize().dot(toEye)).toBeGreaterThan(0.999);
    });

    const keyboardRoot = (workspace: ReturnType<typeof createWorkspaceScene>): THREE.Object3D => {
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
      if (!keyboard) throw new Error('Keyboard missing');
      return keyboard;
    };
    const eyeAt = (offset: THREE.Vector3): THREE.Vector3 =>
      (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3()).add(offset);
    const HAND_SPAWN = new THREE.Vector3(0, -0.4, -0.45);
    const PANEL_SPAWN = new THREE.Vector3(0, -0.2, -1.15);
    const tilt = (object: THREE.Object3D): number =>
      new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion).y;

    it.each(['controller', 'hand'] as const)(
      'keeps an open Keyborb in place when switching from %s input',
      (from) => {
        const { workspace } = setup('auto');
        if (from === 'hand') connectHand();
        else connectController(0);
        workspace.showInput('keyboard');
        expect(workspace.state.keyborbEnabled).toBe(from === 'hand');
        const before = keyboardRoot(workspace);
        const position = before.position.clone();
        const quaternion = before.quaternion.clone();
        const scale = before.scale.clone();
        if (from === 'hand') connectController(0);
        else connectHand();
        for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(40 + frame * 16);
        expect(workspace.state.keyborbEnabled).toBe(from === 'controller');
        const after = keyboardRoot(workspace);
        expect(after.position.distanceTo(position)).toBeLessThan(1e-6);
        expect(after.quaternion.angleTo(quaternion)).toBeLessThan(1e-6);
        expect(after.scale.equals(scale)).toBe(true);
        workspace.hideInput();
        workspace.showInput('keyboard');
        const next = from === 'hand' ? PANEL_SPAWN : HAND_SPAWN;
        expect(keyboardRoot(workspace).position.distanceTo(eyeAt(next))).toBeLessThan(1e-6);
      },
    );

    it('spawns the hand keyboard near even after a far panel was open first', () => {
      const { workspace } = setup();
      connectHand();
      workspace.showInput('settings');
      workspace.showInput('keyboard');
      const keyboard = keyboardRoot(workspace);
      expect(keyboard.position.distanceTo(eyeAt(HAND_SPAWN))).toBeLessThan(1e-6);
      expect(tilt(keyboard)).toBeCloseTo(0.5, 5);
    });

    it('spawns a panel far and untilted after the hand keyboard was open', () => {
      const { workspace } = setup();
      connectHand();
      workspace.showInput('keyboard');
      workspace.showInput('settings');
      const panel = workspace.scene.getObjectByName('xr-settings-controls');
      if (!panel) throw new Error('Settings missing');
      expect(panel.position.distanceTo(eyeAt(PANEL_SPAWN))).toBeLessThan(1e-6);
      expect(tilt(panel)).toBeCloseTo(0, 5);
    });

    it('leaves a user-grabbed keyboard in place when the input kind flips', () => {
      const { workspace } = setup();
      connectHand();
      workspace.showInput('keyboard');
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.copy(keyboardRoot(workspace).getWorldPosition(new THREE.Vector3()));
      workspace.scene.updateMatrixWorld(true);
      connectController(0);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(20);
      controller.position.x += 0.3;
      fakeXR.frame?.(40);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      const placed = keyboardRoot(workspace).position.clone();
      expect(placed.distanceTo(eyeAt(HAND_SPAWN))).toBeGreaterThan(0.2);
      connectHand();
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(60 + frame * 16);
      connectController(0);
      for (let frame = 0; frame < 4; frame++) fakeXR.frame?.(200 + frame * 16);
      expect(keyboardRoot(workspace).position.distanceTo(placed)).toBeLessThan(1e-6);
    });

    const xrSession = () => {
      const listeners: Array<() => void> = [];
      const session = {
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        end: async () => {
          for (const listener of listeners.splice(0)) listener();
        },
      };
      vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
      return session;
    };

    it('does not carry a spawned hand keyboard into the next controller session', async () => {
      const { workspace } = setup();
      connectHand();
      let session = xrSession();
      await workspace.enterXR('vr');
      fakeXR.frame?.(30);
      workspace.showInput('keyboard');
      expect(keyboardRoot(workspace).position.distanceTo(eyeAt(HAND_SPAWN))).toBeLessThan(1e-6);
      await session.end();
      fakeXR.frame?.(60);
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'disconnected' } as never);
      session = xrSession();
      await workspace.enterXR('vr');
      connectController(0);
      fakeXR.frame?.(90);
      workspace.showInput('keyboard');
      const keyboard = keyboardRoot(workspace);
      expect(keyboard.position.distanceTo(eyeAt(PANEL_SPAWN))).toBeLessThan(1e-6);
      expect(tilt(keyboard)).toBeCloseTo(0, 5);
      await session.end();
    });

    it('carries a user-grabbed keyboard pose into the next session', async () => {
      const { workspace } = setup();
      let session = xrSession();
      await workspace.enterXR('vr');
      connectController(0);
      fakeXR.frame?.(30);
      workspace.showInput('keyboard');
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.copy(keyboardRoot(workspace).getWorldPosition(new THREE.Vector3()));
      workspace.scene.updateMatrixWorld(true);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(40);
      controller.position.x += 0.3;
      fakeXR.frame?.(60);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      const placed = keyboardRoot(workspace).position.clone();
      expect(placed.distanceTo(eyeAt(PANEL_SPAWN))).toBeGreaterThan(0.2);
      await session.end();
      session = xrSession();
      await workspace.enterXR('vr');
      fakeXR.frame?.(90);
      workspace.showInput('keyboard');
      expect(keyboardRoot(workspace).position.distanceTo(placed)).toBeLessThan(1e-3);
      await session.end();
    });

    it('restores a saved keyboard pose instead of the hand keyboard spawn', async () => {
      localStorage.setItem(
        'mux-xr:ui-poses:v1',
        JSON.stringify({
          version: 1,
          poses: {
            keyboard: { position: [0.3, -0.1, -0.9], quaternion: [0, 0, 0, 1], scale: 0.5 },
          },
        }),
      );
      const session = { addEventListener: () => undefined, end: async () => undefined };
      vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
      const { workspace } = setup();
      connectHand();
      await workspace.enterXR('vr');
      fakeXR.frame?.(30);
      workspace.showInput('keyboard');
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
      if (!keyboard) throw new Error('Keyboard missing');
      const eye = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      expect(keyboard.scale.x).toBeCloseTo(0.5);
      expect(
        keyboard.position.distanceTo(eye.add(new THREE.Vector3(0, -0.4, -0.45))),
      ).toBeGreaterThan(0.1);
    });

    it('moves a contact-grabbed panel edge 1:1 without reeling it', () => {
      const { workspace } = setup();
      const hand = connectHand(0);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const point = panel.getWorldPosition(new THREE.Vector3());
      // The left edge, over half a metre from the panel origin; the right edge meets pane-b.
      const wrist = point.clone().add(new THREE.Vector3(-0.6, -0.047, 0.02));
      const movement = wrist.clone().sub(hand.joints.wrist.position);
      for (const joint of Object.values(hand.joints)) joint.position.add(movement);
      (fakeXR.controllers[0] as THREE.Group).position.set(5, 5, 0);
      fakeXR.frame?.(20);
      pinch(hand, true);
      fakeXR.frame?.(40);
      const before = panel.position.clone();
      const head = (fakeXR.camera as THREE.Object3D).getWorldPosition(new THREE.Vector3());
      const pull = head.sub(hand.joints.wrist.position).setY(0).normalize().multiplyScalar(0.25);
      for (const joint of Object.values(hand.joints)) joint.position.add(pull);
      for (let frame = 0; frame < 20; frame++) fakeXR.frame?.(60 + frame * 16);
      expect(panel.position.clone().sub(before).distanceTo(pull)).toBeLessThan(1e-5);
      pinch(hand, false);
      fakeXR.frame?.(600);
    });

    it('rolls a two-hand grab when both wrists turn about the line between them', () => {
      const { workspace } = setup();
      const right = connectHand(0);
      const left = connectHand(1);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const point = panel.getWorldPosition(new THREE.Vector3());
      for (const [i, hand] of [right, left].entries()) {
        const wrist = point.clone().add(new THREE.Vector3(i ? -0.12 : 0.12, -0.047, 0.02));
        const movement = wrist.sub(hand.joints.wrist.position);
        for (const joint of Object.values(hand.joints)) joint.position.add(movement);
        (fakeXR.controllers[i] as THREE.Group).position.set(5, 5, 0);
      }
      fakeXR.frame?.(20);
      pinch(right, true);
      fakeXR.frame?.(40);
      pinch(left, true);
      fakeXR.frame?.(60);
      const start = panel.quaternion.clone();
      const axis = right.joints.wrist.position.clone().sub(left.joints.wrist.position).normalize();
      const turn = (rightDegrees: number, leftDegrees: number, time: number): void => {
        for (const [hand, degrees] of [
          [right, rightDegrees],
          [left, leftDegrees],
        ] as const) {
          const twist = new THREE.Quaternion().setFromAxisAngle(
            axis,
            THREE.MathUtils.degToRad(degrees),
          );
          const pivot = hand.joints.wrist.position.clone();
          for (const joint of Object.values(hand.joints)) {
            joint.position.sub(pivot).applyQuaternion(twist).add(pivot);
            joint.quaternion.premultiply(twist);
          }
        }
        fakeXR.frame?.(time);
      };
      turn(10, 10, 80);
      expect(panel.quaternion.angleTo(start)).toBeLessThan(1e-6);
      turn(20, -20, 90);
      expect(panel.quaternion.angleTo(start)).toBeLessThan(1e-6);
      turn(0, 10, 95);
      expect(panel.quaternion.angleTo(start)).toBeLessThan(1e-6);
      turn(0, 30, 100);
      expect(THREE.MathUtils.radToDeg(panel.quaternion.angleTo(start))).toBeCloseTo(15, 0);
      const rolled = new THREE.Quaternion()
        .setFromAxisAngle(axis, THREE.MathUtils.degToRad(15))
        .multiply(start);
      expect(panel.quaternion.angleTo(rolled)).toBeLessThan(0.02);
      pinch(right, false);
      pinch(left, false);
      fakeXR.frame?.(400);
    });

    it('contact-grabs with both hands and rebases when one loses tracking', () => {
      const { workspace, actions } = setup();
      const right = connectHand(0);
      const left = connectHand(1);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const point = panel.getWorldPosition(new THREE.Vector3());
      for (const [i, hand] of [right, left].entries()) {
        const wrist = point.clone().add(new THREE.Vector3(i ? -0.12 : 0.12, -0.047, 0.02));
        const movement = wrist.sub(hand.joints.wrist.position);
        for (const joint of Object.values(hand.joints)) joint.position.add(movement);
        (fakeXR.controllers[i] as THREE.Group).position.set(5, 5, 0);
      }
      fakeXR.frame?.(20);
      pinch(right, true);
      fakeXR.frame?.(40);
      pinch(left, true);
      fakeXR.frame?.(60);
      const scale = panel.scale.x;
      for (const joint of Object.values(right.joints)) joint.position.x += 0.1;
      for (const joint of Object.values(left.joints)) joint.position.x -= 0.1;
      fakeXR.frame?.(80);
      expect(panel.scale.x).toBeGreaterThan(scale);
      const position = panel.position.clone();
      left.joints.wrist.visible = false;
      fakeXR.frame?.(100);
      expect(panel.position.distanceTo(position)).toBeLessThan(1e-5);
      for (const joint of Object.values(right.joints)) joint.position.x += 0.1;
      fakeXR.frame?.(120);
      expect(panel.position.x - position.x).toBeCloseTo(0.1);
      expect(actions.sendKey).not.toHaveBeenCalled();
    });

    it.each(['vr', 'ar'] as const)(
      'requests optional hand tracking in %s sessions',
      async (mode) => {
        const { workspace } = setup();
        const requestSession = vi.fn(async () => ({
          addEventListener: vi.fn(),
          end: vi.fn(async () => undefined),
        }));
        vi.stubGlobal('navigator', { xr: { requestSession } });
        await workspace.enterXR(mode);
        expect(requestSession).toHaveBeenLastCalledWith(
          mode === 'ar' ? 'immersive-ar' : 'immersive-vr',
          {
            optionalFeatures:
              mode === 'ar'
                ? ['local-floor', 'dom-overlay', 'hand-tracking']
                : ['local-floor', 'hand-tracking', 'layers'],
          },
        );
      },
    );

    it('uses the target-ray identity once and keeps controllers working with getHand available', () => {
      const { workspace, actions } = setup();
      workspace.showInput('keyboard');
      connectHand();
      hit(workspace, { key: 'a' });
      (fakeXR.hands[0] as Hand).dispatchEvent({ type: 'selectstart' } as never);
      expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      nativeEvent(0, 'selectend');
      connectController(0);
      hit(workspace, { key: 'b' });
      expect(actions.sendKey).toHaveBeenLastCalledWith('b', undefined);
      expect(actions.sendKey).toHaveBeenCalledTimes(2);
    });

    it('opens the radial and keyboard from a hand session', () => {
      const { workspace } = setup();
      connectHand();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      expect(workspace.state.radialOpen).toBe(true);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'keyboard' });
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    });

    it('toggles Focus on the selected pane from the hand-opened radial', () => {
      const { workspace } = setup();
      connectHand();
      workspace.selectTerminal('pane-b');
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'focus' });
      expect(workspace.state.focusModeTerminalId).toBe('pane-b');
      expect(workspace.state.radialOpen).toBe(false);
      fakeXR.frame?.(1500);
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(2500);
      expect(workspace.state.radialOpen).toBe(true);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'focus' });
      expect(workspace.state.focusModeTerminalId).toBeNull();
    });

    it('previews hand Warp presets and saves only on Done', () => {
      const { workspace } = setup();
      connectHand();
      const saved = (): string => localStorage.getItem('mux-xr:terminal-warp:v1') ?? '';
      const openWarp = (time: number): void => {
        workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
        fakeXR.frame?.(time);
        hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
        fakeXR.frame?.(time + 200);
      };
      const before = saved();
      const original = workspace.getTerminalCurvature('pane-a');
      openWarp(1000);
      hit(workspace, { inputAction: 'curvature', degrees: 60 });
      hit(workspace, { inputAction: 'curvatureStep', delta: 5 });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(65);
      expect(saved()).toBe(before);
      hit(workspace, { inputAction: 'warpCancel' });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(original);
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeUndefined();
      expect(saved()).toBe(before);
      openWarp(2000);
      hit(workspace, { inputAction: 'curvature', degrees: 30 });
      workspace.showInput('keyboard');
      expect(workspace.getTerminalCurvature('pane-a')).toBe(original);
      openWarp(3000);
      hit(workspace, { inputAction: 'curvature', degrees: 45 });
      hit(workspace, { inputAction: 'warpDone' });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(45);
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeUndefined();
      expect(saved()).toContain('45');
      const settled = saved();
      openWarp(4000);
      hit(workspace, { inputAction: 'curvature', degrees: 90 });
      workspace.selectTerminal('pane-b');
      expect(workspace.getTerminalCurvature('pane-a')).toBe(45);
      const paneB = workspace.getTerminalCurvature('pane-b');
      hit(workspace, { inputAction: 'curvature', degrees: 60 });
      expect(workspace.getTerminalCurvature('pane-b')).toBe(60);
      expect(saved()).toBe(settled);
      hit(workspace, { inputAction: 'warpCancel' });
      expect(workspace.getTerminalCurvature('pane-b')).toBe(paneB);
      expect(saved()).toBe(settled);
    });

    it('saves nothing when the Warp panel is opened and Done is pressed unchanged', () => {
      const { workspace } = setup();
      connectHand();
      const saved = (): string => localStorage.getItem('mux-xr:terminal-warp:v1') ?? '';
      const before = saved();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
      fakeXR.frame?.(1200);
      hit(workspace, { inputAction: 'warpDone' });
      expect(saved()).toBe(before);
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeUndefined();
    });

    it('keeps the Warp panel edit live across a reset: presets preview, Cancel and Done use the reset values', () => {
      const { workspace } = setup();
      connectHand();
      const saved = (): string => localStorage.getItem('mux-xr:terminal-warp:v1') ?? '';
      workspace.setWindowPreferences({
        ...workspace.state.windowPreferences,
        defaultOpacity: 0.6,
        defaultCurvature: 30,
      });
      workspace.setTerminalOpacity('pane-a', 0.3);
      workspace.setTerminalCurvature('pane-a', 70);
      const open = (time: number): void => {
        workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
        fakeXR.frame?.(time);
        hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
        fakeXR.frame?.(time + 200);
      };
      open(1000);
      hit(workspace, { inputAction: 'curvature', degrees: 90 });
      workspace.resetTerminalAppearance('pane-a');
      expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
      expect(workspace.getTerminalOpacity('pane-a')).toBe(0.6);
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeDefined();
      const afterReset = saved();
      hit(workspace, { inputAction: 'curvature', degrees: 60 });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(60);
      expect(saved()).toBe(afterReset);
      hit(workspace, { inputAction: 'warpCancel' });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
      expect(saved()).toBe(afterReset);
      open(3000);
      hit(workspace, { inputAction: 'curvature', degrees: 45 });
      workspace.resetTerminalAppearance('pane-a');
      hit(workspace, { inputAction: 'curvature', degrees: 60 });
      hit(workspace, { inputAction: 'warpDone' });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(60);
      expect(Object.values(JSON.parse(saved()).values)).toEqual([60]);
    });

    it('saves a deliberately pinned default on Done when a preset was pressed', () => {
      const { workspace } = setup();
      connectHand();
      const saved = (): string => localStorage.getItem('mux-xr:terminal-warp:v1') ?? '';
      const start = workspace.getTerminalCurvature('pane-a');
      const before = saved();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
      fakeXR.frame?.(1200);
      hit(workspace, { inputAction: 'curvature', degrees: start === 60 ? 15 : 60 });
      hit(workspace, { inputAction: 'curvature', degrees: start });
      hit(workspace, { inputAction: 'warpDone' });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(start);
      expect(saved()).not.toBe(before);
      expect(Object.values(JSON.parse(saved()).values)).toEqual([start]);
    });

    it('leaves Focus when the hand Warp panel opens', () => {
      const { workspace } = setup();
      connectHand();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'focus' });
      expect(workspace.state.focusModeTerminalId).toBe('pane-a');
      fakeXR.frame?.(1500);
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(2500);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
      expect(workspace.state.focusModeTerminalId).toBeNull();
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeDefined();
    });

    it('offers hand-selectable Warp presets without entering a stick-only mode', () => {
      const { workspace, left } = setup();
      connectHand();
      workspace.toggleRadialMenu(fakeXR.controllers[0] as THREE.Group);
      fakeXR.frame?.(1000);
      hit(workspace, { inputAction: 'radialAction', radialAction: 'warp' });
      fakeXR.frame?.(1200);
      expect(workspace.state.warpTerminalId).toBeNull();
      expect(workspace.scene.getObjectByName('xr-warp-controls')).toBeDefined();
      hit(workspace, { inputAction: 'curvature', degrees: 30 });
      expect(workspace.getTerminalCurvature('pane-a')).toBe(30);
      expect(left.resizeGrid).not.toHaveBeenCalled();
    });

    it('opens the watch by left palm contact and blocks only the nearby left ray', () => {
      const { workspace, actions } = setup();
      connectHand(0);
      const leftHand = connectHand(1);
      const face = objectWithData(workspace, { inputAction: 'wristMenu' });
      const point = face.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        face.getWorldQuaternion(new THREE.Quaternion()),
      );
      const leftVisual = objectWithData(workspace, { handedness: 'left' });
      const movePalm = (distance: number): void => {
        const delta = point
          .clone()
          .addScaledVector(normal, distance)
          .sub(leftVisual.userData.palmPosition);
        for (const joint of Object.values(leftHand.joints)) joint.position.add(delta);
      };
      movePalm(0.2);
      fakeXR.frame?.(20);
      movePalm(0.06);
      fakeXR.frame?.(40);
      const rays = (fakeXR.controllers as THREE.Group[]).map((controller) =>
        controller.children.find((child) => child instanceof THREE.Line),
      );
      expect(rays.map((ray) => ray?.visible)).toEqual([true, false]);
      expect(workspace.state.radialOpen).toBe(false);
      aimController(
        fakeXR.controllers[1] as THREE.Group,
        objectWithData(workspace, { terminalId: 'pane-b' }),
      );
      nativeEvent(1, 'selectstart');
      expect(workspace.state.selectedTerminalId).toBe('pane-a');
      movePalm(0.01);
      fakeXR.frame?.(60);
      expect(workspace.state.radialOpen).toBe(true);
      fakeXR.frame?.(380);
      expect(workspace.state.radialOpen).toBe(true);
      movePalm(0.2);
      fakeXR.frame?.(400);
      expect(rays.map((ray) => ray?.visible)).toEqual([true, true]);
      movePalm(0.01);
      fakeXR.frame?.(450);
      expect(workspace.state.radialOpen).toBe(false);
      expect(actions.sendKey).not.toHaveBeenCalled();
    });

    it.each(['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip'])(
      'cancels %s tracking loss before a render callback and rearms only after neutral release',
      (joint) => {
        const { workspace, actions } = setup();
        workspace.showInput('keyboard');
        const hand = connectHand();
        hand.joints[joint].visible = false;
        hit(workspace, { key: 'a' });
        expect(actions.sendKey).not.toHaveBeenCalled();
        hand.joints[joint].visible = true;
        hand.joints['index-finger-tip'].position.copy(hand.joints['thumb-tip'].position);
        hit(workspace, { key: 'a' });
        expect(actions.sendKey).not.toHaveBeenCalled();
        hand.joints['index-finger-tip'].position.x += 0.08;
        fakeXR.frame?.(30);
        hit(workspace, { key: 'a' });
        expect(actions.sendKey).toHaveBeenCalledExactlyOnceWith('a', undefined);
      },
    );

    it('moves the grabbed panel from the wrist and suppresses simultaneous index selection', () => {
      const { workspace, actions } = setup();
      const hand = connectHand();
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const title = objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-a' });
      const root = fakeXR.controllers[0] as THREE.Group;
      aimController(root, title);
      workspace.scene.updateMatrixWorld(true);
      pinch(hand, true);
      nativeEvent(0, 'selectstart');
      fakeXR.frame?.(20);
      const before = panel.position.clone();
      hand.joints.wrist.position.x += 0.2;
      fakeXR.frame?.(40);
      // A straight world-X sweep also lengthens the reach a little, so the far grab reels slightly.
      expect(Math.abs(panel.position.x - before.x - 0.2)).toBeLessThan(0.02);
      expect(actions.sendKey).not.toHaveBeenCalled();
      pinch(hand, false);
      fakeXR.frame?.(60);
      const released = panel.position.clone();
      hand.joints.wrist.position.x += 0.1;
      fakeXR.frame?.(80);
      expect(panel.position.distanceTo(released)).toBeLessThan(0.00001);
    });

    it('scales using two wrist poses and rebases when one hand releases or loses tracking', () => {
      const { workspace } = setup();
      const right = connectHand(0);
      const left = connectHand(1);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const title = objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-a' });
      aimController(fakeXR.controllers[0] as THREE.Group, title);
      aimController(fakeXR.controllers[1] as THREE.Group, title);
      workspace.scene.updateMatrixWorld(true);
      pinch(right, true);
      fakeXR.frame?.(20);
      pinch(left, true);
      fakeXR.frame?.(40);
      const scale = panel.scale.x;
      right.joints.wrist.position.x += 0.1;
      left.joints.wrist.position.x -= 0.1;
      fakeXR.frame?.(60);
      expect(panel.scale.x).toBeGreaterThan(scale);
      const position = panel.position.clone();
      left.joints.wrist.visible = false;
      fakeXR.frame?.(80);
      expect(panel.position.distanceTo(position)).toBeLessThan(0.00001);
      right.joints.wrist.position.x += 0.1;
      fakeXR.frame?.(100);
      expect(panel.position.x - position.x).toBeCloseTo(0.1);
    });
  });

  it('draws the elastic arms solid beyond a tight near-eye band', () => {
    const { workspace, container } = fixture();
    const arms: THREE.Mesh[] = [];
    workspace.scene.traverse((object) => {
      if (object.name === 'elastic-hand-arm') arms.push(object as THREE.Mesh);
    });
    expect(arms).toHaveLength(2);
    for (const arm of arms) {
      const material = arm.material as THREE.MeshStandardMaterial;
      expect(material.transparent).toBe(true);
      expect(material.customProgramCacheKey?.()).toBe('arm-near-fade:0.080:0.200');
    }
    workspace.dispose();
    container.remove();
  });
});
