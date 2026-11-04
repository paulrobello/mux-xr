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
        path: ['workspace:ws'],
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
      if (style === 'helix') expect(sculptureNames).toContain('helix-rail-primary');
      if (style === 'spatial-docks') expect(sculptureNames).not.toContain('spatial-docks-root');
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
      { path: ['workspace:ws'], page: 0 },
    );
    const workspacePath = nodeMeshes(source).find(
      (object) => object.userData.originalTitle === 'Workspace ws',
    )?.userData.hierarchyPath as string[];
    source.dispose();
    const fullPath = [...workspacePath, 'session:ws/session', 'window:ws/session/window'];
    const active = createHierarchyNavigator(
      [pane('a')],
      'spatial-docks',
      { path: fullPath, page: 99 },
      new Set(['a']),
    );
    const leaf = nodeMeshes(active).find((object) => object.userData.inputAction === 'pane');
    expect(leaf?.userData.paneId).toBe('a');
    expect(leaf?.userData.originalTitle).toBe('Pane a');
    expect(active.root.userData.hierarchyPath).toEqual(fullPath);
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

  it('shows only the active level plus clickable ancestor breadcrumbs', () => {
    const panes = [pane('a', 'ws', 's1', 'w1'), pane('b', 'ws', 's2', 'w2')];
    const chooser = createHierarchyNavigator(panes, 'helix', { path: [], page: 0 });
    const chooserGroups = hierarchyObjects(chooser).filter(
      (object) => object.userData.hierarchyNode,
    );
    expect(chooserGroups.every((object) => object.name.includes('workspace-'))).toBe(true);
    const workspacePath = chooserGroups[0].userData.hierarchyPath as string[];
    chooser.dispose();

    const expanded = createHierarchyNavigator(panes, 'helix', { path: workspacePath, page: 0 });
    const groups = hierarchyObjects(expanded).filter((object) => object.userData.hierarchyNode);
    expect(groups.some((object) => object.name.includes('workspace-'))).toBe(true);
    expect(groups.some((object) => object.name.includes('session-'))).toBe(true);
    expect(groups.some((object) => object.name.includes('window-'))).toBe(false);
    expect(groups.some((object) => object.name.includes('pane-'))).toBe(false);
    const childPositions = groups
      .filter((object) => object.name.includes('session-'))
      .map((object) => object.position.clone());
    expect(
      new Set(childPositions.map((position) => position.toArray().join(','))).size,
    ).toBeGreaterThan(1);
    expanded.dispose();

    const full = createHierarchyNavigator(panes, 'spatial-docks', {
      path: [...workspacePath, 'session:ws/s1', 'window:ws/s1/w1'],
      page: 0,
    });
    const shapeTypes = hierarchyObjects(full)
      .filter((object) => object.userData.hierarchyNode)
      .map((object) => object.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh)
      .filter(Boolean)
      .map((mesh) => mesh.geometry.type);
    expect(new Set(shapeTypes).size).toBeGreaterThanOrEqual(4);
    full.dispose();
  });

  it('keeps root identity while contracting outgoing nodes and expanding incoming children', () => {
    const navigator = createHierarchyNavigator([pane('a'), pane('b', 'other')], 'helix', {
      path: [],
      page: 0,
    });
    const identity = navigator.root;
    const workspace = hierarchyObjects(navigator).find((object) =>
      object.name.includes('workspace-'),
    );
    const path = workspace?.userData.hierarchyPath as string[];
    expect(path?.length).toBe(1);
    navigator.navigate({ path, page: 0 });
    expect(navigator.root).toBe(identity);
    expect(navigator.transitioning).toBe(true);
    navigator.update(0.1, new THREE.PerspectiveCamera());
    expect(workspace?.scale.x).toBeLessThan(1);
    navigator.update(0.48, new THREE.PerspectiveCamera());
    expect(navigator.transitioning).toBe(false);
    expect(hierarchyObjects(navigator).some((object) => object.name.includes('session-'))).toBe(
      true,
    );
    navigator.dispose();
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
