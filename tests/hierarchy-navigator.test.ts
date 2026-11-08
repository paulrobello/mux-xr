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
import { UI_ENV_MAP_INTENSITY } from '../src/xr/ui-environment';

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

  it.each(['helix', 'spatial-docks'] as const)(
    'hits navigation and paging controls through their torus holes in %s',
    (style) => {
      const navigator = createHierarchyNavigator(
        Array.from({ length: 7 }, (_, index) => pane(`p${index}`, `workspace-${index}`)),
        style,
        { path: ['workspace:workspace-0'], page: 0 },
      );
      navigator.root.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster();
      const hitTitleAt = (name: string, y: number): string | undefined => {
        const control = navigator.root.getObjectByName(name);
        if (!control) throw new Error(`Missing control ${name}`);
        const origin = control.localToWorld(new THREE.Vector3(0, y, 1));
        const target = control.localToWorld(new THREE.Vector3(0, y, 0));
        raycaster.set(origin, target.sub(origin).normalize());
        return raycaster.intersectObject(control, true)[0]?.object.userData.originalTitle as
          | string
          | undefined;
      };
      expect(hitTitleAt('hierarchy-control-home', 0.07)).toBe('Home');
      expect(hitTitleAt('hierarchy-control-up', 0.07)).toBe('Up');

      const paging = createHierarchyNavigator(
        Array.from({ length: 7 }, (_, index) => pane(`p${index}`, `workspace-${index}`)),
        style,
        { path: [], page: 0 },
      );
      paging.root.updateMatrixWorld(true);
      const next = paging.root.getObjectByName('hierarchy-page-1');
      if (!next) throw new Error('Missing next page control');
      const origin = next.localToWorld(new THREE.Vector3(0, 0.07, 1));
      const target = next.localToWorld(new THREE.Vector3(0, 0.07, 0));
      raycaster.set(origin, target.sub(origin).normalize());
      expect(raycaster.intersectObject(next, true)[0]?.object.userData.originalTitle).toBe('Next');
      const reverseOrigin = next.localToWorld(new THREE.Vector3(0, 0.07, -1));
      const reverseTarget = next.localToWorld(new THREE.Vector3(0, 0.07, 0));
      raycaster.set(reverseOrigin, reverseTarget.sub(reverseOrigin).normalize());
      expect(raycaster.intersectObject(next, true)[0]?.object.userData.originalTitle).toBe('Next');
      navigator.dispose();
      paging.dispose();
    },
  );

  it.each(['helix', 'spatial-docks'] as const)(
    'rotates node bodies and attached rings in %s',
    (style) => {
      const navigator = createHierarchyNavigator(
        [pane('a')],
        style,
        {
          path: ['workspace:ws', 'session:ws/session', 'window:ws/session/window'],
          page: 0,
        },
        new Set(['a']),
      );
      const childObject = navigator.root.children.find(
        (object) => (object.userData.hierarchyPath as string[] | undefined)?.length === 4,
      );
      const childBody = childObject?.children.find(
        (object) => object instanceof THREE.Mesh && object.geometry.type !== 'PlaneGeometry',
      );
      const currentObject = navigator.root.children.find(
        (object) => (object.userData.hierarchyPath as string[] | undefined)?.length === 3,
      );
      const currentBody = currentObject?.children.find(
        (object) => object instanceof THREE.Mesh && object.geometry.type !== 'PlaneGeometry',
      );
      const ring = navigator.root.children
        .find((object) => object.userData.attachedRing)
        ?.children.at(-1);
      expect(childBody).toBeInstanceOf(THREE.Mesh);
      expect(currentBody).toBeInstanceOf(THREE.Mesh);
      expect(ring).toBeInstanceOf(THREE.Mesh);
      const label = navigator.root.children
        .flatMap((object) => object.children)
        .find((object) => object.userData.labelText);
      if (!childBody || !currentBody || !ring || !label) throw new Error('Missing node components');
      const labelPosition = label.position.clone();
      const bodyRotation = childBody.rotation.y;
      const currentRotation = currentBody.rotation.y;
      const ringRotation = ring.rotation.y;
      navigator.update(1, new THREE.PerspectiveCamera());
      expect(childBody.rotation.y).toBeCloseTo(bodyRotation + 0.09);
      expect(currentBody.rotation.y).toBe(currentRotation);
      expect(ring.rotation.y).toBeCloseTo(ringRotation + 0.11);
      expect(label.position.equals(labelPosition)).toBe(true);
      navigator.dispose();
    },
  );

  it('lights nodes and opaque connector tubes with the shared env map across rebuilds', () => {
    const envMap = new THREE.Texture();
    envMap.userData.sharedUIEnvironment = true;
    const environmentDispose = vi.fn();
    envMap.addEventListener('dispose', environmentDispose);
    const panes = [pane('a'), pane('b')];
    const navigator = createHierarchyNavigator(
      panes,
      'helix',
      { path: ['workspace:ws'], page: 0 },
      new Set(),
      envMap,
    );
    const litMaterials = (): {
      tubes: THREE.MeshStandardMaterial[];
      nodes: THREE.MeshStandardMaterial[];
    } => {
      const tubes: THREE.MeshStandardMaterial[] = [];
      const nodes: THREE.MeshStandardMaterial[] = [];
      navigator.root.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | undefined;
        if (!material) return;
        if (object.userData.hierarchyConnector) {
          expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
          tubes.push(material as THREE.MeshStandardMaterial);
        } else if (material instanceof THREE.MeshStandardMaterial) nodes.push(material);
      });
      return { tubes, nodes };
    };
    const before = litMaterials();
    expect(before.tubes.length).toBeGreaterThan(0);
    expect(before.nodes.length).toBeGreaterThan(0);
    for (const material of [...before.tubes, ...before.nodes]) {
      expect(material.envMap).toBe(envMap);
      expect(material.envMapIntensity).toBe(UI_ENV_MAP_INTENSITY);
    }
    for (const material of before.tubes) {
      expect(material.transparent).toBe(false);
      expect(material.opacity).toBe(1);
    }

    navigator.navigate({ path: [], page: 0 });
    for (let step = 0; step < 4; step += 1) navigator.update(0.2, new THREE.PerspectiveCamera());
    expect(navigator.transitioning).toBe(false);
    const after = litMaterials();
    expect(after.nodes.length).toBeGreaterThan(0);
    for (const material of [...after.tubes, ...after.nodes]) expect(material.envMap).toBe(envMap);
    navigator.dispose();
    expect(environmentDispose).not.toHaveBeenCalled();
  });

  it('keeps cards, rings and navigation hit targets on basic materials', () => {
    const envMap = new THREE.Texture();
    const navigator = createHierarchyNavigator(
      [pane('a')],
      'spatial-docks',
      { path: ['workspace:ws', 'session:ws/session'], page: 0 },
      new Set(['a']),
      envMap,
    );
    let tori = 0;
    navigator.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!(mesh.geometry instanceof THREE.TorusGeometry)) return;
      tori += 1;
      expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    });
    expect(tori).toBeGreaterThan(0);
    navigator.dispose();
  });
});
