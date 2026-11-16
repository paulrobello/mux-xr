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

import * as THREE from 'three';
import { createPictureController, type PictureLoaders } from '../../src/workspace/pictures';
import { measurePanelBounds } from '../../src/xr/panel-bounds';
import { PictureLoadError, pictureErrorNotice } from '../../src/xr/picture-sizing';
import {
  createMemoryPictureStorage,
  createMemoryRecentPictureStorage,
  createPictureLibrary,
  createRecentPictureLibrary,
} from '../../src/xr/picture-store';
import type { createWorkspaceScene } from '../../src/xr/scene';
import { WIDGET_REGISTRY } from '../../src/xr/widget-registry';
import {
  aimController,
  aimControllerAtScreen,
  connectController,
  fakeXR,
  fixture,
  hit,
  objectWithData,
  resetXRControllers,
  turnToWidget,
} from '../helpers/xr-harness';

describe('native XR controller event routing', () => {
  beforeEach(resetXRControllers);

  it('labels the Widgets panel from the registry display names', () => {
    const { workspace, container } = fixture();
    workspace.showInput('widgets');
    for (const { kind, displayName } of WIDGET_REGISTRY) {
      const control = { inputAction: 'toggleWidget', widgetKind: kind };
      turnToWidget(workspace, control);
      expect(objectWithData(workspace, control).userData.labelText).toBe(`Add ${displayName}`);
    }
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' });
    workspace.showInput('widgets');
    expect(
      objectWithData(workspace, { inputAction: 'toggleWidget', widgetKind: 'digital-clock' })
        .userData.labelText,
    ).toBe('Hide Digital clock');
    workspace.dispose();
    container.remove();
  });

  describe('picture frames', () => {
    const picture = (width: number, height: number) => ({
      source: { width, height } as HTMLCanvasElement,
      width,
      height,
    });
    const frameRoot = (workspace: ReturnType<typeof createWorkspaceScene>, id: string) =>
      workspace.scene.getObjectByName(`picture-frame-${id}`);
    const savedPoses = (): Record<string, unknown> =>
      JSON.parse(localStorage.getItem('mux-xr:widget-poses:v2') ?? '{"poses":{}}').poses;

    it('keeps several frames under per-frame pose keys and spawns them apart', () => {
      const { workspace, container } = fixture();
      workspace.addPicture('pic-a', picture(1600, 900));
      workspace.addPicture('pic-b', picture(900, 1600));
      expect(workspace.state.widgets).toEqual(['picture:pic-a', 'picture:pic-b']);
      expect(Object.keys(savedPoses()).sort()).toEqual(['picture:pic-a', 'picture:pic-b']);
      const a = frameRoot(workspace, 'pic-a')?.position;
      const b = frameRoot(workspace, 'pic-b')?.position;
      expect(a && b && a.distanceTo(b)).toBeGreaterThan(0.03);
      workspace.dispose();
      container.remove();
    });

    it('spawns a placeholder from the menu that the next picked picture fills in place', () => {
      const { workspace, container } = fixture();
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' });
      workspace.showInput('widgets');
      turnToWidget(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' });
      expect(
        objectWithData(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' }).userData
          .labelText,
      ).toBe('Add Picture');
      const [placeholderKey] = workspace.state.widgets;
      expect(placeholderKey).toMatch(/^picture:placeholder-/);
      // The placeholder persists its pose so a reload while picking on the page keeps it.
      expect(Object.keys(savedPoses())).toEqual([placeholderKey]);
      const placeholder = workspace.scene.children.find((child) =>
        child.name.startsWith('picture-frame-placeholder-'),
      );
      if (!placeholder) throw new Error('placeholder missing');
      placeholder.position.set(0.4, 1.1, -0.9);
      workspace.addPicture('pic-a', picture(800, 600));
      expect(workspace.state.widgets).toEqual(['picture:pic-a']);
      expect(frameRoot(workspace, 'pic-a')?.position.toArray()).toEqual([0.4, 1.1, -0.9]);
      workspace.dispose();
      container.remove();
    });

    it('restores stored frames at their saved pose and drops poses with no stored picture', () => {
      const first = fixture();
      first.workspace.addPicture('pic-a', picture(800, 600));
      first.workspace.addPicture('pic-gone', picture(800, 600));
      const root = frameRoot(first.workspace, 'pic-a');
      if (!root) throw new Error('frame missing');
      hit(
        first.workspace,
        { inputAction: 'grabWidget', widgetKey: 'picture:pic-a' },
        'squeezestart',
      );
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
      root.position.set(-0.5, 1.2, -1);
      root.updateMatrixWorld(true);
      // Session teardown keeps the stored pictures and their poses.
      first.workspace.captureWorkspaceState();
      first.workspace.dispose();
      first.container.remove();
      expect(Object.keys(savedPoses()).sort()).toEqual(['picture:pic-a', 'picture:pic-gone']);
      const onPictureClosed = vi.fn();
      const { workspace, container } = fixture({ onPictureClosed });
      // A picture picked before the stored list arrives keeps its pose.
      workspace.addPicture('pic-new', picture(800, 600));
      workspace.restorePictures([{ id: 'pic-a', image: picture(800, 600) }]);
      expect(workspace.state.widgets).toEqual(['picture:pic-new', 'picture:pic-a']);
      expect(Object.keys(savedPoses()).sort()).toEqual(['picture:pic-a', 'picture:pic-new']);
      const restored = frameRoot(workspace, 'pic-a')?.position;
      expect(restored?.x).toBeCloseTo(-0.5, 3);
      expect(restored?.y).toBeCloseTo(1.2, 3);
      expect(onPictureClosed).not.toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    });

    const reload = (setup: (workspace: ReturnType<typeof createWorkspaceScene>) => void) => {
      const first = fixture();
      setup(first.workspace);
      first.workspace.captureWorkspaceState();
      first.workspace.dispose();
      first.container.remove();
      return fixture();
    };

    it('spawns a pick after a reload apart from every restored frame', () => {
      const { workspace, container } = reload((before) => {
        before.addPicture('pic-a', picture(800, 600));
        before.addPicture('pic-b', picture(800, 600));
      });
      expect(savedPoses()['picture:pic-a']).toMatchObject({ slot: 0 });
      expect(savedPoses()['picture:pic-a']).not.toHaveProperty('placed');
      workspace.restorePictures([
        { id: 'pic-a', image: picture(800, 600) },
        { id: 'pic-b', image: picture(800, 600) },
      ]);
      workspace.addPicture('pic-c', picture(800, 600));
      expect(
        ['pic-a', 'pic-b', 'pic-c'].map((id) => frameRoot(workspace, id)?.userData.widgetSlot),
      ).toEqual([0, 1, 2]);
      const [a, b, c] = ['pic-a', 'pic-b', 'pic-c'].map((id) => frameRoot(workspace, id)?.position);
      if (!a || !b || !c) throw new Error('frame missing');
      expect(c.distanceTo(a)).toBeGreaterThan(0.6);
      expect(c.distanceTo(b)).toBeGreaterThan(0.6);
      workspace.dispose();
      container.remove();
    });

    it('re-slots a restored, never-moved frame on recenter and keeps a grabbed one', () => {
      const { workspace, container } = reload((before) => {
        before.addPicture('pic-a', picture(800, 600));
        before.addPicture('pic-b', picture(800, 600));
        before.addPicture('pic-c', picture(800, 600));
        hit(before, { inputAction: 'grabWidget', widgetKey: 'picture:pic-a' }, 'squeezestart');
        (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
      });
      expect(savedPoses()['picture:pic-a']).toMatchObject({ placed: true });
      expect(savedPoses()['picture:pic-a']).not.toHaveProperty('slot');
      workspace.restorePictures(
        ['pic-a', 'pic-b', 'pic-c'].map((id) => ({ id, image: picture(800, 600) })),
      );
      const a = frameRoot(workspace, 'pic-a');
      const b = frameRoot(workspace, 'pic-b');
      if (!a || !b) throw new Error('frame missing');
      expect(b.userData.widgetSlot).toBe(1);
      const aBefore = a.position.clone();
      const bBefore = b.position.clone();
      workspace.resetLayout();
      expect(a.position.toArray()).toEqual(aBefore.toArray());
      expect(b.userData.widgetSlot).toBe(0);
      expect(frameRoot(workspace, 'pic-c')?.userData.widgetSlot).toBe(1);
      expect(b.position.distanceTo(bBefore)).toBeGreaterThan(0.5);
      workspace.dispose();
      container.remove();
    });

    it('moves a filled placeholder frame into a slot when a new placeholder takes its spot', () => {
      const { workspace, container } = fixture();
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' });
      workspace.addPicture('pic-a', picture(800, 600));
      const a = frameRoot(workspace, 'pic-a');
      if (!a) throw new Error('frame missing');
      expect(a.userData.widgetSlot).toBe(-1);
      expect(savedPoses()['picture:pic-a']).toMatchObject({ slot: -1 });
      const spot = a.position.clone();
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' });
      const placeholder = workspace.scene.children.find((child) =>
        child.name.startsWith('picture-frame-placeholder-'),
      );
      expect(placeholder?.position.distanceTo(spot)).toBeLessThan(1e-6);
      expect(a.userData.widgetSlot).toBe(0);
      expect(a.position.distanceTo(spot)).toBeGreaterThan(0.2);
      workspace.dispose();
      container.remove();
    });

    it('closes a frame through its control, deleting its pose and stored picture', () => {
      const onPictureClosed = vi.fn();
      const { workspace, container } = fixture({ onPictureClosed });
      workspace.addPicture('pic-a', picture(800, 600));
      const plane = frameRoot(workspace, 'pic-a')?.getObjectByName('picture-frame-image');
      if (!(plane instanceof THREE.Mesh)) throw new Error('picture plane missing');
      const texture = (plane.material as THREE.MeshBasicMaterial).map as THREE.Texture;
      const disposeTexture = vi.spyOn(texture, 'dispose');
      hit(workspace, { inputAction: 'closeWidget', widgetKey: 'picture:pic-a' });
      expect(workspace.state.widgets).toEqual([]);
      expect(savedPoses()).toEqual({});
      expect(onPictureClosed).toHaveBeenCalledWith('pic-a');
      expect(disposeTexture).toHaveBeenCalled();
      workspace.dispose();
      container.remove();
    });

    const slotOf = (workspace: ReturnType<typeof createWorkspaceScene>, id: string) =>
      frameRoot(workspace, id)?.userData.widgetSlot;

    it('re-slots unmoved frames on recenter and leaves a grabbed frame where the user put it', () => {
      const { workspace, container } = fixture();
      workspace.addPicture('pic-a', picture(800, 600));
      workspace.addPicture('pic-b', picture(800, 600));
      workspace.addPicture('pic-c', picture(800, 600));
      expect(['pic-a', 'pic-b', 'pic-c'].map((id) => slotOf(workspace, id))).toEqual([0, 1, 2]);
      hit(workspace, { inputAction: 'grabWidget', widgetKey: 'picture:pic-a' }, 'squeezestart');
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
      const placed = frameRoot(workspace, 'pic-a');
      if (!placed) throw new Error('frame missing');
      placed.position.set(0.3, 1.9, -0.7);
      workspace.resetLayout();
      expect(placed.position.toArray()).toEqual([0.3, 1.9, -0.7]);
      expect(slotOf(workspace, 'pic-a')).toBeUndefined();
      // The freed slot 0 goes to the first unmoved frame, so recentered frames close up.
      expect(slotOf(workspace, 'pic-b')).toBe(0);
      expect(slotOf(workspace, 'pic-c')).toBe(1);
      const b = frameRoot(workspace, 'pic-b')?.position;
      const c = frameRoot(workspace, 'pic-c')?.position;
      expect(b && c && b.distanceTo(c)).toBeGreaterThan(0.6);
      workspace.dispose();
      container.remove();
    });

    it('fills a placeholder without taking a slot and keeps one placeholder at a time', () => {
      const { workspace, container } = fixture();
      for (const _ of [1, 2]) {
        workspace.showInput('widgets');
        hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' });
      }
      expect(workspace.state.widgets).toHaveLength(1);
      workspace.addPicture('pic-a', picture(800, 600));
      expect(slotOf(workspace, 'pic-a')).toBe(-1);
      workspace.addPicture('pic-b', picture(800, 600));
      expect(slotOf(workspace, 'pic-b')).toBe(0);
      workspace.dispose();
      container.remove();
    });

    it('caps scene frames at eight even with no stored copies, removing the oldest', () => {
      const onPictureClosed = vi.fn();
      const { workspace, container } = fixture({ onPictureClosed });
      const evicted: string[][] = [];
      for (let index = 0; index < 10; index += 1)
        evicted.push(workspace.addPicture(`pic-${index}`, picture(800, 600)));
      expect(workspace.state.widgets).toEqual(
        Array.from({ length: 8 }, (_, index) => `picture:pic-${index + 2}`),
      );
      expect(evicted.flat()).toEqual(['pic-0', 'pic-1']);
      expect(onPictureClosed.mock.calls.map(([id]) => id)).toEqual(['pic-0', 'pic-1']);
      const positions = workspace.state.widgets.map((key) =>
        frameRoot(workspace, key.slice('picture:'.length))?.position.toArray().join(),
      );
      expect(new Set(positions).size).toBe(8);
      workspace.dispose();
      container.remove();
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
    const openPlaceholder = (workspace: ReturnType<typeof createWorkspaceScene>) => {
      workspace.showInput('widgets');
      hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' });
      const placeholder = workspace.scene.children.find((child) =>
        child.name.startsWith('picture-frame-placeholder-'),
      );
      if (!placeholder) throw new Error('placeholder missing');
      return placeholder;
    };

    it('keeps the placeholder through XR exit, a page pick and re-entry', async () => {
      const { workspace, container } = fixture();
      let session = xrSession();
      await workspace.enterXR('vr');
      fakeXR.frame?.(30);
      const placeholder = openPlaceholder(workspace);
      placeholder.position.set(0.3, 1.2, -0.95);
      const key = String(placeholder.userData.widgetKey);
      await session.end();
      fakeXR.frame?.(60);
      expect(workspace.state.widgets).toEqual([key]);
      workspace.addPicture('pic-a', picture(800, 600));
      session = xrSession();
      await workspace.enterXR('vr');
      fakeXR.frame?.(90);
      expect(workspace.state.widgets).toEqual(['picture:pic-a']);
      const frame = frameRoot(workspace, 'pic-a');
      expect(frame?.getObjectByName('picture-frame-image')).toBeTruthy();
      expect(frame?.position.toArray()).toEqual([0.3, 1.2, -0.95]);
      expect(Object.keys(savedPoses())).toEqual(['picture:pic-a']);
      await session.end();
      workspace.dispose();
      container.remove();
    });

    it('keeps a grabbed placeholder where it was put through a reload, a fill and a new placeholder', async () => {
      const first = fixture();
      const placeholder = openPlaceholder(first.workspace);
      const key = String(placeholder.userData.widgetKey);
      hit(first.workspace, { inputAction: 'grabWidget', widgetKey: key }, 'squeezestart');
      (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
      placeholder.position.set(-1.6, 1.4, -0.4);
      placeholder.updateMatrixWorld(true);
      first.workspace.captureWorkspaceState();
      expect(savedPoses()[key]).toMatchObject({ placed: true });
      first.workspace.dispose();
      first.container.remove();
      const { workspace, container } = fixture();
      workspace.restorePictures([]);
      fakeXR.frame?.(10);
      workspace.addPicture('pic-a', picture(800, 600));
      // N8: filling the placeholder drops its saved pose.
      expect(Object.keys(savedPoses())).toEqual(['picture:pic-a']);
      expect(savedPoses()['picture:pic-a']).toMatchObject({ placed: true });
      const spot = frameRoot(workspace, 'pic-a')?.position.clone();
      expect(spot?.distanceTo(new THREE.Vector3(-1.6, 1.4, -0.4))).toBeLessThan(1e-3);
      openPlaceholder(workspace);
      expect(frameRoot(workspace, 'pic-a')?.position.distanceTo(spot as THREE.Vector3)).toBe(0);
      workspace.dispose();
      container.remove();
    });

    it('restores an open placeholder after a reload so a page pick still fills it', async () => {
      const first = fixture();
      let session = xrSession();
      await first.workspace.enterXR('vr');
      fakeXR.frame?.(30);
      const placeholder = openPlaceholder(first.workspace);
      const key = String(placeholder.userData.widgetKey);
      expect(Object.keys(savedPoses())).toEqual([key]);
      const spot = placeholder.position.clone();
      await session.end();
      // The update auto-reload on returning to the page tears the scene down.
      first.workspace.dispose();
      first.container.remove();
      const { workspace, container } = fixture();
      workspace.restorePictures([]);
      fakeXR.frame?.(10);
      expect(workspace.state.widgets).toEqual([key]);
      expect(Object.keys(savedPoses())).toEqual([key]);
      workspace.addPicture('pic-a', picture(800, 600));
      session = xrSession();
      await workspace.enterXR('vr');
      fakeXR.frame?.(40);
      expect(workspace.state.widgets).toEqual(['picture:pic-a']);
      expect(frameRoot(workspace, 'pic-a')?.position.distanceTo(spot)).toBeLessThan(1e-3);
      await session.end();
      workspace.dispose();
      container.remove();
    });

    describe('in-XR picking', () => {
      const thumbnails: Array<{ width: number; height: number }> = [];
      const pickerFixture = (loaders: Partial<PictureLoaders> = {}, withRecent = true) => {
        let scene: ReturnType<typeof createWorkspaceScene> | null = null;
        const recentStorage = createMemoryRecentPictureStorage();
        let id = 0;
        let clock = 0;
        const controller = createPictureController({
          library: createPictureLibrary(createMemoryPictureStorage()),
          ...(withRecent ? { recent: createRecentPictureLibrary(recentStorage) } : {}),
          scene: () => scene,
          notify: (message) => scene?.notifyPicture(message),
          createId: () => `pic-${++id}`,
          now: () => ++clock,
          loaders: {
            url: async (url) => ({ ...picture(800, 600), name: url, blob: new Blob(['u']) }),
            file: async (file) => ({
              ...picture(800, 600),
              name: file.name,
              blob: new Blob(['f']),
            }),
            stored: async (_blob, name) => {
              const image = picture(256, 192);
              thumbnails.push(image.source);
              return { ...image, name, blob: new Blob(['s']) };
            },
            thumbnail: async () => new Blob(['t'], { type: 'image/webp' }),
            ...loaders,
          },
        });
        const created = fixture({ pictures: controller, onPictureClosed: controller.closed });
        scene = created.workspace;
        return { ...created, controller, recentStorage };
      };
      const label = (workspace: ReturnType<typeof createWorkspaceScene>, name: string) =>
        String(workspace.scene.getObjectByName(name)?.userData.labelText ?? '');
      const panel = (workspace: ReturnType<typeof createWorkspaceScene>, mode: string) =>
        workspace.scene.getObjectByName(`xr-${mode}-controls`);
      const placeholderOf = (workspace: ReturnType<typeof createWorkspaceScene>) => {
        workspace.showInput('widgets');
        hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'picture' });
        const placeholder = workspace.scene.children.find((child) =>
          child.name.startsWith('picture-frame-placeholder-'),
        );
        if (!placeholder) throw new Error('placeholder missing');
        return placeholder;
      };

      it('offers Enter URL and Recent on the placeholder, sized for a pinch', () => {
        const { workspace, container } = pickerFixture();
        const placeholder = placeholderOf(workspace);
        workspace.scene.updateMatrixWorld(true);
        for (const name of ['picture-url-choice', 'picture-recent-choice', 'picture-close']) {
          const control = placeholder.getObjectByName(name);
          if (!(control instanceof THREE.Mesh)) throw new Error(`${name} missing`);
          // Measured in the frame's own plane: a world AABB shrinks with the frame's yaw.
          control.geometry.computeBoundingBox();
          const size = (control.geometry.boundingBox as THREE.Box3)
            .getSize(new THREE.Vector3())
            .multiply(control.getWorldScale(new THREE.Vector3()));
          expect(Math.min(size.x, size.y)).toBeGreaterThanOrEqual(0.045);
        }
        expect(label(workspace, 'picture-frame-placeholder')).toBe('Add a picture');
        workspace.dispose();
        container.remove();
      });

      it('types and pastes a URL with the keyboard and loads it into the placeholder', async () => {
        const { workspace, actions, container } = pickerFixture();
        const placeholder = placeholderOf(workspace);
        placeholder.position.set(0.2, 1.1, -0.9);
        const key = String(placeholder.userData.widgetKey);
        hit(workspace, { inputAction: 'pictureUrl', widgetKey: key });
        expect(panel(workspace, 'picture-url')).toBeTruthy();
        expect(objectWithData(workspace, { inputAction: 'key', key: 'a' })).toBeTruthy();
        actions.readHostClipboard = vi.fn(async () => ({
          ok: true as const,
          value: ' https://img.example.com/cat.pn\n',
        }));
        hit(workspace, { inputAction: 'pasteHostClipboard' });
        await vi.waitFor(() =>
          expect(label(workspace, 'xr-picture-url-field')).toBe(
            'URL: https://img.example.com/cat.pn|',
          ),
        );
        hit(workspace, { inputAction: 'key', key: 'g' });
        expect(label(workspace, 'xr-picture-url-field')).toBe(
          'URL: https://img.example.com/cat.png|',
        );
        hit(workspace, { inputAction: 'pictureUrlLoad' });
        await vi.waitFor(() => expect(workspace.state.widgets).toEqual(['picture:pic-1']));
        expect(frameRoot(workspace, 'pic-1')?.position.toArray()).toEqual([0.2, 1.1, -0.9]);
        expect(panel(workspace, 'picture-url')).toBeUndefined();
        workspace.dispose();
        container.remove();
      });

      it('shows the page picker failure notice and keeps the URL for a retry', async () => {
        const { workspace, actions, container } = pickerFixture({
          url: async (url) => {
            throw new PictureLoadError('cors', new URL(url).host);
          },
        });
        const placeholder = placeholderOf(workspace);
        hit(workspace, {
          inputAction: 'pictureUrl',
          widgetKey: String(placeholder.userData.widgetKey),
        });
        hit(workspace, { inputAction: 'pictureUrlLoad' });
        expect(label(workspace, 'xr-picture-message')).toBe('Type or paste an image URL');
        actions.readHostClipboard = vi.fn(async () => ({
          ok: true as const,
          value: 'https://img.example.com/cat.png',
        }));
        hit(workspace, { inputAction: 'pasteHostClipboard' });
        await vi.waitFor(() =>
          expect(label(workspace, 'xr-picture-url-field')).toContain('cat.png'),
        );
        hit(workspace, { inputAction: 'key', key: 'Enter' });
        // The reason shows once, in the panel, never in the HUD notice that would cover it.
        await vi.waitFor(() =>
          expect(label(workspace, 'xr-picture-message')).toBe(
            pictureErrorNotice('cors', 'https://img.example.com/cat.png'),
          ),
        );
        expect(workspace.state.notice).toBeNull();
        expect(workspace.state.widgets).toEqual([String(placeholder.userData.widgetKey)]);
        expect(label(workspace, 'xr-picture-url-field')).toContain('cat.png');
        // The URL panel's actions share one row above the field, clear of the HUD bar below.
        const panelRoot = panel(workspace, 'picture-url');
        for (const action of ['pictureUrlClear', 'pictureRecent', 'close'])
          expect(
            panelRoot?.children.find((child) => child.userData.inputAction === action)?.position.y,
          ).toBeCloseTo(1.04);
        workspace.dispose();
        container.remove();
      });

      it('pages, removes from, and places from Recent through Change on a filled frame', async () => {
        const { workspace, controller, recentStorage, container } = pickerFixture();
        for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
          await controller.addFile(new File(['x'], `${name}.png`));
        const target = frameRoot(workspace, 'pic-7');
        if (!target) throw new Error('frame missing');
        target.position.set(-0.3, 1.25, -1);
        hit(workspace, { inputAction: 'pictureChange', widgetKey: 'picture:pic-7' });
        expect(target.getObjectByName('picture-change-choices')?.visible).toBe(true);
        hit(workspace, { inputAction: 'pictureRecent', widgetKey: 'picture:pic-7' });
        expect(label(workspace, 'xr-recent-status')).toBe('Loading…');
        const tiles = () => {
          const found: THREE.Object3D[] = [];
          panel(workspace, 'picture-gallery')?.traverse((object) => {
            if (object.name === 'xr-recent-thumbnail') found.push(object);
          });
          return found;
        };
        await vi.waitFor(() => expect(tiles()).toHaveLength(6));
        expect(tiles()[0].userData.helpText).toBe('Put g.png in the frame');
        hit(workspace, { inputAction: 'pictureRecentPage', delta: 1 });
        expect(tiles().map((tile) => tile.userData.helpText)).toEqual(['Put a.png in the frame']);
        const oldest = String(tiles()[0].userData.recentId);
        hit(workspace, { inputAction: 'pictureRecentRemove', recentId: oldest });
        await vi.waitFor(() => expect(tiles()).toHaveLength(6));
        expect(recentStorage.records.has(oldest)).toBe(false);
        expect(workspace.state.toast).toBe('Removed from Recent.');
        // Each remove control covers under a third of its thumbnail's width.
        for (const tile of tiles()) {
          const remove = objectWithData(workspace, {
            inputAction: 'pictureRecentRemove',
            recentId: tile.userData.recentId,
          }) as THREE.Mesh;
          const tileWidth = ((tile as THREE.Mesh).geometry as THREE.PlaneGeometry).parameters.width;
          const removeWidth = (remove.geometry as THREE.PlaneGeometry).parameters.width;
          expect(removeWidth).toBeGreaterThanOrEqual(0.118);
          const covered = tile.position.x + tileWidth / 2 - (remove.position.x - removeWidth / 2);
          expect(covered / tileWidth).toBeLessThanOrEqual(0.3);
        }
        const before = thumbnails.length;
        const bId = String(
          tiles().find((tile) => tile.userData.helpText === 'Put b.png in the frame')?.userData
            .recentId,
        );
        hit(workspace, { inputAction: 'pictureRecentPlace', recentId: bId });
        await vi.waitFor(() => expect(workspace.state.widgets).toContain('picture:pic-8'));
        expect(workspace.state.widgets).not.toContain('picture:pic-7');
        expect(frameRoot(workspace, 'pic-8')?.position.toArray()).toEqual([-0.3, 1.25, -1]);
        expect(panel(workspace, 'picture-gallery')).toBeUndefined();
        // Closing the gallery released every decoded thumbnail.
        expect(thumbnails.slice(0, before).every(({ width }) => width === 0)).toBe(true);
        expect(recentStorage.records.size).toBe(6);
        workspace.dispose();
        container.remove();
      });

      it('keeps the toast away and says so when Recent refuses a delete', async () => {
        const { workspace, controller, recentStorage, container } = pickerFixture();
        await controller.addFile(new File(['x'], 'a.png'));
        recentStorage.delete = async () => {
          throw new Error('quota');
        };
        hit(workspace, { inputAction: 'pictureChange', widgetKey: 'picture:pic-1' });
        hit(workspace, { inputAction: 'pictureRecent', widgetKey: 'picture:pic-1' });
        await vi.waitFor(() =>
          expect(objectWithData(workspace, { inputAction: 'pictureRecentRemove' })).toBeTruthy(),
        );
        const id = String(
          objectWithData(workspace, { inputAction: 'pictureRecentRemove' }).userData.recentId,
        );
        hit(workspace, { inputAction: 'pictureRecentRemove', recentId: id });
        await vi.waitFor(() =>
          expect(label(workspace, 'xr-picture-message')).toBe(
            'Could not remove that picture from Recent',
          ),
        );
        expect(workspace.state.toast).not.toBe('Removed from Recent.');
        workspace.dispose();
        container.remove();
      });

      it('ignores a second pick while one loads and keeps a newer target', async () => {
        let started = 0;
        let finish = (_value: {
          source: HTMLCanvasElement;
          width: number;
          height: number;
          blob: Blob;
        }) => {};
        const { workspace, actions, controller, container } = pickerFixture({
          url: (url) =>
            new Promise((resolve) => {
              started++;
              finish = (value) => resolve({ ...value, name: url });
            }),
        });
        await controller.addFile(new File(['x'], 'a.png'));
        const placeholder = placeholderOf(workspace);
        hit(workspace, {
          inputAction: 'pictureUrl',
          widgetKey: String(placeholder.userData.widgetKey),
        });
        actions.readHostClipboard = vi.fn(async () => ({
          ok: true as const,
          value: 'https://img.example.com/b.png',
        }));
        hit(workspace, { inputAction: 'pasteHostClipboard' });
        await vi.waitFor(() => expect(label(workspace, 'xr-picture-url-field')).toContain('b.png'));
        hit(workspace, { inputAction: 'key', key: 'Enter' });
        expect(label(workspace, 'xr-picture-message')).toBe('Loading picture…');
        hit(workspace, { inputAction: 'key', key: 'Enter' });
        expect(label(workspace, 'xr-picture-message')).toBe(
          'Loading… the current picture is still loading',
        );
        // Retarget while the first load runs: Change on pic-1 opens a panel for that frame.
        hit(workspace, { inputAction: 'pictureChange', widgetKey: 'picture:pic-1' });
        hit(workspace, { inputAction: 'pictureUrl', widgetKey: 'picture:pic-1' });
        await vi.waitFor(() => expect(started).toBe(1));
        finish({ ...picture(800, 600), blob: new Blob(['u']) });
        await vi.waitFor(() => expect(workspace.state.widgets).toContain('picture:pic-2'));
        // The newer panel stays open and still targets pic-1.
        expect(panel(workspace, 'picture-url')).toBeTruthy();
        actions.readHostClipboard = vi.fn(async () => ({
          ok: true as const,
          value: 'https://img.example.com/c.png',
        }));
        hit(workspace, { inputAction: 'pasteHostClipboard' });
        await vi.waitFor(() => expect(label(workspace, 'xr-picture-url-field')).toContain('c.png'));
        const spot = frameRoot(workspace, 'pic-1')?.position.clone();
        hit(workspace, { inputAction: 'pictureUrlLoad' });
        await vi.waitFor(() => expect(started).toBe(2));
        finish({ ...picture(800, 600), blob: new Blob(['u']) });
        await vi.waitFor(() => expect(workspace.state.widgets).toContain('picture:pic-3'));
        expect(workspace.state.widgets).not.toContain('picture:pic-1');
        expect(frameRoot(workspace, 'pic-3')?.position.distanceTo(spot as THREE.Vector3)).toBe(0);
        workspace.dispose();
        container.remove();
      });

      it('pastes an explicit terminal paste into the terminal while the URL field is open', async () => {
        const { workspace, actions, left, container } = pickerFixture();
        workspace.selectTerminal('pane-a');
        const placeholder = placeholderOf(workspace);
        hit(workspace, {
          inputAction: 'pictureUrl',
          widgetKey: String(placeholder.userData.widgetKey),
        });
        actions.readHostClipboard = vi.fn(async () => ({ ok: true as const, value: 'ls' }));
        const paste = vi.spyOn(left, 'paste');
        expect(await workspace.pasteHostClipboard('pane-a')).toBe(true);
        expect(paste).toHaveBeenCalledWith('ls');
        expect(label(workspace, 'xr-picture-url-field')).toBe('URL: |');
        workspace.dispose();
        container.remove();
      });

      it('takes physical keys in the URL field and blocks them from the shell', async () => {
        const { workspace, container } = pickerFixture();
        expect(workspace.isTextEntryActive()).toBe(false);
        expect(workspace.typeTextEntryKey('a')).toBe(false);
        const placeholder = placeholderOf(workspace);
        hit(workspace, {
          inputAction: 'pictureUrl',
          widgetKey: String(placeholder.userData.widgetKey),
        });
        expect(workspace.isTextEntryActive()).toBe(true);
        for (const key of 'https://x/a.pnq') expect(workspace.typeTextEntryKey(key)).toBe(true);
        expect(workspace.typeTextEntryKey('Backspace')).toBe(true);
        expect(workspace.typeTextEntryKey('g')).toBe(true);
        expect(workspace.typeTextEntryKey('F5')).toBe(false);
        expect(label(workspace, 'xr-picture-url-field')).toBe('URL: https://x/a.png|');
        expect(workspace.typeTextEntryKey('Enter')).toBe(true);
        await vi.waitFor(() => expect(workspace.state.widgets).toEqual(['picture:pic-1']));
        expect(workspace.isTextEntryActive()).toBe(false);
        workspace.dispose();
        container.remove();
      }, 20000);

      it('lists Recent after a reload, closes cleanly, and explains missing storage', async () => {
        const first = pickerFixture();
        await first.controller.addFile(new File(['x'], 'a.png'));
        const shared = first.recentStorage;
        first.workspace.dispose();
        first.container.remove();
        let scene: ReturnType<typeof createWorkspaceScene> | null = null;
        const controller = createPictureController({
          library: createPictureLibrary(createMemoryPictureStorage()),
          recent: createRecentPictureLibrary(shared),
          scene: () => scene,
          notify: () => {},
          loaders: {
            stored: async (_blob, name) => ({ ...picture(256, 192), name, blob: new Blob(['s']) }),
          },
        });
        const reloaded = fixture({ pictures: controller });
        scene = reloaded.workspace;
        const placeholder = placeholderOf(reloaded.workspace);
        hit(reloaded.workspace, {
          inputAction: 'pictureRecent',
          widgetKey: String(placeholder.userData.widgetKey),
        });
        await vi.waitFor(() =>
          expect(
            objectWithData(reloaded.workspace, { inputAction: 'pictureRecentPlace' }).userData
              .helpText,
          ).toBe('Put a.png in the frame'),
        );
        hit(reloaded.workspace, { inputAction: 'close' });
        expect(panel(reloaded.workspace, 'picture-gallery')).toBeUndefined();
        reloaded.workspace.dispose();
        reloaded.container.remove();

        const { workspace, container } = pickerFixture({}, false);
        const empty = placeholderOf(workspace);
        hit(workspace, {
          inputAction: 'pictureRecent',
          widgetKey: String(empty.userData.widgetKey),
        });
        await vi.waitFor(() =>
          expect(label(workspace, 'xr-recent-status')).toBe('Recent pictures need browser storage'),
        );
        hit(workspace, { inputAction: 'pictureUrl' });
        expect(panel(workspace, 'picture-url')).toBeTruthy();
        workspace.dispose();
        container.remove();
      });
    });

    it('re-applies texture anisotropy to pictures when filtering changes', () => {
      const { workspace, container } = fixture();
      workspace.scene.userData.maxAnisotropy = 16;
      workspace.addPicture('pic-a', picture(800, 600));
      const plane = frameRoot(workspace, 'pic-a')?.getObjectByName('picture-frame-image');
      if (!(plane instanceof THREE.Mesh)) throw new Error('picture plane missing');
      const texture = (plane.material as THREE.MeshBasicMaterial).map as THREE.Texture;
      workspace.setTerminalFiltering({ ...workspace.state.filtering, anisotropy: 2 });
      expect(texture.anisotropy).toBe(2);
      workspace.setTerminalFiltering({ ...workspace.state.filtering, anisotropy: 8 });
      expect(texture.anisotropy).toBe(8);
      workspace.dispose();
      container.remove();
    });
  });

  it('ignores a toggle hit whose widgetKind is not registered', () => {
    const { workspace, container } = fixture();
    workspace.showInput('widgets');
    const button = objectWithData(workspace, {
      inputAction: 'toggleWidget',
      widgetKind: 'digital-clock',
    });
    button.userData.widgetKind = 'unregistered-widget';
    (button.userData.action as { widgetKind?: string }).widgetKind = 'unregistered-widget';
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'unregistered-widget' });
    expect(workspace.state.widgets).toEqual([]);
    workspace.dispose();
    container.remove();
  });

  it('pair-scales a clock, recovers it and disposes it without terminal traffic', () => {
    const { workspace, actions, left, container } = fixture();
    workspace.showInput('widgets');
    hit(workspace, { inputAction: 'toggleWidget', widgetKind: 'analog-clock' });
    const face = objectWithData(workspace, {
      widgetKind: 'analog-clock',
      inputAction: 'grabWidget',
    });
    const close = objectWithData(workspace, {
      widgetKind: 'analog-clock',
      inputAction: 'closeWidget',
    });
    let root = face;
    while (root.parent && !root.userData.scaleLimits) root = root.parent;
    connectController(0);
    connectController(1);
    aimController(fakeXR.controllers[0] as THREE.Group, face);
    aimController(fakeXR.controllers[1] as THREE.Group, close);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    (fakeXR.controllers[1] as THREE.Group).dispatchEvent({ type: 'squeezestart' } as never);
    const scale = root.scale.x;
    (fakeXR.controllers[0] as THREE.Group).position.x -= 0.1;
    (fakeXR.controllers[1] as THREE.Group).position.x += 0.1;
    fakeXR.frame?.(16);
    expect(root.scale.x).toBeGreaterThan(scale);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    (fakeXR.controllers[1] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    workspace.resetLayout();
    expect(root.scale.x).toBe(1);
    expect(actions.sendKey).not.toHaveBeenCalled();
    expect(left.resizeGrid).not.toHaveBeenCalled();
    workspace.dispose();
    expect(root.children).toHaveLength(0);
    container.remove();
  });

  it('saves final UI grip poses and saves again when XR ends after presentation stops', async () => {
    const listeners: Array<() => void> = [];
    const session = {
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      end: async () => {
        fakeXR.presenting = false;
        listeners.forEach((listener) => {
          listener();
        });
      },
    };
    vi.stubGlobal('navigator', { xr: { requestSession: async () => session } });
    const { workspace, container } = fixture();
    await workspace.enterXR('vr');
    fakeXR.frame?.(0);
    workspace.showInput('keyboard');
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    (fakeXR.controllers[0] as THREE.Group).position.x += 0.2;
    fakeXR.frame?.(16);
    (fakeXR.controllers[0] as THREE.Group).dispatchEvent({ type: 'squeezeend' } as never);
    const saved = JSON.parse(localStorage.getItem('mux-xr:ui-poses:v2') ?? '{}');
    expect(saved.poses.keyboard.position).toHaveLength(3);
    const hud = workspace.scene.getObjectByName('xr-workspace-hud');
    if (!hud) throw new Error('HUD missing');
    hud.position.x = 0.37;
    hud.scale.setScalar(0.7);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    hit(workspace, { inputAction: 'exit' });
    clock.mockReturnValue(now + 400);
    hit(workspace, { inputAction: 'exit' });
    clock.mockRestore();
    await Promise.resolve();
    const ended = JSON.parse(localStorage.getItem('mux-xr:ui-poses:v2') ?? '{}');
    expect(ended.poses.hud.scale).toBeCloseTo(0.7);
    expect(ended.poses.keyboard).toBeDefined();
    workspace.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('opens native Widgets and Filtering in desktop preview without a keyboard drawer', () => {
    const { workspace, actions, container } = fixture();
    fakeXR.presenting = false;
    workspace.showInput('widgets');
    expect(workspace.scene.getObjectByName('xr-widgets-controls')).toBeDefined();
    workspace.showInput('filtering');
    expect(workspace.scene.getObjectByName('xr-filtering-controls')).toBeDefined();
    expect(actions.openKeyboard).not.toHaveBeenCalled();
    workspace.dispose();
    container.remove();
  });

  it('reverses normal-grip yaw while retaining local pitch behavior', () => {
    const { workspace, container } = fixture();
    workspace.showInput('keyboard');
    const keyboard = workspace.scene.getObjectByName('xr-keyboard-controls');
    if (!keyboard) throw new Error('Keyboard missing');
    connectController(0, [0, 0, 1, 0]);
    hit(workspace, { inputAction: 'key', key: 'a' }, 'squeezestart');
    const before = keyboard.quaternion.clone();
    fakeXR.frame?.(0);
    const expected = before.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9 / 60),
    );
    expect(keyboard.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    workspace.dispose();
    container.remove();
  });

  describe('edge scroll strip', () => {
    const stripOf = (
      workspace: ReturnType<typeof createWorkspaceScene>,
      id: string,
    ): THREE.Mesh => {
      const strip = workspace.scene
        .getObjectByName(`terminal-panel-${id}`)
        ?.getObjectByName('terminal-scroll-strip');
      if (!(strip instanceof THREE.Mesh)) throw new Error('strip missing');
      return strip;
    };
    const lineHeight = (workspace: ReturnType<typeof createWorkspaceScene>, id: string): number => {
      const screen = workspace.scene
        .getObjectByName(`terminal-panel-${id}`)
        ?.getObjectByName('terminal-surface') as THREE.Mesh<THREE.PlaneGeometry>;
      screen.geometry.computeBoundingBox();
      const box = screen.geometry.boundingBox as THREE.Box3;
      return (box.max.y - box.min.y) / 24;
    };
    const scrolled = (actions: { scrollTerminal?: unknown }): number[] =>
      (actions.scrollTerminal as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[1] as number,
      );

    it('drags whole lines touch-style without selecting text, grabbing or moving the pane', () => {
      const { workspace, actions, container, right } = fixture();
      actions.scrollTerminal = vi.fn(() => true);
      actions.sendMouse = vi.fn(() => false);
      right.beginSelection = vi.fn(() => true);
      workspace.selectTerminal('pane-a');
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const strip = stripOf(workspace, 'pane-b');
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-b') as THREE.Group;
      const position = panel.position.clone();
      const line = lineHeight(workspace, 'pane-b');
      const aim = (y: number, time: number): void => {
        aimControllerAtScreen(controller, strip, new THREE.Vector3(0, y, 0));
        fakeXR.frame?.(time);
      };
      aim(0, 10);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      expect(workspace.state.selectedTerminalId).toBe('pane-b');
      aim(-line * 0.3, 20);
      aim(-line * 0.6, 30);
      expect(actions.scrollTerminal).not.toHaveBeenCalled();
      aim(-line * 3.7, 40);
      expect(scrolled(actions)).toEqual([-3]);
      for (let step = 1; step <= 6; step += 1) aim(-line * 3.7 + line * 0.4 * step, 40 + step * 10);
      expect(scrolled(actions).slice(1)).toEqual([1, 1]);
      expect(actions.scrollTerminal).toHaveBeenCalledWith('pane-b', 1);
      expect(right.beginSelection).not.toHaveBeenCalled();
      expect(actions.sendMouse).not.toHaveBeenCalled();
      expect(panel.position.distanceTo(position)).toBeLessThan(1e-9);
      controller.dispatchEvent({ type: 'select' } as never);
      controller.dispatchEvent({ type: 'selectend' } as never);
      aim(line * 10, 200);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(3);
      workspace.dispose();
      container.remove();
    });

    it('scrolls along a rolled pane and stops when a grip takes over', () => {
      const { workspace, actions, container } = fixture();
      actions.scrollTerminal = vi.fn(() => true);
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      panel.rotateZ(Math.PI / 2);
      const strip = stripOf(workspace, 'pane-a');
      const line = lineHeight(workspace, 'pane-a');
      aimControllerAtScreen(controller, strip, new THREE.Vector3(0, 0, 0));
      fakeXR.frame?.(10);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(panel.quaternion);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(panel.quaternion);
      const start = controller.position.clone();
      controller.position.copy(start).addScaledVector(side, line * 4);
      fakeXR.frame?.(20);
      expect(actions.scrollTerminal).not.toHaveBeenCalled();
      controller.position.copy(start).addScaledVector(up, -line * 0.6);
      fakeXR.frame?.(30);
      controller.position.copy(start).addScaledVector(up, -line * 2.7);
      fakeXR.frame?.(40);
      expect(scrolled(actions)).toEqual([-2]);
      controller.dispatchEvent({ type: 'squeezestart' } as never);
      fakeXR.frame?.(50);
      controller.position.copy(start).addScaledVector(up, -line * 8);
      fakeXR.frame?.(60);
      controller.dispatchEvent({ type: 'squeezeend' } as never);
      controller.position.copy(start).addScaledVector(up, line * 8);
      fakeXR.frame?.(70);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
      workspace.dispose();
      container.remove();
    });

    it('keeps both strips out of the pane footprint', () => {
      const { workspace, container } = fixture();
      workspace.setWindowPreferences({
        ...workspace.state.windowPreferences,
        scrollStripSide: 'both',
      });
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const before = measurePanelBounds(panel).size.width;
      stripOf(workspace, 'pane-a').removeFromParent();
      panel.getObjectByName('terminal-scroll-strip-left')?.removeFromParent();
      expect(measurePanelBounds(panel).size.width).toBeCloseTo(before, 6);
      workspace.dispose();
      container.remove();
    });

    it('places strips on the chosen side and scrolls from the left strip', () => {
      const { workspace, actions, container } = fixture();
      actions.scrollTerminal = vi.fn(() => true);
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const right = stripOf(workspace, 'pane-a');
      const left = panel.getObjectByName('terminal-scroll-strip-left');
      if (!(left instanceof THREE.Mesh)) throw new Error('left strip missing');
      expect([right.visible, left.visible]).toEqual([true, false]);
      expect(left.position.x).toBeCloseTo(-right.position.x, 6);
      expect(left.userData).toMatchObject({ inputAction: 'scrollStrip', excludeFromBounds: true });
      const choose = (side: 'right' | 'left' | 'both'): void =>
        workspace.setWindowPreferences({
          ...workspace.state.windowPreferences,
          scrollStripSide: side,
        });
      choose('both');
      expect([right.visible, left.visible]).toEqual([true, true]);
      choose('left');
      expect([right.visible, left.visible]).toEqual([false, true]);
      const controller = fakeXR.controllers[0] as THREE.Group;
      connectController(0);
      const line = lineHeight(workspace, 'pane-a');
      const aim = (y: number, time: number): void => {
        aimControllerAtScreen(controller, left, new THREE.Vector3(0, y, 0));
        fakeXR.frame?.(time);
      };
      aim(0, 10);
      controller.dispatchEvent({ type: 'selectstart' } as never);
      aim(-line * 0.6, 20);
      aim(-line * 2.7, 30);
      expect(scrolled(actions)).toEqual([-2]);
      choose('right');
      aim(-line * 6, 40);
      expect(actions.scrollTerminal).toHaveBeenCalledTimes(1);
      workspace.dispose();
      container.remove();
    });

    it('cycles the strip side from the XR Display settings', () => {
      const { workspace, container } = fixture();
      workspace.showInput('display');
      hit(workspace, { inputAction: 'scrollStripSide', scrollStripSide: 'left' });
      expect(workspace.state.windowPreferences.scrollStripSide).toBe('left');
      hit(workspace, { inputAction: 'scrollStripSide', scrollStripSide: 'both' });
      expect(workspace.state.windowPreferences.scrollStripSide).toBe('both');
      hit(workspace, { inputAction: 'scrollStripSide', scrollStripSide: 'right' });
      expect(workspace.state.windowPreferences.scrollStripSide).toBe('right');
      workspace.dispose();
      container.remove();
    });

    it('starts without the frame chin and toggles it from XR Display settings, rebuilding open frames', () => {
      const { workspace, container } = fixture();
      const panel = workspace.scene.getObjectByName('terminal-panel-pane-a') as THREE.Group;
      const bottoms = (): number[] =>
        ['terminal-frame', 'terminal-frame-accent'].map((name) => {
          const mesh = panel.getObjectByName(name) as THREE.Mesh;
          mesh.geometry.computeBoundingBox();
          return mesh.geometry.boundingBox?.min.y ?? Number.NaN;
        });
      expect(workspace.state.windowPreferences.frameChin).toBe(false);
      const [bareFrame, bareAccent] = bottoms() as [number, number];
      workspace.showInput('display');
      hit(workspace, { inputAction: 'frameChin' });
      expect(workspace.state.windowPreferences.frameChin).toBe(true);
      const [chinFrame, chinAccent] = bottoms() as [number, number];
      expect(bareFrame - chinFrame).toBeCloseTo(0.05);
      expect(bareAccent).toBeGreaterThan(chinAccent);
      hit(workspace, { inputAction: 'frameChin' });
      expect(workspace.state.windowPreferences.frameChin).toBe(false);
      expect(bottoms()[0]).toBeCloseTo(bareFrame);
      workspace.dispose();
      container.remove();
    });
  });
});
