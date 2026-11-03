import * as THREE from 'three';
import type { PaneDescriptor } from '../contracts';
import type { HierarchyStyle } from '../workspace/hierarchy-style';
import { createScalableLabel, disposeScalableLabel } from './labels';

const PAGE_SIZE = 6;
const AMBER = '#e4a84a';
const IVORY = '#dce7ed';
const TEAL = '#3c91a0';
const MUTED_TEAL = '#1d4c59';
const DARK = '#102832';

export interface HierarchyNavigation {
  path: string[];
  page: number;
}

export interface HierarchyNavigator {
  root: THREE.Group;
  update(deltaSeconds: number, camera: THREE.Camera): void;
  dispose(): void;
}

interface Node {
  key: string;
  kind: 'workspace' | 'session' | 'window' | 'pane';
  title: string;
  children: Node[];
  pane?: PaneDescriptor;
}

interface DrawnNode {
  node: Node;
  path: string[];
  page: number;
  object: THREE.Group;
}

function keyPart(value: string): string {
  return encodeURIComponent(value);
}

function keyFor(kind: Node['kind'], scope: string[]): string {
  return `${kind}:${scope.map(keyPart).join('/')}`;
}

function buildTree(panes: readonly PaneDescriptor[]): Node[] {
  const workspaces = new Map<string, Node>();
  for (const pane of panes) {
    let workspace = workspaces.get(pane.workspaceId);
    if (!workspace) {
      workspace = {
        key: keyFor('workspace', [pane.workspaceId]),
        kind: 'workspace',
        title: pane.workspaceName || pane.workspaceId,
        children: [],
      };
      workspaces.set(pane.workspaceId, workspace);
    }
    let session = workspace.children.find(
      (candidate) => candidate.key === keyFor('session', [pane.workspaceId, pane.sessionId]),
    );
    if (!session) {
      session = {
        key: keyFor('session', [pane.workspaceId, pane.sessionId]),
        kind: 'session',
        title: pane.sessionName || pane.sessionId,
        children: [],
      };
      workspace.children.push(session);
    }
    let window = session.children.find(
      (candidate) =>
        candidate.key === keyFor('window', [pane.workspaceId, pane.sessionId, pane.windowId]),
    );
    if (!window) {
      window = {
        key: keyFor('window', [pane.workspaceId, pane.sessionId, pane.windowId]),
        kind: 'window',
        title: pane.windowName || pane.windowId,
        children: [],
      };
      session.children.push(window);
    }
    window.children.push({
      key: keyFor('pane', [pane.workspaceId, pane.sessionId, pane.windowId, pane.id]),
      kind: 'pane',
      title: pane.title || pane.id,
      children: [],
      pane,
    });
  }
  const sort = (nodes: Node[]): Node[] => {
    nodes.sort((left, right) => left.key.localeCompare(right.key));
    for (const node of nodes) sort(node.children);
    return nodes;
  };
  return sort([...workspaces.values()]);
}

function descendants(node: Node, path: string[]): Node | undefined {
  let current: Node | undefined;
  let children: Node[] = node.children;
  for (const key of path) {
    current = children.find((candidate) => candidate.key === key);
    if (!current) return undefined;
    children = current.children;
  }
  return current;
}

function normalizeNavigation(tree: Node[], navigation: HierarchyNavigation): HierarchyNavigation {
  const safePath = Array.isArray(navigation.path)
    ? navigation.path.filter((key) => typeof key === 'string')
    : [];
  let children = tree;
  const path: string[] = [];
  for (const key of safePath) {
    const found = children.find((node) => node.key === key);
    if (!found) break;
    path.push(found.key);
    children = found.children;
  }
  const selected = descendants({ key: '', kind: 'workspace', title: '', children: tree }, path);
  const maxPage = Math.max(
    0,
    Math.ceil((selected?.children.length ?? tree.length) / PAGE_SIZE) - 1,
  );
  const page = Number.isFinite(navigation.page)
    ? Math.max(0, Math.min(maxPage, Math.floor(navigation.page)))
    : 0;
  return { path, page };
}

function setAction(object: THREE.Object3D, data: Record<string, unknown>): void {
  Object.assign(object.userData, data);
}

function material(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
}

