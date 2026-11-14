import {
  BUILT_IN_ENVIRONMENTS,
  createEnvironmentController,
  createPerfGaugeWidget,
  createPictureFrameWidget,
  createRadialMenu,
  createSpatialKeyboard,
  createStandardHand,
  createStickyNoteWidget,
  createTimerWidget,
  stickyNotePages,
} from '@par/xr-workspace';
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@par/xr-workspace/internal/labels', () => import('./helpers/labels'));

describe('private XR workspace package', () => {
  it('mounts, retints, updates, and releases worlds in an app-owned scene', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    const update = vi.fn();
    const dispose = vi.fn();
    const factory = vi.fn((_accent: THREE.Color | null) => ({ root, floorY: 0, update, dispose }));
    const environments = createEnvironmentController(scene, {
      ...BUILT_IN_ENVIRONMENTS,
      gallery: factory,
    });
    environments.select('gallery', { accentColor: '#ff0000' });
    expect(factory).toHaveBeenLastCalledWith(new THREE.Color('#ff0000'));
    expect(scene.children).toEqual([root]);
    environments.update(0.016);
    expect(update).toHaveBeenCalledWith(0.016);
    environments.select('gallery', { accentColor: '#ff0000' });
    expect(factory).toHaveBeenCalledTimes(1);
    environments.select('gallery', { accentColor: '#ff0000', environmentAccentColor: '#00ff00' });
    expect(factory).toHaveBeenLastCalledWith(new THREE.Color('#00ff00'));
    expect(dispose).toHaveBeenCalledTimes(1);
    environments.select('gallery', { enabled: false });
    expect(scene.children).toHaveLength(0);
    environments.dispose();
    expect(environments.select('gallery')).toBeNull();
  });

  it('routes hits to host-defined menu actions only when the menu is open', () => {
    const menu = createRadialMenu({
      accentColor: '#8844ee',
      items: [
        { id: 'timer', label: 'Timer' },
        { id: 'world', label: 'World' },
      ],
    });
    const timer = createTimerWidget();
    const target = menu.root.getObjectByName('radial-menu-timer') as THREE.Group;
    expect(menu.actionAt(target)).toBeNull();
    menu.open();
    menu.update(0.8);
    expect(menu.actionAt(target.children[0])).toBe('timer');
    expect(menu.actionAt(timer.root)).toBeNull();
    const outline = menu.root.getObjectByName('radial-outline') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(outline.material.color.getHexString()).toBe('8844ee');
    menu.dispose();
    timer.dispose();
  });

  it.each(['panel', 'keyborb'] as const)(
    'dispatches semantic keys from the %s keyboard',
    (style) => {
      const onKey = vi.fn();
      const keyboard = createSpatialKeyboard({ style, curvatureDegrees: 45, onKey });
      const scene = new THREE.Scene();
      scene.add(keyboard.root);
      const key = (value: string): THREE.Mesh =>
        keyboard.root.children.find((child) => child.userData.key === value) as THREE.Mesh;
      expect(key('Backspace').position.z).toBeGreaterThan(key(' ').position.z);
      expect(keyboard.press(key('Shift'))).toBe(true);
      expect(key('1').userData.labelText).toBe('!');
      expect(keyboard.press(key('1'))).toBe(true);
      expect(onKey).toHaveBeenLastCalledWith('1', { shift: true });
      expect(key('1').userData.labelText).toBe('1');
      expect(keyboard.press(key('Enter'))).toBe(true);
      expect(onKey).toHaveBeenLastCalledWith('Enter', {});
      expect(keyboard.press(new THREE.Mesh())).toBe(false);
      keyboard.update();
      keyboard.dispose();
      expect(scene.children).toHaveLength(0);
      expect(keyboard.press(keyboard.root)).toBe(false);
    },
  );

  it('applies independent hand and arm colors before the model loads', async () => {
    const loader = {
      loadAsync: vi.fn().mockRejectedValue(new Error('missing model')),
    } as unknown as GLTFLoader;
    const hand = createStandardHand({ handColor: '#ff0000', armColor: '#00ff00', loader });
    const color = (name: string): THREE.Color =>
      (
        hand.root.getObjectByName(name) as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshStandardMaterial
        >
      ).material.color;
    expect(color('cartoon-hand-skin').r).toBeGreaterThan(0);
    expect(color('cartoon-hand-skin').g).toBe(0);
    expect(color('elastic-hand-arm').r).toBe(0);
    expect(color('elastic-hand-arm').g).toBeGreaterThan(0);
    expect(await hand.assetReady).toBe(false);
    hand.dispose();
  });
  it('lets the host read and close notes independently of storage', () => {
    const onRead = vi.fn();
    const onClose = vi.fn();
    const text = 'a'.repeat(200);
    const note = createStickyNoteWidget(null, { id: 'note-1', text, onRead, onClose });
    const control = (name: string): THREE.Object3D =>
      note.root.getObjectByName(`sticky-note-${name}`) as THREE.Object3D;
    note.activate?.(control('read'));
    expect(onRead).toHaveBeenCalledWith(text);
    expect(stickyNotePages(text).join('').replaceAll('\n', '')).toBe(text);
    note.activate?.(control('confirm'));
    expect(onClose).not.toHaveBeenCalled();
    note.activate?.(control('close'));
    note.activate?.(control('confirm'));
    expect(onClose).toHaveBeenCalledExactlyOnceWith('note-1');
    note.dispose();
  });

  it('uses host picker actions and leaves caller-owned picture canvases intact', () => {
    const source = document.createElement('canvas');
    source.width = 64;
    source.height = 32;
    const depth = document.createElement('canvas');
    depth.width = 64;
    depth.height = 32;
    const onChoose = vi.fn();
    const onClose = vi.fn();
    const frame = createPictureFrameWidget(null, {
      id: 'frame-1',
      image: { source, width: 64, height: 32 },
      depth: { source: depth, width: 64, height: 32 },
      onClose,
      picker: { actions: [{ id: 'upload', label: 'Upload', activate: onChoose }] },
    });
    const control = (name: string): THREE.Object3D =>
      frame.root.getObjectByName(`picture-${name}`) as THREE.Object3D;
    frame.activate?.(control('upload-choice'));
    expect(onChoose).not.toHaveBeenCalled();
    frame.activate?.(control('change'));
    frame.activate?.(control('upload-choice'));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('frame-1');
    frame.activate?.(control('close'));
    expect(onClose).toHaveBeenCalledExactlyOnceWith('frame-1');
    frame.dispose();
    expect(source.width).toBe(64);
    expect(depth.width).toBe(64);
  });

  it('reports frame samples without a pane count and still accepts one when supplied', () => {
    const gauge = createPerfGaugeWidget();
    const panes = gauge.root.getObjectByName('perf-gauge-panes') as THREE.Object3D;
    gauge.setPerfSample({ fps: 72, worstFrameMs: 18, targetHz: 72 });
    expect(panes.visible).toBe(false);
    expect(gauge.root.getObjectByName('perf-gauge-fps')?.userData.labelText).toBe('72 / 72 fps');
    gauge.setPerfSample({ fps: 72, worstFrameMs: 18, targetHz: 72, shownPanes: 0 });
    expect(panes.visible).toBe(true);
    expect(panes.userData.labelText).toBe('0 panes shown');
    gauge.setPerfSample({ fps: 72, worstFrameMs: 18, targetHz: 72 });
    expect(panes.visible).toBe(false);
    gauge.dispose();
  });
});
