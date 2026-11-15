import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { dimHandColor, HAND_COLOR_PRESETS, ON_TOP_LAYER } from '@par/xr-workspace';
import * as THREE from 'three';
import { BACKGROUND_MODES } from '../../src/contracts';
import { BACKGROUND_LABELS } from '../../src/xr/background-picker';
import type { createWorkspaceScene } from '../../src/xr/scene';
import {
  aimController,
  aimControllerAtScreen,
  connectController,
  fakeXR,
  fixture,
  hit,
  objectWithData,
  resetXRControllers,
} from '../helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

  it('marks the selected pane by lighting its frame and whitening its accent', () => {
    const { workspace, container } = fixture();
    const look = (id: string): { glow: number; accent: number } => {
      const panel = workspace.scene.getObjectByName(`terminal-panel-${id}`) as THREE.Group;
      const frame = panel.getObjectByName('terminal-frame') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;
      const accent = panel.getObjectByName('terminal-frame-accent') as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      return { glow: frame.material.emissiveIntensity, accent: accent.material.color.getHex() };
    };
    expect(workspace.scene.getObjectByName('active-pane-highlight')).toBeUndefined();
    expect(look('pane-a').glow).toBeGreaterThan(0.3);
    expect(look('pane-a').accent).toBe(0xffffff);
    expect(look('pane-b')).toEqual({ glow: 0, accent: 0x68d6ff });
    workspace.selectTerminal('pane-b');
    expect(look('pane-a')).toEqual({ glow: 0, accent: 0x68d6ff });
    expect(look('pane-b').glow).toBeGreaterThan(0.3);
    expect(look('pane-b').accent).toBe(0xffffff);
    workspace.dispose();
    container.remove();
  });

  it('fades an unselected frame accent with the glass and keeps it out of ray hits', () => {
    const { workspace, container } = fixture();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
    const accent = panel.getObjectByName('terminal-frame-accent') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    workspace.setTerminalOpacity('pane-b', 0.4);
    expect(accent.material.opacity).toBeCloseTo(0.4);
    expect(accent.material.depthWrite).toBe(false);
    workspace.selectTerminal('pane-b');
    expect(accent.material.opacity).toBe(1);
    workspace.selectTerminal('pane-a');
    expect(accent.material.opacity).toBeCloseTo(0.4);
    workspace.setTerminalOpacity('pane-b', 1);
    expect(accent.material.opacity).toBe(1);
    expect(accent.material.depthWrite).toBe(true);
    const hits: THREE.Intersection[] = [];
    accent.raycast(
      new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)),
      hits,
    );
    expect(hits).toHaveLength(0);
    workspace.dispose();
    container.remove();
  });

  it('draws the frame accent in one pass instead of three.js back-then-front transparent passes', () => {
    const { workspace, container } = fixture();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
    const material = (panel.getObjectByName('terminal-frame-accent') as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
    const twoPass =
      material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;
    expect(twoPass).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('scrolls only the pointed pane while ungripped without changing selection', () => {
    const { workspace, actions, container } = fixture();
    actions.scrollTerminal = vi.fn(() => true);
    workspace.selectTerminal('pane-a');
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface');
    if (!screen) throw new Error('screen missing');
    const pad = connectController(0, [0, 0, 0, 1]);
    aimController(fakeXR.controllers[0] as THREE.Group, screen);
    fakeXR.frame?.(0);
    expect(actions.scrollTerminal).toHaveBeenCalledWith('pane-b', 3, expect.any(Object));
    expect(workspace.state.selectedTerminalId).toBe('pane-a');
    (pad.buttons[1] as { pressed: boolean }).pressed = true;
    fakeXR.frame?.(500);
    expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
    workspace.dispose();
    container.remove();
  });

  it('persists clock presence and transforms and removes saved clocks on close', () => {
    const first = fixture();
    first.workspace.showInput('widgets');
    hit(first.workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    const root = first.workspace.scene.children.find(
      (o) => o.userData.widgetKind === 'digital-clock',
    );
    if (!root) throw new Error('clock missing');
    hit(
      first.workspace,
      { inputAction: 'grabWidget', widgetKind: 'digital-clock' },
      'squeezestart',
    );
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(0);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    const expected = root.position.clone();
    first.workspace.showInput('settings');
    first.workspace.setKeyboardCurvature(40);
    first.workspace.arrangeTerminals('grid');
    first.workspace.camera.position.x += 0.3;
    first.workspace.camera.updateMatrixWorld(true);
    for (let frame = 1; frame < 40; frame++) fakeXR.frame?.(frame * 16);
    expect(root.position.distanceTo(expected)).toBeLessThan(1e-6);
    first.workspace.dispose();
    first.container.remove();
    const second = fixture();
    fakeXR.frame?.(16);
    const restored = second.workspace.scene.children.find(
      (o) => o.userData.widgetKind === 'digital-clock',
    );
    expect(restored?.position.distanceTo(expected)).toBeLessThan(1e-6);
    hit(second.workspace, { inputAction: 'closeWidget', widgetKind: 'digital-clock' });
    expect(JSON.parse(localStorage.getItem('mux-xr:widget-poses:v2') ?? '{}').poses).toEqual({});
    second.workspace.dispose();
    second.container.remove();
  });

  it('curves only the selected pane and persists curvature without resizing its grid', () => {
    const { workspace, left, right, container } = fixture();
    workspace.setTerminalCurvature('pane-b', 60);
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface') as THREE.Mesh;
    expect(screen.geometry.boundingSphere?.radius).toBeGreaterThan(0);
    expect(workspace.getTerminalCurvature('pane-b')).toBe(60);
    expect(workspace.getTerminalCurvature('pane-a')).toBe(0);
    expect(left.resizeGrid).not.toHaveBeenCalled();
    expect(right.resizeGrid).not.toHaveBeenCalled();
    workspace.setNotice('Example message');
    hit(workspace, { inputAction: 'dismissNotice' });
    expect(workspace.state.notice).toBeNull();
    workspace.dispose();
    container.remove();
  });

  it('routes stream controls separately from closing the terminal view', () => {
    const { workspace, actions } = fixture();
    hit(workspace, { inputAction: 'toggleConnection', terminalId: 'pane-a' });
    expect(actions.togglePaneConnection).toHaveBeenCalledWith('pane-a');
    expect(actions.closePane).not.toHaveBeenCalled();
    hit(workspace, { inputAction: 'closePane', terminalId: 'pane-a' });
    expect(actions.closePane).toHaveBeenCalledWith('pane-a');
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(actions.sendText).not.toHaveBeenCalled();
    workspace.dispose();
  });

  it('routes controller screen hits to clamped terminal mouse cells and captures movement', () => {
    const { workspace, actions, container } = fixture();
    const screen = workspace.scene.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    const geometry = (screen as THREE.Mesh).geometry as THREE.PlaneGeometry;
    const width = geometry.parameters.width;
    const height = geometry.parameters.height;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(width * 0.001, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 40, row: 12, button: 0, eventType: 'press' }),
    );

    aimControllerAtScreen(controller, screen, new THREE.Vector3(width * 0.25, height * 0.25, 0));
    fakeXR.frame?.(16);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 60, row: 6, button: 0, eventType: 'move' }),
    );

    aimControllerAtScreen(
      controller,
      screen,
      new THREE.Vector3(width * 0.4999, -height * 0.4999, 0),
    );
    fakeXR.frame?.(32);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 79, row: 23, eventType: 'move' }),
    );
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 79, row: 23, eventType: 'release' }),
    );
    workspace.dispose();
    container.remove();
  });

  it('suppresses controller mouse input while a grip is held or its raw grip button is pressed', () => {
    const { workspace, actions, container } = fixture();
    const screen = workspace.scene.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    const gamepad = connectController(0);
    (gamepad.buttons[1] as { pressed: boolean }).pressed = true;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).not.toHaveBeenCalled();
    (gamepad.buttons[1] as { pressed: boolean }).pressed = false;
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).toHaveBeenCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'press' }),
    );
    const callsBeforeGrip = (actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length;
    controller.dispatchEvent({ type: 'squeezestart' } as never);
    expect(actions.sendMouse).toHaveBeenCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'release' }),
    );
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect((actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBeforeGrip + 1,
    );
    controller.dispatchEvent({ type: 'squeezeend' } as never);
    workspace.dispose();
    container.remove();
  });

  it('keeps mouse capture on the original pane while the ray crosses another pane or empty space', () => {
    const { workspace, actions, container } = fixture();
    const screenA = workspace.scene
      .getObjectByName('terminal-panel-pane-a')
      ?.getObjectByName('terminal-surface');
    const screenB = workspace.scene
      .getObjectByName('terminal-panel-pane-b')
      ?.getObjectByName('terminal-surface');
    if (!screenA || !screenB) throw new Error('Terminal surfaces missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    aimControllerAtScreen(controller, screenA, new THREE.Vector3(0.001, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 40, row: 12, eventType: 'press' }),
    );
    const callsAfterPress = (actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length;

    aimControllerAtScreen(controller, screenB, new THREE.Vector3(0.2, 0, 0));
    fakeXR.frame?.(16);
    expect((actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterPress);

    const orientation = screenA.getWorldQuaternion(new THREE.Quaternion());
    controller.position.copy(screenA.localToWorld(new THREE.Vector3(0, 0, 0.3)));
    controller.quaternion.copy(
      new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
        .multiply(orientation),
    );
    fakeXR.frame?.(32);
    expect((actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterPress);

    aimControllerAtScreen(controller, screenA, new THREE.Vector3(0.2, 0, 0));
    fakeXR.frame?.(48);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 51, row: 12, eventType: 'move' }),
    );
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ col: 51, row: 12, eventType: 'release' }),
    );
    workspace.dispose();
    container.remove();
  });

  it('keeps a far controller mouse press a click until the hit passes the drag dead zone', () => {
    const { workspace, actions, container, left } = fixture();
    Object.defineProperty(left, 'mouseTracking', { value: 'drag' });
    const screen = workspace.scene
      .getObjectByName('terminal-panel-pane-a')
      ?.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    const controller = fakeXR.controllers[0] as THREE.Group;
    connectController(0);
    const cell = 1.42 / 80;
    const sent = () => (actions.sendMouse as ReturnType<typeof vi.fn>).mock.calls;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001, 0, 0), 3);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    expect(sent()).toHaveLength(1);
    // Three cells at 3 m is under 1.5 degrees of ray angle.
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001 + cell * 3, 0, 0), 3);
    fakeXR.frame?.(20);
    expect(sent()).toHaveLength(1);
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001 + cell * 10, 0, 0), 3);
    fakeXR.frame?.(40);
    expect(sent().at(-1)?.[1]).toEqual(expect.objectContaining({ col: 50, eventType: 'move' }));
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(sent().at(-1)?.[1]).toEqual(expect.objectContaining({ col: 50, eventType: 'release' }));
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001, 0, 0), 3);
    controller.dispatchEvent({ type: 'selectstart' } as never);
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001 + cell * 3, 0, 0), 3);
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(
      sent()
        .slice(-2)
        .map((call) => [call[1].col, call[1].eventType]),
    ).toEqual([
      [40, 'press'],
      [40, 'release'],
    ]);
    workspace.dispose();
    container.remove();
  });

  it('does not capture a controller mouse press when the backend rejects it', () => {
    const { workspace, actions, container } = fixture();
    const screen = workspace.scene.getObjectByName('terminal-surface');
    if (!screen) throw new Error('Terminal surface missing');
    (actions.sendMouse as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const controller = fakeXR.controllers[0] as THREE.Group;
    aimControllerAtScreen(controller, screen, new THREE.Vector3(0, 0, 0));
    controller.dispatchEvent({ type: 'selectstart' } as never);
    controller.dispatchEvent({ type: 'selectend' } as never);
    expect(actions.sendMouse).toHaveBeenCalledTimes(1);
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'press' }),
    );
    workspace.dispose();
    container.remove();
  });

  it('releases captured controller mouse input when the terminal closes, disconnects, or XR ends', async () => {
    const pressCenter = (workspace: ReturnType<typeof createWorkspaceScene>): void => {
      const screen = workspace.scene.getObjectByName('terminal-surface');
      if (!screen) throw new Error('Terminal surface missing');
      const controller = fakeXR.controllers[0] as THREE.Group;
      aimControllerAtScreen(controller, screen, new THREE.Vector3(0.001, 0, 0));
      controller.dispatchEvent({ type: 'selectstart' } as never);
    };

    {
      const { workspace, actions, container } = fixture();
      pressCenter(workspace);
      workspace.removeTerminal('pane-a');
      expect(actions.sendMouse).toHaveBeenLastCalledWith(
        'pane-a',
        expect.objectContaining({ eventType: 'release' }),
      );
      workspace.dispose();
      container.remove();
    }

    {
      const { workspace, actions, container } = fixture();
      pressCenter(workspace);
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'disconnected' } as never);
      expect(actions.sendMouse).toHaveBeenLastCalledWith(
        'pane-a',
        expect.objectContaining({ eventType: 'release' }),
      );
      workspace.dispose();
      container.remove();
    }

    const endListeners: Array<() => void> = [];
    const session = {
      addEventListener: (_type: string, listener: () => void) => endListeners.push(listener),
      end: vi.fn(async () =>
        endListeners.forEach((listener) => {
          listener();
        }),
      ),
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    fakeXR.presenting = true;
    const { workspace, actions, container } = fixture();
    await workspace.enterXR('vr');
    pressCenter(workspace);
    await workspace.exitXR();
    expect(actions.sendMouse).toHaveBeenLastCalledWith(
      'pane-a',
      expect.objectContaining({ eventType: 'release' }),
    );
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('draws open menus, hands and rays in a second pass over cleared depth', () => {
    const { workspace, container } = fixture();
    const masks: number[] = [];
    const render = vi.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation(function (
      this: unknown,
      scene: THREE.Object3D,
      camera: THREE.Camera,
    ) {
      masks.push(camera.layers.mask);
      scene.updateMatrixWorld(true);
    });
    const clearDepth = vi.spyOn(THREE.WebGLRenderer.prototype, 'clearDepth');
    const onTop = 1 << ON_TOP_LAYER;
    fakeXR.frame?.(16);
    expect(masks).toHaveLength(1);
    expect(masks[0] & onTop).toBe(onTop);
    workspace.showInput('settings');
    masks.length = 0;
    fakeXR.frame?.(32);
    expect(masks).toHaveLength(2);
    expect(masks[0] & onTop).toBe(0);
    expect(masks[1]).toBe(onTop);
    expect(clearDepth).toHaveBeenCalledTimes(1);
    const menu = workspace.scene.getObjectByName('xr-settings-controls');
    if (!menu) throw new Error('Settings missing');
    menu.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && object.layers.mask !== 1 << 31)
        expect(object.layers.mask).toBe(onTop);
    });
    workspace.scene.traverse((object) => {
      if (object.name === 'elastic-hand-arm') expect(object.layers.mask).toBe(onTop);
    });
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!hud) throw new Error('HUD missing');
    hud.traverse((object) => {
      if (object.layers.mask !== 1 << 31) expect(object.layers.mask).toBe(onTop);
    });
    // An antialiased XR target that resolves after every render keeps the single pass.
    const proto = THREE.WebGLRenderer.prototype as unknown as Record<string, unknown>;
    proto.getRenderTarget = () => ({ samples: 4 });
    proto.extensions = { has: () => false };
    fakeXR.presenting = true;
    masks.length = 0;
    fakeXR.frame?.(48);
    expect(masks).toHaveLength(1);
    fakeXR.presenting = false;
    delete proto.getRenderTarget;
    delete proto.extensions;
    workspace.hideInput();
    render.mockRestore();
    clearDepth.mockRestore();
    workspace.dispose();
    container.remove();
  });

  it('picks a hand color from World swatches and restores the default', () => {
    const { workspace, container } = fixture();
    workspace.showInput('settings');
    hit(workspace, { inputAction: 'openInput', mode: 'world' });
    const swatches = (): THREE.Object3D[] => {
      const found: THREE.Object3D[] = [];
      workspace.scene.traverse((object) => {
        if (object.userData.inputAction === 'handColor') found.push(object);
      });
      return found;
    };
    expect(swatches().map((swatch) => swatch.userData.handColor)).toEqual(
      HAND_COLOR_PRESETS.map((preset) => preset.color),
    );
    hit(workspace, { inputAction: 'handColor', handColor: '#3b82f6' });
    expect(workspace.state.handColor).toBe('#3b82f6');
    const selected = swatches().filter((swatch) => swatch.userData.labelBorder === '#ffffff');
    expect(selected.map((swatch) => swatch.userData.handColor)).toEqual(['#3b82f6']);
    const arms: THREE.MeshStandardMaterial[] = [];
    workspace.scene.traverse((object) => {
      if (object.name === 'elastic-hand-arm')
        arms.push((object as THREE.Mesh).material as THREE.MeshStandardMaterial);
    });
    expect(arms.length).toBeGreaterThan(0);
    const dim = (hex: number): number => dimHandColor(new THREE.Color(), hex).getHex();
    for (const material of arms) expect(material.color.getHex()).toBe(dim(0x3b82f6));
    hit(workspace, { inputAction: 'armColor', armColor: '#22a55a' });
    expect(workspace.state.armColor).toBe('#22a55a');
    for (const material of arms) expect(material.color.getHex()).toBe(dim(0x22a55a));
    hit(workspace, { inputAction: 'handColor', handColor: '' });
    expect(workspace.state.handColor).toBe('');
    for (const material of arms) expect(material.color.getHex()).toBe(dim(0x22a55a));
    hit(workspace, { inputAction: 'armColor', armColor: '' });
    expect(workspace.state.armColor).toBe('');
    for (const material of arms) expect(material.color.getHex()).not.toBe(dim(0x22a55a));
    workspace.dispose();
    container.remove();
  });

  it('recolors live XR accents from the Accent colors page and restores the default', () => {
    const { workspace, container } = fixture();
    workspace.selectTerminal('pane-a');
    const panelPart = (id: string, name: string) =>
      (
        (workspace.scene.getObjectByName(`terminal-panel-${id}`) as THREE.Group).getObjectByName(
          name,
        ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
      ).material;
    const frameAccent = (id: string) => panelPart(id, 'terminal-frame-accent');
    const strip = panelPart('pane-b', 'terminal-scroll-strip');
    expect(frameAccent('pane-b').color.getHex()).toBe(0x68d6ff);
    expect(frameAccent('pane-a').color.getHex()).toBe(0xffffff);
    workspace.showInput('settings');
    hit(workspace, { inputAction: 'openInput', mode: 'world' });
    hit(workspace, { inputAction: 'openInput', mode: 'accent' });
    const swatches = (action: string): THREE.Object3D[] => {
      const found: THREE.Object3D[] = [];
      workspace.scene.traverse((object) => {
        if (object.userData.inputAction === action) found.push(object);
      });
      return found;
    };
    expect(swatches('accentColor')).toHaveLength(HAND_COLOR_PRESETS.length);
    expect(swatches('environmentAccentColor')).toHaveLength(HAND_COLOR_PRESETS.length);
    hit(workspace, { inputAction: 'accentColor', accentColor: '#ff672f' });
    expect(workspace.state.accentColor).toBe('#ff672f');
    expect(frameAccent('pane-b').color.getHex()).toBe(0xff672f);
    expect(strip.color.getHex()).toBe(0xff672f);
    // The selected pane keeps its white frame until selection moves, then shows the new accent.
    expect(frameAccent('pane-a').color.getHex()).toBe(0xffffff);
    workspace.selectTerminal('pane-b');
    expect(frameAccent('pane-a').color.getHex()).toBe(0xff672f);
    const selected = swatches('accentColor').filter(
      (swatch) => swatch.userData.labelBorder === '#ffffff',
    );
    expect(selected.map((swatch) => swatch.userData.accentColor)).toEqual(['#ff672f']);
    hit(workspace, { inputAction: 'environmentAccentColor', environmentAccentColor: '#22a55a' });
    expect(workspace.state.environmentAccentColor).toBe('#22a55a');
    hit(workspace, { inputAction: 'accentColor', accentColor: '' });
    expect(workspace.state.accentColor).toBe('');
    expect(frameAccent('pane-a').color.getHex()).toBe(0x68d6ff);
    expect(strip.color.getHex()).toBe(0x68d6ff);
    workspace.dispose();
    container.remove();
  });

  it('sets the weather ZIP from a World keypad and clears it again', () => {
    const { workspace, container } = fixture();
    workspace.showInput('settings');
    hit(workspace, { inputAction: 'openInput', mode: 'world' });
    const named = (name: string) => workspace.scene.getObjectByName(name);
    expect(named('xr-weather-zip-button')?.userData.labelText).toBe('Weather ZIP: not set');
    hit(workspace, { inputAction: 'openInput', mode: 'weather-zip' });
    for (const zipDigit of ['9', '5', '8']) hit(workspace, { inputAction: 'zipDigit', zipDigit });
    expect(named('xr-weather-zip-field')?.userData.labelText).toBe('ZIP: 958|');
    hit(workspace, { inputAction: 'zipSave' });
    expect(workspace.state.weatherZip).toBe('');
    expect(named('xr-weather-zip-message')?.userData.labelText).toBe('Enter all five digits');
    for (const zipDigit of ['1', '4', '7']) hit(workspace, { inputAction: 'zipDigit', zipDigit });
    expect(named('xr-weather-zip-field')?.userData.labelText).toBe('ZIP: 95814');
    hit(workspace, { inputAction: 'zipDelete' });
    hit(workspace, { inputAction: 'zipDigit', zipDigit: '4' });
    hit(workspace, { inputAction: 'zipSave' });
    expect(workspace.state.weatherZip).toBe('95814');
    expect(named('xr-world-controls')).toBeTruthy();
    expect(named('xr-weather-zip-button')?.userData.labelText).toBe('Weather ZIP: 95814');
    hit(workspace, { inputAction: 'openInput', mode: 'weather-zip' });
    expect(named('xr-weather-zip-field')?.userData.labelText).toBe('ZIP: 95814');
    hit(workspace, { inputAction: 'zipUnset' });
    expect(workspace.state.weatherZip).toBe('');
    workspace.setWeatherZip('abc');
    expect(workspace.state.weatherZip).toBe('');
    workspace.setWeatherZip('10001');
    expect(workspace.state.weatherZip).toBe('10001');
    workspace.dispose();
    container.remove();
  });

  it('opens the Backgrounds picker from World and picks a background in place', () => {
    const { workspace, container } = fixture();
    workspace.showInput('settings');
    hit(workspace, { inputAction: 'openInput', mode: 'world' });
    expect(workspace.scene.getObjectByName('xr-world-controls')).toBeTruthy();
    hit(workspace, { inputAction: 'backgroundSelect' });
    const picker = (): THREE.Object3D => {
      const root = workspace.scene.getObjectByName('xr-backgrounds-controls');
      if (!root) throw new Error('Backgrounds picker missing');
      return root;
    };
    const captions = (): string[] =>
      picker()
        .children.filter((child) => child.userData.inputAction === 'background')
        .map((child) => child.userData.labelText as string);
    expect(captions()).toEqual(BACKGROUND_MODES.slice(0, 6).map((mode) => BACKGROUND_LABELS[mode]));
    const tiles = picker().children.filter(
      (child) => child.userData.inputAction === 'backgroundTile',
    );
    expect(tiles.map((tile) => tile.userData.background)).toEqual(BACKGROUND_MODES.slice(0, 6));
    hit(workspace, { inputAction: 'backgroundTile', background: 'gradient' });
    expect(workspace.state.background).toBe('gradient');
    const selected = picker().getObjectByName('xr-background-selected');
    const gradientTile = picker().children.find(
      (child) =>
        child.userData.inputAction === 'backgroundTile' && child.userData.background === 'gradient',
    );
    expect(selected?.position.x).toBeCloseTo(gradientTile?.position.x ?? Number.NaN);
    expect(selected?.position.y).toBeCloseTo(gradientTile?.position.y ?? Number.NaN);
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    expect(hud?.children.some((child) => child.userData.inputAction === 'backgroundSelect')).toBe(
      false,
    );
    hit(workspace, { inputAction: 'openInput', mode: 'world' });
    const trigger = workspace.scene.getObjectByName('background-select-trigger');
    expect(trigger?.userData.labelText).toBe('Gradient');
    workspace.dispose();
    container.remove();
  });

  it('scrolls the Backgrounds picker by row and keeps its controls apart', () => {
    const { workspace, container } = fixture();
    workspace.setBackground(BACKGROUND_MODES[BACKGROUND_MODES.length - 1]);
    workspace.showInput('world');
    hit(workspace, { inputAction: 'backgroundSelect' });
    const picker = (): THREE.Object3D => {
      const root = workspace.scene.getObjectByName('xr-backgrounds-controls');
      if (!root) throw new Error('Backgrounds picker missing');
      return root;
    };
    const shown = (): string[] =>
      picker()
        .children.filter((child) => child.userData.inputAction === 'backgroundTile')
        .map((child) => child.userData.background as string);
    // Opening on the last background scrolls it into view.
    expect(shown()).toContain(BACKGROUND_MODES[BACKGROUND_MODES.length - 1]);
    const down = (): THREE.Object3D | undefined =>
      picker().getObjectByName('xr-background-scroll-down');
    const up = (): THREE.Object3D | undefined =>
      picker().getObjectByName('xr-background-scroll-up');
    expect(down()?.userData.inputAction).toBe('noop');
    expect(up()?.userData.inputAction).toBe('backgroundScroll');
    while (up()?.userData.inputAction === 'backgroundScroll')
      hit(workspace, { inputAction: 'backgroundScroll', delta: -1 });
    expect(shown()).toEqual(BACKGROUND_MODES.slice(0, 6));
    expect(down()?.userData.inputAction).toBe('backgroundScroll');
    hit(workspace, { inputAction: 'backgroundScroll', delta: 1 });
    expect(shown()).toEqual(BACKGROUND_MODES.slice(3, 9));
    const root = picker();
    root.updateMatrixWorld(true);
    const boxes: { label: string; box: THREE.Box3 }[] = [];
    for (const object of root.children) {
      const plane =
        object.name === 'xr-background-thumbnail'
          ? ((object as THREE.Mesh).geometry as THREE.PlaneGeometry).parameters
          : undefined;
      const width = (object.userData.labelWidth as number | undefined) ?? plane?.width;
      const height = (object.userData.labelHeight as number | undefined) ?? plane?.height;
      if (!width || !height) continue;
      const center = object.position;
      boxes.push({
        label: String(object.userData.labelText ?? object.userData.background ?? object.name),
        box: new THREE.Box3(
          new THREE.Vector3(center.x - width / 2, center.y - height / 2, -1),
          new THREE.Vector3(center.x + width / 2, center.y + height / 2, 1),
        ),
      });
    }
    expect(boxes.length).toBeGreaterThanOrEqual(10);
    boxes.forEach(({ label, box }, index) => {
      for (const later of boxes.slice(index + 1))
        expect(box.intersectsBox(later.box), `${label} overlaps ${later.label}`).toBe(false);
    });
    workspace.dispose();
    container.remove();
  });

  it('packs the Display and World panels into compact, non-overlapping rows', () => {
    const { workspace, container } = fixture();
    for (const [mode, maxHeight] of [
      ['display', 1.55],
      ['world', 1.2],
      ['weather-zip', 1.3],
    ] as const) {
      workspace.showInput(mode);
      const root = workspace.scene.getObjectByName(`xr-${mode}-controls`);
      if (!root) throw new Error(`${mode} missing`);
      root.updateMatrixWorld(true);
      const boxes: { label: string; box: THREE.Box3 }[] = [];
      root.traverse((object) => {
        const { labelWidth, labelHeight } = object.userData;
        if (!labelWidth || !labelHeight || object.parent?.name === 'background-options') return;
        const center = root.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
        boxes.push({
          label: object.userData.labelText,
          box: new THREE.Box3(
            new THREE.Vector3(center.x - labelWidth / 2, center.y - labelHeight / 2, -1),
            new THREE.Vector3(center.x + labelWidth / 2, center.y + labelHeight / 2, 1),
          ),
        });
      });
      boxes.forEach(({ label, box }, index) => {
        for (const other of boxes.slice(index + 1))
          expect(box.intersectsBox(other.box), `${label} overlaps ${other.label}`).toBe(false);
      });
      const top = Math.max(...boxes.map(({ box }) => box.max.y));
      const bottom = Math.min(...boxes.map(({ box }) => box.min.y));
      expect(top - bottom, mode).toBeLessThan(maxHeight);
    }
    workspace.dispose();
    container.remove();
  });

  it('keeps preferences in their owning panels and removes terminal key strips', () => {
    const { workspace, container } = fixture();
    for (const mode of [
      'keyboard',
      'commands',
      'panes',
      'arrange',
      'widgets',
      'settings',
      'display',
      'world',
      'terminal',
      'filtering',
    ] as const) {
      workspace.showInput(mode);
      const root = workspace.scene.getObjectByName(`xr-${mode}-controls`);
      if (!root) throw new Error(`Panel missing: ${mode}`);
      const actions = root.children.map((child) => child.userData.inputAction);
      expect(actions.includes('gazeInput')).toBe(mode === 'keyboard');
      expect(Boolean(root.getObjectByName('background-select'))).toBe(mode === 'world');
      expect(actions).not.toContain('mode');
      if (mode === 'commands') expect(actions).not.toContain('pane');
      expect(actions.includes('terminalColors')).toBe(mode === 'display');
      expect(actions.includes('glassOpacity')).toBe(mode === 'terminal');
    }
    expect(workspace.scene.getObjectByName('terminal-key-strip')).toBeUndefined();
    workspace.dispose();
    container.remove();
  });

  it('reuses a vacant slot when reopening a view', () => {
    const { workspace, left } = fixture();
    workspace.removeTerminal(left.pane.id);
    workspace.addTerminal(left);
    const reopened = workspace.scene.getObjectByName('terminal-panel-pane-a');
    const other = workspace.scene.getObjectByName('terminal-panel-pane-b');
    expect(reopened?.position.x).toBeLessThan(other?.position.x ?? -Infinity);
    workspace.dispose();
  });

  it('reaches terminals placed beyond the default laser length', () => {
    const { workspace } = fixture();
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a');
    if (!panel) throw new Error('Terminal missing');
    panel.position.set(0, 1.5, -12);
    panel.quaternion.identity();
    const controller = fakeXR.controllers[0] as THREE.Group;
    controller.position.set(0, 1.5, 0);
    controller.quaternion.identity();
    fakeXR.frame?.(16);
    expect(controller.userData.rayDistance).toBeCloseTo(12);
    const line = controller.children.find((child) => child instanceof THREE.Line);
    expect(line?.scale.z).toBeCloseTo(12 / 8);
    workspace.dispose();
  });

  it('uses one keyboard presentation for the current mode', () => {
    fakeXR.presenting = false;
    const { workspace, actions, container } = fixture();
    workspace.selectTerminal('pane-a');
    workspace.showInput('keyboard');
    expect(actions.openKeyboard).toHaveBeenCalledTimes(1);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    workspace.showInput('panes');
    workspace.showInput('keyboard');
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
    expect(workspace.scene.getObjectByName('xr-panes-controls')).toBeUndefined();
    expect(actions.openKeyboard).toHaveBeenCalledTimes(2);
    fakeXR.presenting = true;
    workspace.showInput('keyboard');
    expect(actions.openKeyboard).toHaveBeenCalledTimes(2);
    expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
    workspace.showInput('commands');
    expect(actions.openCommands).not.toHaveBeenCalled();
    expect(workspace.scene.getObjectByName('xr-commands-controls')).toBeDefined();
    workspace.dispose();
    container.remove();
  });

  it('clears native input when an immersive session ends', async () => {
    const listeners = new Map<string, () => void>();
    const session = {
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    try {
      await workspace.enterXR('vr');
      workspace.selectTerminal('pane-a');
      workspace.showInput('keyboard');
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeDefined();
      fakeXR.presenting = false;
      listeners.get('end')?.();
      expect(workspace.state.xrMode).toBe('desktop');
      expect(workspace.scene.getObjectByName('xr-keyboard-controls')).toBeUndefined();
      expect(workspace.state.inputTargetId).toBeNull();
    } finally {
      workspace.dispose();
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it.each(['row', 'grid', 'arc', 'sphere'] as const)(
    'arranges %s around the current viewer without changing input, scale or terminal grids',
    (pattern) => {
      const { workspace, actions, container, left, right } = fixture();
      workspace.camera.position.set(2, 1.8, 3);
      workspace.camera.rotation.set(0.25, 0.7, 0);
      workspace.selectTerminal('pane-b');
      workspace.showInput('keyboard');
      const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls') as THREE.Group;
      const keyboardPosition = keyboard.position.clone();
      const target = workspace.state.inputTargetId;
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
      panel.scale.setScalar(1.3);
      panel.userData.fontZoom = 1.25;
      vi.clearAllMocks();
      workspace.arrangeTerminals(pattern);
      expect(workspace.state.arrangement).toBe(pattern);
      expect(workspace.state.selectedTerminalId).toBe('pane-b');
      expect(workspace.state.inputTargetId).toBe(target);
      expect(keyboard.position.distanceTo(keyboardPosition)).toBeLessThan(1e-9);
      expect(panel.scale.x).toBe(1.3);
      expect(panel.userData.fontZoom).toBe(1.25);
      for (const id of ['pane-a', 'pane-b']) {
        const root = workspace.scene.getObjectByName(`terminal-panel-${id}`) as THREE.Group;
        const visualCenter = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
        const towardEye = workspace.camera.position.clone().sub(visualCenter).normalize();
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
        expect(normal.dot(towardEye)).toBeGreaterThan(0.999);
      }
      expect(actions.selectPane).not.toHaveBeenCalled();
      expect(actions.resizeGrid).not.toHaveBeenCalled();
      expect(left.resizeGrid).not.toHaveBeenCalled();
      expect(right.resizeGrid).not.toHaveBeenCalled();
      expect(actions.sendKey).not.toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    },
  );

  it('routes the native Arrange menu and keeps the arranged panels grabbable', () => {
    const { workspace, actions, container } = fixture();
    workspace.showInput('arrange');
    const menu = workspace.scene.getObjectByName('xr-arrange-controls') as THREE.Group;
    const position = menu.position.clone();
    hit(workspace, { inputAction: 'arrange', pattern: 'sphere' });
    expect(workspace.state.arrangement).toBe('sphere');
    expect(
      workspace.scene.getObjectByName('xr-arrange-controls')?.position.distanceTo(position),
    ).toBeLessThan(1e-9);
    workspace.hideInput();
    hit(workspace, { terminalTitle: true, terminalId: 'pane-b' }, 'squeezestart');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
    const start = panel.position.clone();
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(16);
    expect(panel.position.x - start.x).toBeCloseTo(0.2);
    expect(actions.resizeGrid).not.toHaveBeenCalled();
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('rebases both held controllers when an arrangement is applied', () => {
    const { workspace, container } = fixture();
    connectController(0);
    connectController(1);
    const first = fakeXR.controllers[0] as THREE.Group;
    const second = fakeXR.controllers[1] as THREE.Group;
    aimController(first, objectWithData(workspace, { terminalTitle: true, terminalId: 'pane-a' }));
    aimController(
      second,
      objectWithData(workspace, { inputAction: 'closePane', terminalId: 'pane-a' }),
    );
    first.dispatchEvent({ type: 'squeezestart' } as never);
    second.dispatchEvent({ type: 'squeezestart' } as never);
    workspace.arrangeTerminals('grid');
    const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
    const position = panel.position.clone();
    const orientation = panel.quaternion.clone();
    fakeXR.frame?.(0);
    fakeXR.frame?.(16);
    expect(panel.position.distanceTo(position)).toBeLessThan(1e-9);
    expect(panel.quaternion.angleTo(orientation)).toBeLessThan(1e-6);
    second.position.add(
      second.position.clone().sub(first.position).normalize().multiplyScalar(0.2),
    );
    fakeXR.frame?.(32);
    expect(panel.scale.x).toBeGreaterThan(1);
    second.dispatchEvent({ type: 'squeezeend' } as never);
    const handedOff = panel.position.clone();
    fakeXR.frame?.(48);
    expect(panel.position.distanceTo(handedOff)).toBeLessThan(1e-9);
    workspace.dispose();
    container.remove();
  });

  it('clears the native pattern highlight when recovery restores the default layout', () => {
    const { workspace, container } = fixture();
    workspace.showInput('arrange');
    hit(workspace, { inputAction: 'arrange', pattern: 'sphere' });
    const active = objectWithData(workspace, {
      inputAction: 'arrange',
      pattern: 'sphere',
    }) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(active.material.color.getHex()).toBe(0x68d6ff);
    workspace.resetLayout();
    expect(workspace.state.arrangement).toBeNull();
    const reset = objectWithData(workspace, {
      inputAction: 'arrange',
      pattern: 'sphere',
    }) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(reset.material.color.getHex()).toBe(0xffffff);
    workspace.dispose();
    container.remove();
  });
});