export function createHierarchyNavigator(
  panes: readonly PaneDescriptor[],
  style: HierarchyStyle,
  navigation: HierarchyNavigation,
  attachedPaneIds: ReadonlySet<string> = new Set(),
): HierarchyNavigator {
  const tree = buildTree(panes);
  const normalized = normalizeNavigation(tree, navigation);
  const root = new THREE.Group();
  root.name = 'hierarchy-navigator';
  root.position.y = 0.25;
  root.userData.hierarchyPath = normalized.path.slice();
  root.userData.hierarchyPage = normalized.page;
  root.userData.hierarchyStyle = style;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const labels: THREE.Object3D[] = [];
  const drawn: DrawnNode[] = [];
  const sharedGeometries = new Map<string, THREE.BufferGeometry>();
  const sharedMaterials = new Map<string, THREE.MeshBasicMaterial>();
  const sharedSolidMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const cameraWorldQuaternion = new THREE.Quaternion();
  const parentWorldQuaternion = new THREE.Quaternion();
  const localLabelQuaternion = new THREE.Quaternion();
  let disposed = false;
  let phase = 0;
  const targetPhase = 1;

  const addGeometry = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  const addMaterial = <T extends THREE.Material>(value: T): T => {
    materials.add(value);
    return value;
  };
  const sharedGeometry = (
    name: string,
    create: () => THREE.BufferGeometry,
  ): THREE.BufferGeometry => {
    const existing = sharedGeometries.get(name);
    if (existing) return existing;
    const geometry = addGeometry(create());
    sharedGeometries.set(name, geometry);
    return geometry;
  };
  const sharedMaterial = (color: string, opacity = 1): THREE.MeshBasicMaterial => {
    const key = `${color}:${opacity}`;
    const existing = sharedMaterials.get(key);
    if (existing) return existing;
    const value = addMaterial(material(color, opacity));
    sharedMaterials.set(key, value);
    return value;
  };
  const sharedSolidMaterial = (color: string): THREE.MeshStandardMaterial => {
    const existing = sharedSolidMaterials.get(color);
    if (existing) return existing;
    const value = addMaterial(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.65,
        metalness: 0.15,
        emissive: color,
        emissiveIntensity: 0.08,
        flatShading: true,
      }),
    );
    sharedSolidMaterials.set(color, value);
    return value;
  };
  const positionFor = (level: number, index: number, kind: Node['kind']): THREE.Vector3 => {
    const position = new THREE.Vector3();
    const angle = index * 1.31 + level * 1.7;
    if (style === 'helix') {
      position.set(
        Math.cos(angle) * 0.78,
        -0.65 + level * 0.45 + Math.sin(index * 1.31) * 0.16,
        Math.sin(angle) * 0.62,
      );
    } else if (level === 0) {
      position.set(
        index === 0 ? 0 : Math.cos(angle) * 0.85,
        -0.6 + Math.sin(angle) * 0.2,
        -0.35 + Math.sin(angle) * 0.3,
      );
    } else {
      const radius = 0.65 + level * 0.16;
      position.set(
        Math.cos(angle) * radius,
        -0.45 + level * 0.4 + Math.sin(angle) * 0.18,
        Math.sin(angle) * 0.62,
      );
    }
    if (kind === 'pane') position.multiplyScalar(0.9);
    return position;
  };
  const drawNode = (
    node: Node,
    path: string[],
    page: number,
    level: number,
    index: number,
    preview = false,
  ): void => {
    const object = new THREE.Group();
    object.name = `hierarchy-${node.kind}-${node.key}`;
    const selected = normalized.path[level] === node.key;
    const nextPath = [...path, node.key];
    const nodeMaterial = sharedSolidMaterial(
      selected ? AMBER : preview ? MUTED_TEAL : node.kind === 'pane' ? IVORY : TEAL,
    );
    const geometry =
      node.kind === 'pane'
        ? sharedGeometry('pane-cartridge', () => new THREE.OctahedronGeometry(0.105, 0))
        : sharedGeometry(
            `node-${node.kind}`,
            () => new THREE.IcosahedronGeometry(node.kind === 'workspace' ? 0.2 : 0.13, 0),
          );
    const mesh = new THREE.Mesh(geometry, nodeMaterial);
    const action = node.kind === 'pane' ? 'pane' : 'hierarchyNode';
    setAction(mesh, {
      inputAction: action,
      hierarchyPath: nextPath,
      hierarchyPage: action === 'pane' ? undefined : 0,
      helpText: `${node.title} · ${node.kind === 'pane' ? 'Open pane' : `Open ${node.kind}`}`,
      originalTitle: node.title,
      ...(node.pane ? { paneId: node.pane.id } : {}),
    });
    object.add(mesh);
    const label = createScalableLabel(
      node.title,
      node.kind === 'workspace' ? 0.62 : 0.48,
      node.kind === 'workspace' ? 0.13 : 0.105,
      { background: DARK },
    );
    label.position.set(0, node.kind === 'session' || node.kind === 'pane' ? 0.22 : -0.22, 0.2);
    label.visible = !preview;
    label.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const labelMaterials = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const value of labelMaterials) {
        value.depthTest = false;
        value.depthWrite = false;
      }
      child.renderOrder = 30;
    });
    setAction(label, {
      inputAction: action,
      hierarchyPath: nextPath,
      hierarchyPage: action === 'pane' ? undefined : 0,
      helpText: `${node.title} · ${node.kind === 'pane' ? 'Open pane' : `Open ${node.kind}`}`,
      originalTitle: node.title,
      ...(node.pane ? { paneId: node.pane.id } : {}),
    });
    label.traverse((child) => setAction(child, label.userData));
    object.add(label);
    labels.push(label);
    object.position.copy(positionFor(level, index, node.kind));
    if (style === 'spatial-docks' && node.kind === 'window') {
      const frame = new THREE.Mesh(
        sharedGeometry('dock-frame', () => new THREE.TorusGeometry(0.22, 0.025, 6, 4)),
        sharedMaterial(MUTED_TEAL),
      );
      frame.position.z = -0.08;
      frame.rotation.z = Math.PI / 4;
      frame.raycast = () => undefined;
      object.add(frame);
    }
    if (node.kind === 'pane' && attachedPaneIds.has(node.pane?.id ?? '')) {
      const ring = new THREE.Mesh(
        sharedGeometry('attached-ring', () => new THREE.TorusGeometry(0.145, 0.018, 8, 24)),
        sharedMaterial(AMBER, 0.96),
      );
      ring.rotation.x = Math.PI / 2;
      ring.raycast = () => undefined;
      object.add(ring);
      object.userData.attachedRing = true;
    }
    object.userData.hierarchyNode = node.key;
    object.userData.hierarchyPath = nextPath;
    object.userData.hierarchyPage = action === 'pane' ? undefined : 0;
    object.userData.attached = node.pane ? attachedPaneIds.has(node.pane.id) : false;
    object.userData.hierarchyPreview = preview;
    root.add(object);
    drawn.push({ node, path, page, object });
  };

  const drawPaging = (children: Node[], path: string[], page: number, level: number): void => {
    const pageCount = Math.ceil(children.length / PAGE_SIZE);
    if (pageCount <= 1) return;
    const makePagingNode = (title: string, nextPage: number, index: number): void => {
      const paging: Node = {
        key: `page:${path.join('/')}:${nextPage}`,
        kind: 'window',
        title,
        children: [],
      };
      const object = new THREE.Group();
      object.name = `hierarchy-page-${nextPage}`;
      const mesh = new THREE.Mesh(
        addGeometry(new THREE.TorusGeometry(0.13, 0.025, 8, 20)),
        addMaterial(material(AMBER, 0.92)),
      );
      setAction(mesh, {
        inputAction: 'hierarchyNode',
        hierarchyPath: path.slice(),
        hierarchyPage: nextPage,
        helpText: 'Change page',
        originalTitle: title,
      });
      object.add(mesh);
      const label = createScalableLabel(title, 0.4, 0.09, { background: DARK, backplate: false });
      setAction(label, {
        inputAction: 'hierarchyNode',
        hierarchyPath: path.slice(),
        hierarchyPage: nextPage,
        helpText: 'Change page',
        originalTitle: title,
      });
      label.traverse((child) => setAction(child, label.userData));
      object.add(label);
      labels.push(label);
      object.position.set(
        (index - 0.5) * 0.4,
        -0.62 - level * 0.06,
        style === 'helix' ? 0.22 : -0.5,
      );
      root.add(object);
      drawn.push({ node: paging, path, page: nextPage, object });
    };
    if (page > 0) makePagingNode('Previous', page - 1, 0);
    if (page < pageCount - 1) makePagingNode('Next', page + 1, 1);
  };

  const addTube = (name: string, points: THREE.Vector3[], color: string, radius: number): void => {
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(
      addGeometry(new THREE.TubeGeometry(curve, Math.max(6, points.length * 4), radius, 8, false)),
      sharedMaterial(color, 0.86),
    );
    tube.name = name;
    tube.userData.hierarchyConnector = true;
    tube.raycast = () => undefined;
    root.add(tube);
  };

  const addSculpture = (): void => {
    if (style === 'helix') {
      const railPoints: THREE.Vector3[] = [];
      const secondRailPoints: THREE.Vector3[] = [];
      for (let index = 0; index < 18; index += 1) {
        const y = -0.9 + index * 0.12;
        const angle = index * 0.68;
        railPoints.push(new THREE.Vector3(Math.cos(angle) * 0.88, y, Math.sin(angle) * 0.88));
        secondRailPoints.push(
          new THREE.Vector3(Math.cos(angle + Math.PI) * 0.88, y, Math.sin(angle + Math.PI) * 0.88),
        );
      }
      addTube('helix-rail-primary', railPoints, TEAL, 0.025);
      addTube('helix-rail-secondary', secondRailPoints, MUTED_TEAL, 0.018);
    } else {
      const rootDisc = new THREE.Mesh(
        sharedGeometry('dock-root', () => new THREE.CylinderGeometry(0.34, 0.42, 0.12, 20)),
        sharedMaterial(TEAL, 0.92),
      );
      rootDisc.name = 'spatial-docks-root';
      rootDisc.position.set(0, -0.75, -0.35);
      rootDisc.userData.hierarchySculpture = true;
      rootDisc.raycast = () => undefined;
      root.add(rootDisc);
    }
  };

  const addNavigationControl = (title: string, path: string[], position: THREE.Vector3): void => {
    const control = new THREE.Group();
    control.name = `hierarchy-control-${title.toLowerCase()}`;
    const mesh = new THREE.Mesh(
      sharedGeometry('navigation-control', () => new THREE.TorusGeometry(0.1, 0.018, 8, 20)),
      sharedMaterial(AMBER, 0.9),
    );
    setAction(mesh, {
      inputAction: 'hierarchyNode',
      hierarchyPath: path.slice(),
      hierarchyPage: 0,
      helpText: title,
      originalTitle: title,
    });
    control.add(mesh);
    const label = createScalableLabel(title, 0.32, 0.08, { background: DARK, backplate: false });
    setAction(label, {
      inputAction: 'hierarchyNode',
      hierarchyPath: path.slice(),
      hierarchyPage: 0,
      helpText: title,
      originalTitle: title,
    });
    label.traverse((child) => setAction(child, label.userData));
    control.add(label);
    labels.push(label);
    control.position.copy(position);
    root.add(control);
  };

  if (tree.length === 0) {
    const label = createScalableLabel('No panes', 0.72, 0.16, {
      background: DARK,
      backplate: false,
    });
    label.position.set(0, 0, 0.2);
    label.userData.originalTitle = 'No panes';
    root.add(label);
    labels.push(label);
  } else {
    const expanded = descendants(
      { key: '', kind: 'workspace', title: '', children: tree },
      normalized.path,
    );
    const visibleChildren = (expanded?.children ?? tree).slice(
      normalized.page * PAGE_SIZE,
      (normalized.page + 1) * PAGE_SIZE,
    );
    const parentPath = normalized.path;
    const level = normalized.path.length;
    for (let depth = 0; depth < normalized.path.length; depth += 1) {
      const ancestor = descendants(
        { key: '', kind: 'workspace', title: '', children: tree },
        normalized.path.slice(0, depth + 1),
      );
      if (ancestor) drawNode(ancestor, normalized.path.slice(0, depth), 0, depth, 0);
    }
    visibleChildren.forEach((node, index) => {
      drawNode(node, parentPath, normalized.page, level, index);
    });
    let previewCount = 0;
    const previewCounts = new Map<number, number>();
    const previewBranch = (node: Node, path: string[], depth: number): void => {
      for (const child of node.children.slice(0, 2)) {
        if (previewCount >= 14) return;
        const index = previewCounts.get(depth) ?? 0;
        previewCounts.set(depth, index + 1);
        previewCount += 1;
        drawNode(child, path, normalized.page, depth, index, true);
        previewBranch(child, [...path, child.key], depth + 1);
      }
    };
    for (const node of visibleChildren) previewBranch(node, [...parentPath, node.key], level + 1);
    drawPaging(expanded?.children ?? tree, parentPath, normalized.page, level);
  }

  addSculpture();
  if (normalized.path.length > 0) {
    addNavigationControl('Home', [], new THREE.Vector3(-1.18, 1.1, 0.12));
    addNavigationControl('Up', normalized.path.slice(0, -1), new THREE.Vector3(-0.72, 1.1, 0.12));
  }
  for (const item of drawn) {
    if (item.path.length === 0) continue;
    const parentKey = item.path[item.path.length - 1];
    const parent = drawn.find((candidate) => candidate.node.key === parentKey);
    if (parent) {
      addTube(
        `hierarchy-connector-${parentKey}-${item.node.key}`,
        [parent.object.position.clone(), item.object.position.clone()],
        item.node.key === normalized.path[item.path.length] ? AMBER : MUTED_TEAL,
        0.012,
      );
    }
  }

  root.userData.hierarchyNodes = drawn;
  return {
    root,
    update(deltaSeconds: number, camera: THREE.Camera): void {
      if (disposed) return;
      phase = Math.min(targetPhase, phase + Math.max(0, deltaSeconds) / 0.35);
      root.scale.setScalar(0.94 + phase * 0.06);
      camera.getWorldQuaternion(cameraWorldQuaternion);
      for (const label of labels) {
        const parent = label.parent;
        if (!parent) continue;
        parent.getWorldQuaternion(parentWorldQuaternion);
        localLabelQuaternion.copy(parentWorldQuaternion).invert().multiply(cameraWorldQuaternion);
        label.quaternion.copy(localLabelQuaternion);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const label of labels) disposeScalableLabel(label);
      for (const geometry of geometries) geometry.dispose();
      for (const value of materials) value.dispose();
      root.clear();
    },
  };
}
