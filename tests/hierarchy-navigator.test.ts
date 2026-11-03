import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    text = '';
    font = '';
    fontSize = 0;
    maxWidth = 0;
    anchorX: number | string = 0;
    anchorY: number | string = 0;
    textAlign = '';
    whiteSpace = '';
    lineHeight: number | string = 'normal';
    overflowWrap = '';
    color: number | string | THREE.Color = 0;
    depthOffset = 0;
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import type { PaneDescriptor } from '../src/contracts';
import { createHierarchyNavigator } from '../src/xr/hierarchy-navigator';

const pane = (
  id: string,
  workspaceId = 'ws',
  sessionId = 'session',
  windowId = 'window',
): PaneDescriptor => ({
  id,
  workspaceId,
  workspaceName: `Workspace ${workspaceId}`,
  sessionId,
  sessionName: `Session ${sessionId}`,
  windowId,
  windowName: `Window ${windowId}`,
  title: `Pane ${id}`,
});

const nodeMeshes = (navigator: ReturnType<typeof createHierarchyNavigator>): THREE.Object3D[] => {
  const result: THREE.Object3D[] = [];
  navigator.root.traverse((object) => {
    if (object.userData.inputAction) result.push(object);
  });
  return result;
};

const hierarchyObjects = (
  navigator: ReturnType<typeof createHierarchyNavigator>,
): THREE.Object3D[] => {
  const result: THREE.Object3D[] = [];
  navigator.root.traverse((object) => {
    if (object.name.startsWith('hierarchy-')) result.push(object);
  });
  return result;
};

describe('volumetric hierarchy navigator', () => {
  it.each(['helix', 'spatial-docks'] as const)(
    'places %s nodes in 3D and exposes scoped actions',
    (style) => {
      const navigator = createHierarchyNavigator([pane('a'), pane('b', 'other')], style, {
        path: [],
        page: 0,
      });
      const meshes = nodeMeshes(navigator);
      expect(meshes.some((object) => object.userData.inputAction === 'hierarchyNode')).toBe(true);
      navigator.root.updateMatrixWorld(true);
      const positions = hierarchyObjects(navigator).map((object) =>
        object.getWorldPosition(new THREE.Vector3()),
      );
      expect(new Set(positions.map((position) => position.z.toFixed(4))).size).toBeGreaterThan(1);
      expect(new Set(positions.map((position) => position.y.toFixed(4))).size).toBeGreaterThan(1);
      expect(meshes.every((object) => Array.isArray(object.userData.hierarchyPath))).toBe(true);
      const sculptureNames: string[] = [];
      navigator.root.traverse((object) => sculptureNames.push(object.name));
      expect(sculptureNames).toContain(
        style === 'helix' ? 'helix-rail-primary' : 'spatial-docks-root',
      );
      expect(sculptureNames.some((name) => name.startsWith('hierarchy-connector-'))).toBe(true);
      navigator.dispose();
      expect(navigator.root.children).toHaveLength(0);
      navigator.dispose();
    },
  );

  it('keeps duplicate names distinct and pages every root child', () => {
    const panes = Array.from({ length: 14 }, (_, index) => pane(`p${index}`, `workspace-${index}`));
    const first = createHierarchyNavigator(panes, 'helix', { path: [], page: 0 });
    const next = nodeMeshes(first).find((object) => object.userData.originalTitle === 'Next');
    expect(next?.userData.inputAction).toBe('hierarchyNode');
    expect(next?.userData.hierarchyPage).toBe(1);
    const second = createHierarchyNavigator(panes, 'helix', { path: [], page: 1 });
    const leafTitles = nodeMeshes(second)
      .filter((object) => object.userData.inputAction === 'hierarchyNode')
      .map((object) => object.userData.originalTitle);
    expect(leafTitles).toContain('Workspace workspace-2');
    expect(new Set(leafTitles).size).toBeGreaterThan(1);
    first.dispose();
    second.dispose();
  });

  it('prunes removed paths, retains pane leaves, and marks attached panes', () => {
    const source = createHierarchyNavigator(
      [pane('a'), pane('b', 'ws', 'other-session')],
      'spatial-docks',
      { path: [], page: 0 },
    );
    const workspacePath = nodeMeshes(source).find(
      (object) => object.userData.originalTitle === 'Workspace ws',
    )?.userData.hierarchyPath as string[];
    source.dispose();
    const active = createHierarchyNavigator(
      [pane('a')],
      'spatial-docks',
      { path: workspacePath, page: 99 },
      new Set(['a']),
    );
    const leaf = nodeMeshes(active).find((object) => object.userData.inputAction === 'pane');
    expect(leaf?.userData.paneId).toBe('a');
    expect(leaf?.userData.originalTitle).toBe('Pane a');
    expect(active.root.userData.hierarchyPath).toEqual(workspacePath);
    expect(active.root.userData.hierarchyPage).toBe(0);
    expect(active.root.children.some((object) => object.userData.attachedRing)).toBe(true);
    active.dispose();

    const removed = createHierarchyNavigator([pane('a')], 'helix', {
      path: [...workspacePath, 'session:missing'],
      page: 0,
    });
    expect(removed.root.userData.hierarchyPath).toEqual(workspacePath);
    removed.dispose();

    const empty = createHierarchyNavigator([], 'helix', { path: ['workspace:ws'], page: 4 });
    expect(nodeMeshes(empty).some((object) => object.userData.inputAction)).toBe(false);
    expect(empty.root.userData.hierarchyPath).toEqual([]);
    expect(empty.root.userData.hierarchyPage).toBe(0);
    empty.dispose();
  });

  it('billboards labels in the parent local space under transformed roots', () => {
    const navigator = createHierarchyNavigator([pane('a')], 'helix', { path: [], page: 0 });
    const camera = new THREE.PerspectiveCamera();
    navigator.root.rotation.set(0.2, 0.5, -0.15);
    camera.rotation.set(-0.3, 0.4, 0.1);
    navigator.root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    navigator.update(0.35, camera);
    const label = nodeMeshes(navigator).find(
      (object) => object.userData.labelText && object.parent,
    );
    expect(label).toBeDefined();
    const cameraWorld = camera.getWorldQuaternion(new THREE.Quaternion());
    const parentWorld =
      label?.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    const expected = parentWorld.invert().multiply(cameraWorld);
    expect(label?.quaternion.angleTo(expected)).toBeLessThan(0.0001);
    navigator.dispose();
  });
});
