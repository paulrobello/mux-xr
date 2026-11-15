import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@par/xr-workspace', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).withLabelsAndCountingHand(
    await importOriginal<typeof import('@par/xr-workspace')>(),
  ),
);
vi.mock('../../src/xr/repo-status-widget', async (original) =>
  (await import('../helpers/xr-mocks')).withSpiedRepoStatus(
    await original<typeof import('../../src/xr/repo-status-widget')>(),
  ),
);
vi.mock('../../src/xr/kanban-strip', async (original) =>
  (await import('../helpers/xr-mocks')).withSpiedKanbanStrip(
    await original<typeof import('../../src/xr/kanban-strip')>(),
  ),
);
vi.mock('three', async (importOriginal) =>
  (await import('../helpers/xr-mocks')).createThreeMock(
    await importOriginal<typeof import('three')>(),
  ),
);

import * as THREE from 'three';
import type { PaneDescriptor, TerminalSurface } from '../../src/contracts';
import type { createWorkspaceScene } from '../../src/xr/scene';
import { terminalWarpPoint } from '../../src/xr/terminal-warp';
import { WIDGET_REGISTRY } from '../../src/xr/widget-registry';
import {
  aimController,
  aimControllerAtScreen,
  connectController,
  fakeXR,
  fixture,
  focusedDirectories,
  hit,
  objectWithData,
  pane,
  resetXRControllers,
  surface,
} from '../helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

  it('lets the left controller press the right wrist Menu watch and rejects its right controller', () => {
    const { workspace, actions, container } = fixture();
    connectController(0, [0, 0, 0, 0], 'right');
    connectController(1, [0, 0, 0, 0], 'left');
    const leftController = fakeXR.controllers[1] as THREE.Group;
    leftController.position.x = -0.5;
    fakeXR.frame?.(20);
    hit(workspace, { inputAction: 'wristMenu' });
    expect(workspace.state.radialOpen).toBe(false);
    const face = objectWithData(workspace, { inputAction: 'wristMenu' });
    aimController(leftController, face);
    workspace.scene.updateMatrixWorld(true);
    fakeXR.frame?.(40);
    leftController.dispatchEvent({ type: 'selectstart' } as never);
    expect(workspace.state.radialOpen).toBe(true);
    fakeXR.frame?.(60);
    expect(workspace.state.radialOpen).toBe(true);
    expect(actions.sendKey).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('shows the radial Reload button only for an available update and closes before reload', () => {
    const { workspace, actions, container } = fixture();
    connectController(0, [0, 0, 0, 0], 'right');
    connectController(1, [0, 0, 0, 0], 'left');
    const leftController = fakeXR.controllers[1] as THREE.Group;
    leftController.position.x = -0.5;
    fakeXR.frame?.(20);
    const face = objectWithData(workspace, { inputAction: 'wristMenu' });
    aimController(leftController, face);
    workspace.scene.updateMatrixWorld(true);
    fakeXR.frame?.(40);
    leftController.dispatchEvent({ type: 'selectstart' } as never);
    expect(workspace.state.radialOpen).toBe(true);
    fakeXR.frame?.(940);

    const reload = workspace.scene.getObjectByName('radial-menu-reload-update');
    if (!reload) throw new Error('Radial Reload button not found');
    expect(reload.visible).toBe(false);
    workspace.setUpdateAvailable(true);
    expect(reload.visible).toBe(true);
    workspace.setUpdateAvailable(false);
    expect(reload.visible).toBe(false);
    workspace.setUpdateAvailable(true);
    expect(reload.visible).toBe(true);

    hit(workspace, { inputAction: 'reloadUpdate' });
    expect(actions.reloadApp).toHaveBeenCalledOnce();
    expect(workspace.state.radialOpen).toBe(false);
    workspace.dispose();
    container.remove();
  });

  it('shows a readable three-line dictation excerpt and scrolls without changing its text', () => {
    const { workspace, actions, container } = fixture();
    const transcript = Array.from({ length: 60 }, (_, index) => `word${index}`).join('\n');
    const draft = { supported: true, status: 'review' as const, transcript, error: null };
    actions.editDictation = (text) => workspace.setDictationState({ ...draft, transcript: text });
    workspace.setDictationState(draft);
    workspace.showInput('keyboard');
    const label = workspace.scene.getObjectByName('xr-dictation-transcript');
    const caption = String(label?.userData.labelText);
    expect(caption.split('\n')).toHaveLength(3);
    expect(caption.split('\n').every((line) => Array.from(line).length <= 36)).toBe(true);
    expect(workspace.state.dictation.transcript).toBe(transcript);
    // A flat Transcript heading names the speech-to-text box from just above its top edge.
    const heading = workspace.scene.getObjectByName('xr-dictation-transcript-heading');
    expect(heading?.userData.labelText).toBe('Transcript');
    expect(heading?.userData.inputAction).toBe('noop');
    const top = (label?.position.y ?? 0) + Number(label?.userData.labelHeight) / 2;
    const bottom = (heading?.position.y ?? 0) - Number(heading?.userData.labelHeight) / 2;
    expect(bottom).toBeGreaterThan(top);
    expect(bottom - top).toBeLessThan(0.03);
    hit(workspace, { inputAction: 'key', key: 'ArrowUp' });
    expect(label?.userData.labelText).not.toBe(caption);
    expect(workspace.state.dictation.transcript).toBe(transcript);
    workspace.dispose();
    container.remove();
  });

  describe('trigger text selection', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      vi.unstubAllGlobals();
    });
    const setupSelection = (writeText = vi.fn(() => Promise.resolve())) => {
      const value = fixture();
      const { workspace, actions, left, container } = value;
      cleanups.push(() => {
        workspace.dispose();
        container.remove();
      });
      actions.sendMouse = vi.fn(() => false);
      left.beginSelection = vi.fn(() => true);
      left.updateSelection = vi.fn();
      left.getSelectionText = vi.fn(() => 'exact text\n界 😀');
      left.clearSelection = vi.fn();
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const screen = workspace.scene
        .getObjectByName('terminal-panel-pane-a')
        ?.getObjectByName('terminal-surface') as THREE.Mesh<THREE.PlaneGeometry>;
      const width = screen.geometry.parameters.width;
      const height = screen.geometry.parameters.height;
      const aimCell = (col: number, row: number): void => {
        const point = terminalWarpPoint(((col + 0.5) / left.cols - 0.5) * width, {
          width,
          height,
          radians: THREE.MathUtils.degToRad(workspace.getTerminalCurvature('pane-a')),
        });
        aimControllerAtScreen(
          controller,
          screen,
          new THREE.Vector3(point.x, (0.5 - (row + 0.5) / left.rows) * height, point.z),
        );
      };
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const start = (): void => {
        aimCell(2, 3);
        controller.dispatchEvent({ type: 'selectstart' } as never);
      };
      const drag = (): void => {
        aimCell(8, 5);
        fakeXR.frame?.(100);
      };
      const finish = (): void => {
        controller.dispatchEvent({ type: 'select' } as never);
        controller.dispatchEvent({ type: 'selectend' } as never);
      };
      return { ...value, controller, aimCell, start, drag, finish, writeText };
    };

    it('copies curved-grid text and clears immediately on completed trigger release', async () => {
      let resolveWrite: (() => void) | undefined;
      const write = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );
      const { workspace, left, start, drag, finish } = setupSelection(write);
      workspace.setTerminalCurvature('pane-a', 60);
      start();
      expect(left.beginSelection).toHaveBeenCalledWith({ col: 2, row: 3 });
      drag();
      expect(left.updateSelection).toHaveBeenLastCalledWith({ col: 8, row: 5 });
      expect(write).not.toHaveBeenCalled();
      finish();
      expect(write).toHaveBeenCalledExactlyOnceWith('exact text\n界 😀');
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      expect(workspace.state.toast).toContain('Copied');
      resolveWrite?.();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('clears selection and keeps local paste available when system copy fails', async () => {
      const { workspace, left, start, drag, finish } = setupSelection(
        vi.fn(() => Promise.reject(new Error('denied'))),
      );
      start();
      drag();
      finish();
      await Promise.resolve();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      expect(workspace.state.toast).toContain('Copied in Mux XR');
      left.paste = vi.fn(() => true);
      expect(await workspace.pasteClipboard('pane-a')).toBe(true);
      expect(left.paste).toHaveBeenCalledWith('exact text\n界 😀');
    });

    it('keeps copied text available through grip and recenter while OS copy is pending', async () => {
      let rejectWrite: ((reason: Error) => void) | undefined;
      const { workspace, left, controller, start, drag, finish } = setupSelection(
        vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectWrite = reject;
            }),
        ),
      );
      start();
      drag();
      finish();
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      workspace.resetLayout();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      rejectWrite?.(new Error('denied'));
      await Promise.resolve();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(1);
      expect(workspace.state.toast).toContain('Copied in Mux XR');
    });

    it('pastes only on a completed native Paste gesture and cancels on disconnect', async () => {
      const { workspace, left, controller, start, drag, finish } = setupSelection();
      start();
      drag();
      finish();
      left.paste = vi.fn(() => true);
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'pasteClipboard' });
      expect(left.paste).not.toHaveBeenCalled();
      finish();
      await Promise.resolve();
      expect(left.paste).toHaveBeenCalledExactlyOnceWith('exact text\n界 😀');
      expect(workspace.state.toast).toBe('Pasted.');
      hit(workspace, { inputAction: 'pasteClipboard' });
      controller.dispatchEvent({ type: 'disconnected' } as never);
      finish();
      await Promise.resolve();
      expect(left.paste).toHaveBeenCalledTimes(1);
    });

    const flush = async (): Promise<void> => {
      for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
    };

    it('types the host clipboard into the selected terminal from the keyboard panel', async () => {
      const { workspace, actions, left, right } = setupSelection();
      left.paste = vi.fn(() => true);
      right.paste = vi.fn(() => true);
      actions.readHostClipboard = vi.fn(async () => ({ ok: true as const, value: 'host 界' }));
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'pasteHostClipboard' });
      await flush();
      expect(actions.readHostClipboard).toHaveBeenCalledTimes(1);
      expect(left.paste).toHaveBeenCalledExactlyOnceWith('host 界');
      expect(right.paste).not.toHaveBeenCalled();
      expect(workspace.state.toast).toBe('Pasted host clipboard.');
    });

    it('shows the host refusal and pastes nothing when the host read fails', async () => {
      const { workspace, actions, left } = setupSelection();
      left.paste = vi.fn(() => true);
      actions.readHostClipboard = vi.fn(async () => ({
        ok: false as const,
        code: 'disabled' as const,
        message: 'Host clipboard sync is off on the Mac.',
      }));
      expect(await workspace.pasteHostClipboard('pane-a')).toBe(false);
      expect(left.paste).not.toHaveBeenCalled();
      expect(workspace.state.notice).toBe('Host clipboard sync is off on the Mac.');
    });

    it('sends text copied in Mux XR to the host only on a completed native gesture', async () => {
      const { workspace, actions, start, drag, finish } = setupSelection(
        vi.fn(() => Promise.reject(new Error('denied'))),
      );
      actions.writeHostClipboard = vi.fn(async (text: string) => ({
        ok: true as const,
        value: text.length,
      }));
      start();
      drag();
      finish();
      await flush();
      workspace.showInput('keyboard');
      hit(workspace, { inputAction: 'copyToHost' });
      expect(actions.writeHostClipboard).not.toHaveBeenCalled();
      finish();
      await flush();
      expect(actions.writeHostClipboard).toHaveBeenCalledExactlyOnceWith('exact text\n界 😀');
      expect(workspace.state.toast).toBe('Copied to host clipboard.');
    });

    it('keeps host text pasteable when the Quest clipboard refuses the write', async () => {
      const { workspace, actions, left } = setupSelection(
        vi.fn(() => Promise.reject(new Error('not focused'))),
      );
      left.paste = vi.fn(() => true);
      actions.readHostClipboard = vi.fn(async () => ({ ok: true as const, value: 'from mac' }));
      expect(await workspace.copyHostToQuest()).toBe(false);
      expect(workspace.state.toast).toContain('Quest clipboard refused it');
      expect(await workspace.pasteClipboard('pane-a')).toBe(true);
      expect(left.paste).toHaveBeenCalledWith('from mac');
    });

    it('ignores a second Paste host press while one is in flight (F6)', async () => {
      const { workspace, actions, left } = setupSelection();
      left.paste = vi.fn(() => true);
      let resolveRead!: (value: { ok: true; value: string }) => void;
      actions.readHostClipboard = vi.fn(
        () =>
          new Promise<{ ok: true; value: string }>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const first = workspace.pasteHostClipboard('pane-a');
      expect(await workspace.pasteHostClipboard('pane-a')).toBe(false);
      expect(actions.readHostClipboard).toHaveBeenCalledTimes(1);
      resolveRead({ ok: true, value: 'host once' });
      expect(await first).toBe(true);
      expect(left.paste).toHaveBeenCalledExactlyOnceWith('host once');
    });

    it('drops a host paste superseded by another clipboard action (F6)', async () => {
      const { workspace, actions, left } = setupSelection();
      left.paste = vi.fn(() => true);
      let resolveRead!: (value: { ok: true; value: string }) => void;
      actions.readHostClipboard = vi.fn(
        () =>
          new Promise<{ ok: true; value: string }>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const pending = workspace.pasteHostClipboard('pane-a');
      void workspace.pasteClipboard('pane-a');
      resolveRead({ ok: true, value: 'stale host text' });
      expect(await pending).toBe(false);
      expect(left.paste).not.toHaveBeenCalledWith('stale host text');
    });

    it('never sends kept host text back to the host (F5)', async () => {
      const { workspace, actions } = setupSelection();
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText: () => Promise.reject(new Error('not focused')),
          readText: () => Promise.reject(new Error('denied')),
        },
      });
      actions.readHostClipboard = vi.fn(async () => ({ ok: true as const, value: 'from mac' }));
      actions.writeHostClipboard = vi.fn();
      await workspace.copyHostToQuest();
      expect(await workspace.copyQuestToHost()).toBe(false);
      expect(actions.writeHostClipboard).not.toHaveBeenCalled();
    });

    it('reports an empty Quest clipboard instead of sending to the host', async () => {
      const { workspace, actions } = setupSelection();
      vi.stubGlobal('navigator', { clipboard: { readText: async () => '' } });
      actions.writeHostClipboard = vi.fn();
      expect(await workspace.copyQuestToHost()).toBe(false);
      expect(actions.writeHostClipboard).not.toHaveBeenCalled();
      expect(workspace.state.notice).toContain('Quest clipboard is empty');
    });

    it('does not paste into a different pane while an external clipboard read is pending', async () => {
      let resolveRead!: (text: string) => void;
      const { workspace, left, right } = setupSelection();
      left.paste = vi.fn(() => true);
      right.paste = vi.fn(() => true);
      vi.stubGlobal('navigator', {
        clipboard: {
          readText: () =>
            new Promise<string>((resolve) => {
              resolveRead = resolve;
            }),
        },
      });
      const pending = workspace.pasteClipboard('pane-a');
      workspace.selectTerminal('pane-b');
      resolveRead('external text');
      expect(await pending).toBe(false);
      expect(left.paste).not.toHaveBeenCalled();
      expect(right.paste).not.toHaveBeenCalled();
      expect(workspace.state.notice).toContain('paste target changed');
    });

    it('does not copy a click or a cancelled selectend', () => {
      const { left, controller, start, drag, finish, writeText } = setupSelection();
      start();
      finish();
      expect(writeText).not.toHaveBeenCalled();
      start();
      drag();
      controller.dispatchEvent({ type: 'selectend' } as never);
      expect(writeText).not.toHaveBeenCalled();
      expect(left.clearSelection).toHaveBeenCalledTimes(2);
    });

    it('keeps a jittered press a click that selects the pane without copying', () => {
      const { workspace, left, aimCell, start, finish, writeText } = setupSelection();
      workspace.selectTerminal('pane-b');
      start();
      expect(workspace.state.selectedTerminalId).toBe('pane-a');
      aimCell(3, 3);
      fakeXR.frame?.(50);
      aimCell(3, 4);
      fakeXR.frame?.(60);
      finish();
      expect(left.updateSelection).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
      expect(workspace.state.toast).toBeNull();
      start();
      aimCell(12, 6);
      fakeXR.frame?.(100);
      finish();
      expect(left.updateSelection).toHaveBeenLastCalledWith({ col: 12, row: 6 });
      expect(writeText).toHaveBeenCalledOnce();
    });

    it('cancels selection on grip, disconnect, recenter and removal without copying', () => {
      for (const action of ['grip', 'disconnect', 'reset', 'remove'] as const) {
        const { workspace, left, controller, start, drag, finish, writeText } = setupSelection();
        start();
        drag();
        if (action === 'grip') controller.dispatchEvent({ type: 'squeezestart' } as never);
        else if (action === 'disconnect')
          controller.dispatchEvent({ type: 'disconnected' } as never);
        else if (action === 'reset') workspace.resetLayout();
        else workspace.removeTerminal('pane-a');
        finish();
        expect(writeText).not.toHaveBeenCalled();
        expect(left.clearSelection).toHaveBeenCalledTimes(1);
        workspace.dispose();
      }
    });

    it('keeps TUI mouse reporting and suppresses selection while gripping', () => {
      const { actions, left, controller, start, drag, finish, writeText } = setupSelection();
      Object.defineProperty(left, 'mouseTracking', { value: 'drag' });
      actions.sendMouse = vi.fn(() => true);
      start();
      drag();
      finish();
      expect(actions.sendMouse).toHaveBeenCalled();
      expect(left.beginSelection).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      start();
      expect(left.beginSelection).not.toHaveBeenCalled();
    });

    it('does not clear a newer selection when an older clipboard write resolves', async () => {
      let resolveWrite: (() => void) | undefined;
      const { left, start, drag, finish } = setupSelection(
        vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveWrite = resolve;
            }),
        ),
      );
      start();
      drag();
      finish();
      start();
      drag();
      const clear = left.clearSelection;
      if (!clear) throw new Error('Selection cleanup missing');
      const cleared = vi.mocked(clear).mock.calls.length;
      resolveWrite?.();
      await Promise.resolve();
      expect(left.clearSelection).toHaveBeenCalledTimes(cleared);
    });
  });

  it.each([
    { eyeHeight: 0.85, yaw: 0.8, pitch: -0.34 },
    { eyeHeight: 1.7, yaw: -1.2, pitch: 0.3 },
  ])(
    'spawns the widgets above the floor and inside the forward view from $eyeHeight m',
    ({ eyeHeight, yaw, pitch }) => {
      const { workspace, container } = fixture();
      try {
        const eye = new THREE.Vector3(1.3, eyeHeight, 0.5);
        workspace.camera.position.copy(eye);
        workspace.camera.rotation.set(pitch, yaw, 0, 'YXZ');
        workspace.camera.updateMatrixWorld(true);
        const inverseHeading = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -yaw,
        );
        for (const { kind } of WIDGET_REGISTRY) {
          if (kind === 'sticky-note') continue;
          workspace.showInput('widgets');
          hit(workspace, { inputAction: 'toggleWidget', widgetKind: kind });
          const widget = workspace.scene.children.find(
            (child) => child.userData.widgetKind === kind,
          );
          if (!widget) throw new Error(`Widget did not open: ${kind}`);
          widget.updateWorldMatrix(true, true);
          const bounds = new THREE.Box3();
          widget.traverseVisible((child) => {
            const geometry = (child as THREE.Mesh).geometry;
            if (!geometry || child.parent?.userData.labelTextObject === child) return;
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            if (!box || box.isEmpty()) return;
            for (const x of [box.min.x, box.max.x])
              for (const y of [box.min.y, box.max.y])
                for (const z of [box.min.z, box.max.z]) {
                  const point = child.localToWorld(new THREE.Vector3(x, y, z));
                  expect(point.y, kind).toBeGreaterThanOrEqual(0.095 - 1e-6);
                  bounds.expandByPoint(point.sub(eye).applyQuaternion(inverseHeading));
                }
          });
          const center = bounds.getCenter(new THREE.Vector3());
          expect(center.z, kind).toBeLessThan(0);
          expect(Math.abs(center.x / center.z), kind).toBeLessThanOrEqual(1 + 1e-6);
          expect(Math.abs(center.y / center.z), kind).toBeLessThanOrEqual(
            Math.tan(Math.PI / 5) + 1e-6,
          );
        }
      } finally {
        workspace.dispose();
        container.remove();
      }
    },
  );

  it('replaces the HUD keyboard shortcut with Widgets and closes clocks without typing', () => {
    const { workspace, actions, container } = fixture();
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    const modes = hud?.children.map((object) => object.userData.mode);
    expect(modes).not.toContain('widgets');
    expect(modes).not.toContain('keyboard');
    workspace.showInput('widgets');
    // Close, the title and every widget button keep apart on the real panel.
    const controls = (objectWithData(workspace, { inputAction: 'close' }).parent?.children ?? [])
      .filter(
        (child) =>
          ['close', 'grabInput', 'toggleWidget'].includes(child.userData.inputAction) &&
          child.name !== 'input-backdrop',
      )
      .map((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry.computeBoundingBox();
        return (mesh.geometry.boundingBox as THREE.Box3).clone().translate(mesh.position);
      });
    expect(controls.length).toBeGreaterThanOrEqual(9);
    for (const [index, box] of controls.entries())
      for (const other of controls.slice(index + 1)) {
        const overlap = box.clone().intersect(other);
        expect(Math.min(overlap.max.x - overlap.min.x, overlap.max.y - overlap.min.y)).toBeLessThan(
          1e-6,
        );
      }
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    expect(workspace.state.widgets).toEqual(['digital-clock']);
    const root = objectWithData(workspace, {
      widgetKind: 'digital-clock',
      inputAction: 'grabWidget',
    });
    hit(workspace, { inputAction: 'grabWidget', widgetKind: 'digital-clock' }, 'squeezestart');
    const initial = root.getWorldPosition(new THREE.Vector3());
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(16);
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(initial)).toBeGreaterThan(0.1);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    hit(workspace, { inputAction: 'closeWidget', widgetKind: 'digital-clock' });
    expect(workspace.state.widgets).toEqual([]);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(actions.sendText).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('places, grabs and closes a widget whose factory stamps no metadata', () => {
    const { workspace, container } = fixture();
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    const stamped = objectWithData(workspace, {
      widgetKind: 'digital-clock',
      inputAction: 'grabWidget',
    });
    let stampedRoot = stamped;
    while (stampedRoot.parent && stampedRoot.parent !== workspace.scene)
      stampedRoot = stampedRoot.parent;
    const spawn = stampedRoot.position.clone();
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    expect(workspace.state.widgets).toEqual([]);

    const bare = new THREE.Group();
    const entry = WIDGET_REGISTRY[0] as unknown as { create: (env: unknown) => unknown };
    const create = vi.spyOn(entry, 'create').mockReturnValue({
      root: bare,
      update: () => undefined,
      dispose: () => undefined,
    });
    try {
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
      expect(workspace.state.widgets).toEqual(['digital-clock']);
      expect(bare.parent).toBe(workspace.scene);
      expect(bare.position.distanceTo(spawn)).toBeLessThan(1e-6);
      // Children added after creation carry no widget metadata at all.
      const plain = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.2),
        new THREE.MeshBasicMaterial(),
      );
      plain.userData.latePlain = true;
      plain.position.set(-0.2, 0, 0.02);
      const close = new THREE.Mesh(
        new THREE.PlaneGeometry(0.05, 0.05),
        new THREE.MeshBasicMaterial(),
      );
      close.userData.inputAction = 'lateClose';
      close.position.set(0.2, 0, 0.02);
      bare.add(plain, close);
      workspace.scene.updateMatrixWorld(true);
      hit(workspace, { latePlain: true }, 'squeezestart');
      const initial = bare.getWorldPosition(new THREE.Vector3());
      (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
      fakeXR.frame?.(16);
      expect(bare.getWorldPosition(new THREE.Vector3()).distanceTo(initial)).toBeGreaterThan(0.1);
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
      close.userData.inputAction = 'closeWidget';
      hit(workspace, { inputAction: 'closeWidget' });
      expect(workspace.state.widgets).toEqual([]);
      expect(bare.parent).toBeNull();
    } finally {
      create.mockRestore();
      workspace.dispose();
      container.remove();
    }
  });

  it('feeds the agent board, focuses a row pane and still grabs and closes it', () => {
    const { workspace, actions, container } = fixture();
    const now = Date.now();
    const row = (paneId: string, state: string, lastActivityAt: number) => ({
      paneId,
      agent: 'claude',
      state,
      reason: '',
      workspace: '+1',
      project: '',
      paneLabel: '',
      source: 'hook',
      stalled: false,
      lastActivityAt,
      lastReportAt: 0,
      lastInputAt: 0,
      lastViewedAt: 0,
      viewerCount: 0,
      cpuMs: 0,
      workspaceName: 'Main',
      title: `Shell ${paneId}`,
      sessionName: 'S',
      windowName: 'W',
    });
    workspace.setAgentRoster([row('pane-b', 'working', now - 30_000)]);
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'agent-board' });
    expect(workspace.state.widgets).toEqual(['agent-board']);
    const plate = objectWithData(workspace, {
      inputAction: 'selectAgentPane',
      agentPaneId: 'pane-b',
    });
    expect(plate.parent?.getObjectByName('agent-board-row-age')?.userData.labelText).toBe('30s');
    // An age-only change skips the menu signature but must still reach the board.
    workspace.setAgentRoster([row('pane-b', 'working', now - 3 * 60_000)]);
    expect(plate.parent?.getObjectByName('agent-board-row-age')?.userData.labelText).toBe('3m');
    vi.mocked(actions.selectPane).mockClear();
    hit(workspace, { inputAction: 'selectAgentPane', agentPaneId: 'pane-b' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-b');
    // A grip on a row moves the board instead of selecting.
    vi.mocked(actions.selectPane).mockClear();
    let root: THREE.Object3D = plate;
    while (root.parent && root.parent !== workspace.scene) root = root.parent;
    hit(workspace, { inputAction: 'selectAgentPane', agentPaneId: 'pane-b' }, 'squeezestart');
    const initial = root.getWorldPosition(new THREE.Vector3());
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(16);
    expect(root.getWorldPosition(new THREE.Vector3()).distanceTo(initial)).toBeGreaterThan(0.1);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    expect(actions.selectPane).not.toHaveBeenCalled();
    // A row for a pane that left the tree selects nothing.
    workspace.setAgentRoster([row('pane-gone', 'question', now)]);
    hit(workspace, { inputAction: 'selectAgentPane', agentPaneId: 'pane-gone' });
    expect(actions.selectPane).not.toHaveBeenCalled();
    expect(workspace.state.notice).toBe('That agent pane is no longer open');
    hit(workspace, { inputAction: 'closeWidget', widgetKind: 'agent-board' });
    expect(workspace.state.widgets).toEqual([]);
    workspace.dispose();
    container.remove();
  });

  it('feeds the bell feed from pane bells and notices, selects a bell pane and clears viewed panes', () => {
    const { workspace, actions, container, left, right } = fixture();
    const ringing = (descriptor: PaneDescriptor) => {
      const state = { bell: false };
      const listeners = new Set<() => void>();
      const ring = (bell: boolean): void => {
        state.bell = bell;
        for (const listener of listeners) listener();
      };
      const terminal: TerminalSurface = {
        ...surface(descriptor),
        get bellPending() {
          return state.bell;
        },
        acknowledgeBell: () => ring(false),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      return { terminal, ring };
    };
    const build = ringing(pane('pane-c', 'build'));
    const tests = ringing(pane('pane-d', 'tests'));
    workspace.addTerminal(build.terminal);
    workspace.addTerminal(tests.terminal);
    workspace.setAvailablePanes([left.pane, right.pane, build.terminal.pane, tests.terminal.pane]);
    // Bells raised while the feed is closed show once it opens.
    build.ring(true);
    tests.ring(true);
    // Only opted-in notices reach the feed; direct feedback stays on the HUD.
    workspace.setNotice('Streamer connection lost', { feed: true });
    workspace.setNotice('Clipboard is empty');
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'bell-feed' });
    expect(workspace.state.widgets).toEqual(['bell-feed']);
    const feed = workspace.scene.children.find((child) => child.name.startsWith('bell-feed-'));
    if (!feed) throw new Error('bell feed missing');
    const shown = (): string[] =>
      feed.children
        .filter((child) => child.name.startsWith('bell-feed-row-') && child.visible)
        .map((row) => String(row.getObjectByName('bell-feed-row-label')?.userData.labelText));
    expect(shown()).toEqual(['Streamer connection lost', 'tests', 'build']);
    const plate = objectWithData(workspace, {
      inputAction: 'selectBellPane',
      bellPaneId: 'pane-c',
    });
    expect(plate.parent?.getObjectByName('bell-feed-row-age')?.userData.labelText).toBe('now');
    // A bell row focuses its pane through the shared selection path and leaves the feed.
    vi.mocked(actions.selectPane).mockClear();
    hit(workspace, { inputAction: 'selectBellPane', bellPaneId: 'pane-c' });
    expect(actions.selectPane).toHaveBeenLastCalledWith('pane-c');
    expect(shown()).toEqual(['Streamer connection lost', 'tests']);
    // Selecting the pane in the scene acknowledges its bell, which clears its entry.
    workspace.selectTerminal('pane-d');
    expect(shown()).toEqual(['Streamer connection lost']);
    expect(feed.getObjectByName('bell-feed-header')?.userData.labelText).toBe('Bells');
    // A HUD notice row shows but never selects.
    vi.mocked(actions.selectPane).mockClear();
    const notice = feed.getObjectByName('bell-feed-row-1')?.getObjectByName('bell-feed-row-plate');
    expect(notice?.userData.inputAction).toBe('grabWidget');
    expect(notice?.userData.bellPaneId).toBeUndefined();
    // A bell for a pane that left the tree selects nothing.
    build.ring(false);
    build.ring(true);
    workspace.setAvailablePanes([left.pane, right.pane]);
    hit(workspace, { inputAction: 'selectBellPane', bellPaneId: 'pane-c' });
    expect(actions.selectPane).not.toHaveBeenCalled();
    expect(workspace.state.notice).toBe('That bell pane is no longer open');
    // Renaming relabels a pending bell in place; closing the pane's view clears it.
    build.ring(false);
    build.ring(true);
    workspace.setAvailablePanes([left.pane, right.pane, { ...build.terminal.pane, title: 'make' }]);
    expect(shown()).toEqual(['make', 'Streamer connection lost']);
    workspace.removeTerminal('pane-c');
    expect(shown()).toEqual(['Streamer connection lost']);
    hit(workspace, { inputAction: 'closeWidget', widgetKind: 'bell-feed' });
    expect(workspace.state.widgets).toEqual([]);
    workspace.dispose();
    container.remove();
  });

  describe('HUD over widgets', () => {
    // The layout viewer the widgets spawned from, recovered from the digital clock's offset.
    const EYE = new THREE.Vector3();
    const projected = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      const xs: number[] = [];
      const ys: number[] = [];
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const depth = EYE.z - z;
            xs.push((x - EYE.x) / depth);
            ys.push((y - EYE.y) / depth);
          }
      return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
    };
    const overlaps = (left: THREE.Object3D, right: THREE.Object3D): boolean => {
      const a = projected(left);
      const b = projected(right);
      return a.x[0] < b.x[1] && b.x[0] < a.x[1] && a.y[0] < b.y[1] && b.y[0] < a.y[1];
    };
    // Notes come from Pin as note, not the panel; the sticky note entry is last, so indexes hold.
    const spawned = WIDGET_REGISTRY.filter(({ kind }) => kind !== 'sticky-note');
    const spawnAll = (workspace: ReturnType<typeof createWorkspaceScene>): THREE.Object3D[] => {
      for (const { kind } of spawned) {
        workspace.showInput('widgets');
        hit(workspace, { inputAction: 'toggleWidget', widgetKind: kind });
      }
      expect(workspace.state.widgets).toHaveLength(spawned.length);
      const roots: THREE.Object3D[] = [];
      for (const { kind } of spawned) {
        let root = objectWithData(workspace, { widgetKind: kind });
        while (root.parent && root.parent !== workspace.scene) root = root.parent;
        roots.push(root);
      }
      const [x, y, z] = WIDGET_REGISTRY[0].spawnOffset;
      expect(roots[0]?.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
      EYE.copy(roots[0]?.position ?? new THREE.Vector3()).sub(new THREE.Vector3(x, y, z));
      return roots;
    };
    // Mirrors the both-stick recenter: 0.65 m below and 1.35 m ahead of the eye.
    const recenterHud = (hud: THREE.Object3D): void => {
      hud.position.set(EYE.x, EYE.y - 0.65, EYE.z - 1.35);
      hud.quaternion.identity();
      hud.updateMatrixWorld(true);
    };

    it('reports in-scene text entry only while the command editor is open', () => {
      const { workspace, container } = fixture();
      expect(workspace.isTextEntryActive()).toBe(false);
      workspace.showInput('commands');
      hit(workspace, { inputAction: 'newCommand' });
      expect(workspace.isTextEntryActive()).toBe(true);
      workspace.hideInput();
      expect(workspace.isTextEntryActive()).toBe(false);
      workspace.dispose();
      container.remove();
    });

    it('draws notice, toast, dismiss and Reload above widgets', () => {
      const { workspace, container } = fixture();
      const hud = workspace.scene.getObjectByName('xr-workspace-hud');
      const overlays = hud?.children.filter((child) => child.userData.hudOverlay) ?? [];
      expect(overlays.map((child) => String(child.userData.inputAction)).sort()).toEqual([
        'dismissNotice',
        'dismissNotice',
        'noop',
        'noop',
        'noop',
        'reloadUpdate',
      ]);
      for (const overlay of overlays)
        overlay.traverse((child) => {
          expect(child.renderOrder).toBeGreaterThan(30);
          const material = (child as THREE.Mesh).material as THREE.Material | undefined;
          if (material) expect(material.depthTest).toBe(false);
        });
      workspace.dispose();
      container.remove();
    });

    const ROSTER_PANES = ['pane-a', 'pane-b', 'pane-c', 'pane-d', 'pane-e', 'pane-f'];
    const rosterRow = (paneId: string) => ({
      paneId,
      agent: 'claude',
      state: 'working',
      reason: '',
      workspace: '+1',
      project: '',
      paneLabel: '',
      source: 'hook',
      stalled: false,
      lastActivityAt: Date.now(),
      lastReportAt: 0,
      lastInputAt: 0,
      lastViewedAt: 0,
      viewerCount: 0,
      cpuMs: 0,
      workspaceName: 'Main',
      title: paneId,
      sessionName: 'S',
      windowName: 'W',
    });
    it('uses the focused agent project when its shell sends no directory', () => {
      const { workspace, left, container } = fixture();
      try {
        for (const kind of ['repo-status', 'kanban-strip']) {
          workspace.showInput('widgets');
          hit(workspace, { inputAction: 'toggleWidget', widgetKind: kind });
        }
        workspace.selectTerminal('pane-a');
        workspace.setAgentRoster([
          { ...rosterRow('pane-a'), project: 'alpha' },
          { ...rosterRow('pane-b'), project: 'beta' },
        ]);
        fakeXR.frame?.(0);
        for (const probe of Object.values(focusedDirectories))
          expect(probe).toHaveBeenLastCalledWith('pane-a', '~/Repos/alpha', null);
        Object.assign(left, { cwd: '/actual/worktree', cwdHost: 'other-mac' });
        fakeXR.frame?.(16);
        for (const probe of Object.values(focusedDirectories))
          expect(probe).toHaveBeenLastCalledWith('pane-a', '/actual/worktree', 'other-mac');
        Object.assign(left, { cwd: null, cwdHost: null });
        workspace.setAgentRoster([{ ...rosterRow('pane-b'), project: 'beta' }]);
        fakeXR.frame?.(32);
        for (const probe of Object.values(focusedDirectories))
          expect(probe).toHaveBeenLastCalledWith('pane-a', null, null);
      } finally {
        workspace.dispose();
        container.remove();
      }
    });

    const aim = (
      workspace: ReturnType<typeof createWorkspaceScene>,
      target: THREE.Vector3,
    ): THREE.Group => {
      const controller = fakeXR.controllers[0] as THREE.Group;
      controller.position.copy(EYE);
      controller.lookAt(target);
      // three's lookAt points +z at the target for non-cameras; the ray runs down -z.
      controller.rotateY(Math.PI);
      workspace.scene.updateMatrixWorld(true);
      return controller;
    };
    const firstWidgetHit = (
      roots: THREE.Object3D[],
      target: THREE.Vector3,
    ): THREE.Intersection | undefined => {
      const ray = new THREE.Raycaster(EYE, target.clone().sub(EYE).normalize());
      ray.far = EYE.distanceTo(target);
      return ray.intersectObjects(roots, true).find((entry) => {
        for (let node: THREE.Object3D | null = entry.object; node; node = node.parent)
          if (!node.visible) return false;
        return true;
      });
    };

    // Default HUD: world-fixed at y 0.78, 1.35 m ahead of a viewer at the origin, so its offset
    // from the eye depends on eye height (local-floor). Recentered HUD: 0.65 m below the eye.
    for (const eyeHeight of [1.1, 1.35, 1.52, 1.8]) {
      it(`reaches overlay HUD controls through widgets and never a hidden one, eye ${eyeHeight} m`, () => {
        const { workspace, actions, container } = fixture();
        workspace.setAgentRoster(ROSTER_PANES.map(rosterRow));
        const roots = spawnAll(workspace);
        const hud = workspace.scene.getObjectByName('xr-workspace-hud');
        if (!hud) throw new Error('HUD missing');
        const exit = hud.children.find((child) => child.userData.inputAction === 'exit');
        if (!exit) throw new Error('HUD Exit missing');
        let blocked = 0;
        for (const offsetY of [0.78 - eyeHeight, -0.65]) {
          hud.position.set(EYE.x, EYE.y + offsetY, EYE.z - 1.35);
          hud.quaternion.identity();
          workspace.setNotice('Overlay check');
          for (const child of hud.children)
            if (child.userData.inputAction === 'reloadUpdate') child.visible = true;
          workspace.scene.updateMatrixWorld(true);
          for (const child of hud.children) {
            const action = String(child.userData.inputAction);
            if (!child.visible || ['noop', 'grabInput', 'undefined'].includes(action)) continue;
            const target = child.getWorldPosition(new THREE.Vector3());
            const widgetHit = firstWidgetHit(roots, target);
            // An unblocked non-overlay control is ordinary input; pressing Exit there would arm it.
            if (!child.userData.hudOverlay && !widgetHit) continue;
            vi.mocked(actions.selectPane).mockClear();
            vi.mocked(actions.reloadApp ?? vi.fn()).mockClear();
            aim(workspace, target).dispatchEvent({ type: 'selectstart' } as never);
            if (child.userData.hudOverlay) {
              // Overlay controls draw on top, so they stay reachable at every eye height.
              if (action === 'reloadUpdate') expect(actions.reloadApp).toHaveBeenCalled();
              else expect(workspace.state.notice).toBeNull();
              workspace.setNotice('Overlay check');
              continue;
            }
            // A control a widget hides never fires through it; the widget takes the press.
            expect(exit.userData.labelText, `${action} at HUD ${offsetY.toFixed(2)}`).toBe('Exit');
            if (!widgetHit) continue;
            blocked += 1;
            const pane = widgetHit.object.userData.agentPaneId;
            if (widgetHit.object.userData.inputAction === 'selectAgentPane' && pane)
              if (['pane-a', 'pane-b'].includes(String(pane)))
                expect(actions.selectPane).toHaveBeenLastCalledWith(pane);
              else expect(workspace.state.notice).toBe('That agent pane is no longer open');
          }
        }
        // Seated, the board covers the default HUD bar's Exit; the check above must have run.
        if (eyeHeight <= 1.1) expect(blocked).toBeGreaterThan(0);
        workspace.dispose();
        container.remove();
      });
    }

    for (const eyeHeight of [1.1, 1.35, 1.52, 1.8]) {
      it(`keeps the timer clear of every HUD control at the default and recentered poses, eye ${eyeHeight} m`, () => {
        const { workspace, container } = fixture();
        const roots = spawnAll(workspace);
        const timer = roots[WIDGET_REGISTRY.findIndex((entry) => entry.kind === 'timer')];
        const hud = workspace.scene.getObjectByName('xr-workspace-hud');
        if (!timer || !hud) throw new Error('timer or HUD missing');
        let checked = 0;
        for (const offsetY of [0.78 - eyeHeight, -0.65]) {
          hud.position.set(EYE.x, EYE.y + offsetY, EYE.z - 1.35);
          hud.quaternion.identity();
          hud.updateMatrixWorld(true);
          for (const child of hud.children) {
            const target = child.getWorldPosition(new THREE.Vector3());
            expect(firstWidgetHit([timer], target), String(child.userData.inputAction)).toBe(
              undefined,
            );
            checked += 1;
          }
        }
        expect(checked).toBeGreaterThan(10);
        workspace.dispose();
        container.remove();
      });
    }

    for (const eyeHeight of [1.1, 1.52, 1.8]) {
      it(`spawns the bell feed clear of the other widgets and both HUD poses, eye ${eyeHeight} m`, () => {
        const { workspace, container } = fixture();
        const roots = spawnAll(workspace);
        const feed = roots[WIDGET_REGISTRY.findIndex(({ kind }) => kind === 'bell-feed')];
        const hud = workspace.scene.getObjectByName('xr-workspace-hud');
        if (!feed || !hud) throw new Error('missing');
        for (const other of roots)
          if (other !== feed) expect(overlaps(feed, other), other.name).toBe(false);
        for (const offsetY of [0.78 - eyeHeight, -0.65]) {
          hud.position.set(EYE.x, EYE.y + offsetY, EYE.z - 1.35);
          hud.quaternion.identity();
          workspace.setNotice('Overlay check');
          workspace.scene.updateMatrixWorld(true);
          for (const child of hud.children)
            if (child.visible)
              expect(overlaps(feed, child), `${child.name} at HUD ${offsetY.toFixed(2)}`).toBe(
                false,
              );
        }
        workspace.dispose();
        container.remove();
      });
    }

    it('presses timer buttons through a real select on the widgetControl branch', () => {
      const { workspace, container } = fixture();
      const roots = spawnAll(workspace);
      const timer = roots[WIDGET_REGISTRY.findIndex((entry) => entry.kind === 'timer')];
      if (!timer) throw new Error('timer missing');
      const label = (name: string): unknown => timer.getObjectByName(name)?.userData.labelText;
      const press = (name: string): void => {
        const button = timer.getObjectByName(name);
        if (!button) throw new Error(`${name} missing`);
        workspace.scene.updateMatrixWorld(true);
        const controller = aim(workspace, button.getWorldPosition(new THREE.Vector3()));
        controller.dispatchEvent({ type: 'selectstart' } as never);
        controller.dispatchEvent({ type: 'selectend' } as never);
      };
      expect(label('timer-run')).toBe('Start');
      press('timer-run');
      expect(label('timer-run')).toBe('Pause');
      press('timer-run');
      expect(label('timer-run')).toBe('Resume');
      press('timer-preset-15');
      expect(label('timer-run')).toBe('Start');
      expect(label('timer-display')).toBe('15:00');
      press('timer-mode');
      expect(label('timer-mode')).toBe('Stopwatch');
      workspace.dispose();
      container.remove();
    });

    it('holds bell feed rows under a real ray across row gaps, the face and a just-selected row', async () => {
      const endListeners: Array<() => void> = [];
      const session = {
        addEventListener: (_type: string, listener: () => void) => endListeners.push(listener),
        end: vi.fn(async () => {
          for (const listener of endListeners) listener();
        }),
      };
      vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
      fakeXR.presenting = true;
      const { workspace, actions, container } = fixture();
      try {
        await workspace.enterXR('vr');
        vi.mocked(actions.selectPane).mockImplementation((id: string) =>
          workspace.selectTerminal(id),
        );
        const ringing = new Map<string, () => void>();
        const ring = (id: string, title: string): void => {
          const existing = ringing.get(id);
          if (existing) {
            existing();
            return;
          }
          let bell = false;
          const listeners = new Set<() => void>();
          const terminal: TerminalSurface = {
            ...surface(pane(id, title)),
            get bellPending() {
              return bell;
            },
            acknowledgeBell: () => {
              bell = false;
              for (const listener of listeners) listener();
            },
            subscribe(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          };
          workspace.addTerminal(terminal);
          ringing.set(id, () => {
            bell = true;
            for (const listener of listeners) listener();
          });
          ringing.get(id)?.();
        };
        ring('pane-c', 'build');
        ring('pane-d', 'tests');
        workspace.setAvailablePanes([
          pane('pane-a', 'A'),
          pane('pane-b', 'B'),
          pane('pane-c', 'build'),
          pane('pane-d', 'tests'),
          pane('pane-e', 'deploy'),
        ]);
        const roots = spawnAll(workspace);
        const feed = roots[WIDGET_REGISTRY.findIndex(({ kind }) => kind === 'bell-feed')];
        if (!feed) throw new Error('bell feed missing');
        const rowLabel = (index: number): string | null => {
          const row = feed.getObjectByName(`bell-feed-row-${index}`);
          return row?.visible
            ? String(row.getObjectByName('bell-feed-row-label')?.userData.labelText)
            : null;
        };
        const rowPoint = (index: number, dy = 0): THREE.Vector3 => {
          const row = feed.getObjectByName(`bell-feed-row-${index}`);
          if (!row) throw new Error('row missing');
          feed.updateMatrixWorld(true);
          return row.localToWorld(new THREE.Vector3(0, dy, 0));
        };
        let time = 100;
        const frameAt = (target: THREE.Vector3): THREE.Group => {
          const controller = aim(workspace, target);
          time += 16;
          fakeXR.frame?.(time);
          return controller;
        };
        const away = EYE.clone().add(new THREE.Vector3(0, 3, 0.5));
        expect([rowLabel(1), rowLabel(2)]).toEqual(['tests', 'build']);
        // The ray rests in the gap between rows 1 and 2, on the face, not on a label.
        frameAt(rowPoint(1, -0.041));
        ring('pane-e', 'deploy');
        expect([rowLabel(1), rowLabel(2), rowLabel(3)]).toEqual(['tests', 'build', null]);
        expect(feed.getObjectByName('bell-feed-overflow')?.userData.labelText).toBe('+1 more');
        // Select row 1 and keep the ray there: the row clears, and nothing moves up into it.
        const controller = frameAt(rowPoint(1));
        controller.dispatchEvent({ type: 'selectstart' } as never);
        controller.dispatchEvent({ type: 'selectend' } as never);
        expect(actions.selectPane).toHaveBeenLastCalledWith('pane-d');
        frameAt(rowPoint(1));
        expect([rowLabel(1), rowLabel(2)]).toEqual([null, 'build']);
        // The HUD Widgets toggle for the feed is not part of the feed, so it does not hold rows.
        workspace.showInput('widgets');
        const toggle = objectWithData(workspace, {
          inputAction: 'toggleWidget',
          widgetKind: 'bell-feed',
        });
        frameAt(toggle.getWorldPosition(new THREE.Vector3()));
        expect([rowLabel(1), rowLabel(2)]).toEqual(['deploy', 'build']);
        workspace.hideInput();
        // Pointing again holds rows; ending XR releases the hold.
        frameAt(rowPoint(2));
        ring('pane-d', 'tests');
        expect([rowLabel(1), rowLabel(2)]).toEqual(['deploy', 'build']);
        frameAt(away);
        expect(rowLabel(1)).toBe('tests');
        frameAt(rowPoint(2));
        ring('pane-c', 'build');
        await workspace.exitXR();
        workspace.setNotice('Streamer restarted', { feed: true });
        expect(rowLabel(1)).toBe('Streamer restarted');
      } finally {
        workspace.dispose();
        container.remove();
        fakeXR.presenting = false;
        vi.unstubAllGlobals();
      }
    });

    it('keeps the performance gauge clear of the HUD at both poses and every eye height', () => {
      const { workspace, container } = fixture();
      const roots = spawnAll(workspace);
      const gauge = roots[WIDGET_REGISTRY.findIndex(({ kind }) => kind === 'perf-gauge')];
      if (!gauge) throw new Error('Performance gauge missing');
      const hud = workspace.scene.getObjectByName('xr-workspace-hud');
      if (!hud) throw new Error('HUD missing');
      for (const eyeHeight of [1.1, 1.35, 1.52, 1.8])
        for (const offsetY of [0.78 - eyeHeight, -0.65]) {
          hud.position.set(EYE.x, EYE.y + offsetY, EYE.z - 1.35);
          hud.quaternion.identity();
          workspace.scene.updateMatrixWorld(true);
          for (const child of hud.children)
            if (child.visible)
              expect(
                overlaps(gauge, child),
                `${String(child.name)} at eye ${eyeHeight}, HUD ${offsetY.toFixed(2)}`,
              ).toBe(false);
        }
      workspace.dispose();
      container.remove();
    });

    it('sends a ray through the board to the Reload button behind it', () => {
      const { workspace, actions, container } = fixture();
      spawnAll(workspace);
      const hud = workspace.scene.getObjectByName('xr-workspace-hud');
      if (!hud) throw new Error('HUD missing');
      recenterHud(hud);
      const reload = hud.children.find((child) => child.userData.inputAction === 'reloadUpdate');
      if (!reload) throw new Error('HUD Reload missing');
      reload.visible = true;
      workspace.scene.updateMatrixWorld(true);
      const target = reload.getWorldPosition(new THREE.Vector3());
      const board = workspace.scene.children.find((child) => child.name.startsWith('agent-board-'));
      if (!board) throw new Error('board missing');
      expect(firstWidgetHit([board], target)).toBeDefined();
      aim(workspace, target).dispatchEvent({ type: 'selectstart' } as never);
      expect(actions.reloadApp).toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    });

    it('selects the board row, not a hidden Exit behind it', () => {
      const { workspace, actions, container } = fixture();
      workspace.setAgentRoster(ROSTER_PANES.map(rosterRow));
      const roots = spawnAll(workspace);
      const hud = workspace.scene.getObjectByName('xr-workspace-hud');
      if (!hud) throw new Error('HUD missing');
      const exit = hud.children.find((child) => child.userData.inputAction === 'exit');
      const board = roots[2];
      if (!exit || !board) throw new Error('missing');
      // Put Exit directly behind the right end of the board's first row.
      const row = board.getObjectByName('agent-board-row-1');
      const plate = row?.getObjectByName('agent-board-row-plate');
      if (!plate) throw new Error('row missing');
      board.updateMatrixWorld(true);
      const aimPoint = plate.localToWorld(new THREE.Vector3(0.3, 0, 0));
      const behind = aimPoint.clone().sub(EYE).multiplyScalar(1.15).add(EYE);
      hud.position.add(behind.sub(exit.getWorldPosition(new THREE.Vector3())));
      workspace.scene.updateMatrixWorld(true);
      const target = exit.getWorldPosition(new THREE.Vector3());
      const widgetHit = firstWidgetHit(roots, target);
      expect(widgetHit?.object.userData.inputAction).toBe('selectAgentPane');
      aim(workspace, target).dispatchEvent({ type: 'selectstart' } as never);
      expect(exit.userData.labelText).toBe('Exit');
      expect(actions.selectPane).toHaveBeenLastCalledWith('pane-a');
      workspace.dispose();
      container.remove();
    });
  });
});
