import * as THREE from 'three';
import type { PaneDescriptor } from '../contracts';
import type { HierarchyStyle } from '../workspace/hierarchy-style';
import { createScalableLabel, disposeScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';

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
  readonly transitioning: boolean;
  navigate(navigation: HierarchyNavigation): void;
  update(deltaSeconds: number, camera: THREE.Camera): void;
  dispose(): void;
}

type InternalNavigator = HierarchyNavigator & { disposeResources(): void };

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

// Tubes only. Metal reads as sheen only with the per-material env map; without one it just
// darkens, so tubes fall back to the matte finish. Other UI materials stay at UI_ENV_MAP_INTENSITY.
const TUBE_GLOSS = { roughness: 0.3, metalness: 0.6 } as const;
const TUBE_MATTE = { roughness: 0.7, metalness: 0.15 } as const;
const TUBE_ENV_MAP_INTENSITY = 1;

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
  envMap: THREE.Texture | null = null,
): HierarchyNavigator {
  const tree = buildTree(panes);
  const normalized = normalizeNavigation(tree, navigation);
  const root = new THREE.Group();
  root.name = 'hierarchy-navigator';
  root.position.y = 0.45;
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
  const rotatingBodies: THREE.Object3D[] = [];
  const rotatingRings: THREE.Object3D[] = [];
  let disposed = false;
  let resourcesDisposed = false;
  let phase = 0;
  const targetPhase = 1;
  let transition: {
    elapsed: number;
    outgoing: Array<{ object: THREE.Object3D; position: THREE.Vector3; scale: THREE.Vector3 }>;
    incoming: Array<{ object: THREE.Object3D; position: THREE.Vector3; scale: THREE.Vector3 }>;
    stale: THREE.Object3D[];
    previous: InternalNavigator;
    next: InternalNavigator;
  } | null = null;
  let activeResources: InternalNavigator | undefined;
  const transitionCenter = new THREE.Vector3();
  const transitionZeroScale = new THREE.Vector3(0.01, 0.01, 0.01);

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
  const navigationHitMaterial = (): THREE.MeshBasicMaterial => {
    const key = 'navigation-control-hit';
    const existing = sharedMaterials.get(key);
    if (existing) return existing;
    const value = addMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        colorWrite: false,
        depthWrite: false,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      }),
    );
    sharedMaterials.set(key, value);
    return value;
  };
  const sharedSolidMaterial = (color: string): THREE.MeshStandardMaterial => {
    const existing = sharedSolidMaterials.get(color);
    if (existing) return existing;
    const value = addMaterial(
      applyUIEnvironment(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.65,
          metalness: 0.15,
          emissive: color,
          emissiveIntensity: 0.08,
          flatShading: true,
        }),
        envMap,
      ),
    );
    sharedSolidMaterials.set(color, value);
    return value;
  };
  const sharedTubeMaterial = (color: string): THREE.MeshStandardMaterial => {
    const key = `tube:${color}`;
    const existing = sharedSolidMaterials.get(key);
    if (existing) return existing;
    const value = addMaterial(
      applyUIEnvironment(
        new THREE.MeshStandardMaterial({
          color,
          ...(envMap ? TUBE_GLOSS : TUBE_MATTE),
          emissive: color,
          emissiveIntensity: 0.12,
        }),
        envMap,
        TUBE_ENV_MAP_INTENSITY,
      ),
    );
    sharedSolidMaterials.set(key, value);
    return value;
  };
  const sphericalPosition = (index: number, count: number): THREE.Vector3 => {
    const radius = 1;
    const angle = (index * Math.PI * 2) / Math.max(1, count);
    const radial = radius * (index % 2 ? 0.95 : 0.8);
    return new THREE.Vector3(
      Math.cos(angle) * radial,
      Math.sin(angle) * radial,
      Math.sqrt(radius * radius - radial * radial),
    );
  };
  const drawNode = (
    node: Node,
    path: string[],
    page: number,
    position: THREE.Vector3,
    breadcrumb = false,
  ): void => {
    const object = new THREE.Group();
    object.name = `hierarchy-${node.kind}-${node.key}`;
    const nextPath = [...path, node.key];
    const nodeMaterial = sharedSolidMaterial(
      !breadcrumb &&
        nextPath.length === normalized.path.length &&
        node.key === normalized.path.at(-1)
        ? AMBER
        : node.kind === 'pane'
          ? IVORY
          : breadcrumb
            ? MUTED_TEAL
            : TEAL,
    );
    const geometry =
      node.kind === 'pane'
        ? sharedGeometry('pane-cartridge', () => new THREE.OctahedronGeometry(0.105, 0))
        : node.kind === 'workspace'
          ? sharedGeometry('node-workspace', () => new THREE.IcosahedronGeometry(0.2, 0))
          : node.kind === 'session'
            ? sharedGeometry('node-session', () => new THREE.DodecahedronGeometry(0.15, 0))
            : sharedGeometry('node-window', () => new THREE.TetrahedronGeometry(0.14, 0));
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
    if (nextPath.length === normalized.path.length + 1) rotatingBodies.push(mesh);
    const label = createScalableLabel(
      node.title,
      node.kind === 'workspace' ? 0.62 : 0.48,
      node.kind === 'workspace' ? 0.13 : 0.105,
      { background: DARK },
    );
    label.position.set(0, -0.22, 0.2);
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
    object.position.copy(position);
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
      rotatingRings.push(ring);
      object.userData.attachedRing = true;
    }
    object.userData.hierarchyNode = node.key;
    object.userData.hierarchyPath = nextPath;
    object.userData.hierarchyPage = action === 'pane' ? undefined : 0;
    object.userData.attached = node.pane ? attachedPaneIds.has(node.pane.id) : false;
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
      const hitDisc = new THREE.Mesh(
        sharedGeometry('navigation-control-hit', () => new THREE.CircleGeometry(0.118, 24)),
        navigationHitMaterial(),
      );
      hitDisc.position.z = -0.001;
      setAction(hitDisc, {
        inputAction: 'hierarchyNode',
        hierarchyPath: path.slice(),
        hierarchyPage: nextPage,
        helpText: 'Change page',
        originalTitle: title,
      });
      object.add(hitDisc);
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

  const addTube = (
    name: string,
    points: THREE.Vector3[],
    color: string,
    radius: number,
    childPath?: string[],
  ): void => {
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(
      addGeometry(new THREE.TubeGeometry(curve, Math.max(6, points.length * 4), radius, 8, false)),
      sharedTubeMaterial(color),
    );
    tube.name = name;
    tube.userData.hierarchyConnector = true;
    if (childPath) tube.userData.hierarchyChildPath = childPath.slice();
    tube.raycast = () => undefined;
    root.add(tube);
  };

  const addSculpture = (): void => {
    if (style === 'helix') {
      const railPoints: THREE.Vector3[] = [];
      const secondRailPoints: THREE.Vector3[] = [];
      for (let index = 0; index < 18; index += 1) {
        const y = -0.24 + index * 0.03;
        const angle = index * 0.68;
        railPoints.push(new THREE.Vector3(Math.cos(angle) * 0.32, y, Math.sin(angle) * 0.32));
        secondRailPoints.push(
          new THREE.Vector3(Math.cos(angle + Math.PI) * 0.32, y, Math.sin(angle + Math.PI) * 0.32),
        );
      }
      addTube('helix-rail-primary', railPoints, TEAL, 0.025);
      addTube('helix-rail-secondary', secondRailPoints, MUTED_TEAL, 0.018);
    }
  };

  const addNavigationControl = (title: string, path: string[], position: THREE.Vector3): void => {
    const control = new THREE.Group();
    control.name = `hierarchy-control-${title.toLowerCase()}`;
    const hitDisc = new THREE.Mesh(
      sharedGeometry('navigation-control-hit', () => new THREE.CircleGeometry(0.118, 24)),
      navigationHitMaterial(),
    );
    hitDisc.position.z = -0.001;
    setAction(hitDisc, {
      inputAction: 'hierarchyNode',
      hierarchyPath: path.slice(),
      hierarchyPage: 0,
      helpText: title,
      originalTitle: title,
    });
    control.add(hitDisc);
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
    const parentPath = normalized.path;
    const level = normalized.path.length;
    const visibleChildren = (expanded?.children ?? tree).slice(
      normalized.page * PAGE_SIZE,
      (normalized.page + 1) * PAGE_SIZE,
    );
    const currentPosition = new THREE.Vector3(0, 0, 0);
    if (normalized.path.length > 0 && expanded) {
      drawNode(expanded, normalized.path.slice(0, -1), normalized.page, currentPosition);
    }
    for (let depth = 0; depth < Math.max(0, normalized.path.length - 1); depth += 1) {
      const ancestor = descendants(
        { key: '', kind: 'workspace', title: '', children: tree },
        normalized.path.slice(0, depth + 1),
      );
      if (ancestor) {
        drawNode(
          ancestor,
          normalized.path.slice(0, depth),
          0,
          new THREE.Vector3(-1.35, 0.95 - depth * 0.5, -0.4 - depth * 0.08),
          true,
        );
      }
    }
    visibleChildren.forEach((node, index) => {
      drawNode(
        node,
        normalized.path,
        normalized.page,
        sphericalPosition(index, visibleChildren.length),
      );
    });
    drawPaging(expanded?.children ?? tree, parentPath, normalized.page, level);
  }

  addSculpture();
  if (normalized.path.length > 0) {
    addNavigationControl('Home', [], new THREE.Vector3(-1.25, 1.2, 0.12));
    addNavigationControl('Up', normalized.path.slice(0, -1), new THREE.Vector3(1.25, 1.2, 0.12));
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
        [...item.path, item.node.key],
      );
    }
  }

  root.userData.hierarchyNodes = drawn;
  const isDynamicViewObject = (object: THREE.Object3D, path: string[]): boolean => {
    if (object.name.startsWith('hierarchy-page-')) return true;
    const nodePath = object.userData.hierarchyPath;
    const childPath = object.userData.hierarchyChildPath;
    return (
      (Array.isArray(nodePath) && nodePath.length === path.length + 1) ||
      (Array.isArray(childPath) && childPath.length === path.length + 1)
    );
  };
  const isContextViewObject = (object: THREE.Object3D, path: string[]): boolean => {
    const nodePath = object.userData.hierarchyPath;
    const childPath = object.userData.hierarchyChildPath;
    return (
      (Array.isArray(nodePath) && nodePath.length <= path.length) ||
      (Array.isArray(childPath) && childPath.length <= path.length)
    );
  };
  const api = {
    root,
    get transitioning(): boolean {
      return transition !== null;
    },
    navigate(nextNavigation: HierarchyNavigation): void {
      if (disposed || transition) return;
      const next = createHierarchyNavigator(
        panes,
        style,
        nextNavigation,
        attachedPaneIds,
        envMap,
      ) as InternalNavigator;
      const outgoing = [...root.children];
      const incoming = [...next.root.children];
      const oldPath = Array.isArray(root.userData.hierarchyPath)
        ? (root.userData.hierarchyPath as string[])
        : [];
      const incomingPath = Array.isArray(next.root.userData.hierarchyPath)
        ? (next.root.userData.hierarchyPath as string[])
        : [];
      const outgoingDynamic = outgoing.filter((object) => isDynamicViewObject(object, oldPath));
      const incomingDynamic = incoming.filter((object) =>
        isDynamicViewObject(object, incomingPath),
      );
      const incomingContextKeys = new Set(
        incoming
          .map((object) => object.userData.hierarchyPath)
          .filter((path): path is string[] => Array.isArray(path))
          .map((path) => path.join('\u0000')),
      );
      const outgoingContext = outgoing.filter(
        (object) =>
          !outgoingDynamic.includes(object) &&
          isContextViewObject(object, oldPath) &&
          !incomingContextKeys.has(
            (object.userData.hierarchyPath as string[] | undefined)?.join('\u0000') ?? '',
          ),
      );
      root.clear();
      for (const child of incoming) root.add(child);
      root.userData.hierarchyPath = (next.root.userData.hierarchyPath as string[]).slice();
      root.userData.hierarchyPage = next.root.userData.hierarchyPage;
      root.userData.hierarchyNodes = next.root.userData.hierarchyNodes;
      for (const object of incomingDynamic) {
        const targetPosition = object.position.clone();
        const targetScale = object.scale.clone();
        object.position.copy(transitionCenter);
        object.scale.setScalar(0.01);
        object.userData.hierarchyTransitionTarget = targetPosition;
        object.userData.hierarchyTransitionScale = targetScale;
      }
      transition = {
        elapsed: 0,
        outgoing: outgoingDynamic.map((object) => ({
          object,
          position: object.position.clone(),
          scale: object.scale.clone(),
        })),
        incoming: incomingDynamic.map((object) => ({
          object,
          position: object.userData.hierarchyTransitionTarget.clone(),
          scale: object.userData.hierarchyTransitionScale.clone(),
        })),
        stale: outgoingContext,
        previous: activeResources as InternalNavigator,
        next,
      };
      for (const object of outgoingDynamic) root.add(object);
      for (const object of outgoingContext) root.add(object);
      activeResources = next;
    },
    update(deltaSeconds: number, camera: THREE.Camera): void {
      if (disposed) return;
      const delta = Math.max(0, deltaSeconds);
      phase = Math.min(targetPhase, phase + delta / 0.35);
      root.scale.setScalar(0.94 + phase * 0.06);
      for (const body of rotatingBodies) body.rotation.y += delta * 0.09;
      for (const ring of rotatingRings) ring.rotation.y += delta * 0.11;
      if (activeResources && activeResources !== api) activeResources.update(deltaSeconds, camera);
      if (transition) {
        transition.elapsed += delta;
        const progress = Math.min(1, transition.elapsed / 0.45);
        const contract = Math.min(1, progress / 0.4);
        const expand = Math.max(0, (progress - 0.4) / 0.6);
        const ease = (value: number): number => value * value * (3 - 2 * value);
        const contractEase = ease(contract);
        const expandEase = ease(expand);
        for (const entry of transition.outgoing) {
          entry.object.position.lerpVectors(entry.position, transitionCenter, contractEase);
          entry.object.scale.lerpVectors(entry.scale, transitionZeroScale, contractEase);
        }
        for (const entry of transition.incoming) {
          entry.object.position.lerpVectors(transitionCenter, entry.position, expandEase);
          entry.object.scale.lerpVectors(transitionZeroScale, entry.scale, expandEase);
        }
        if (progress >= 1) {
          for (const entry of transition.incoming) {
            entry.object.position.copy(entry.position);
            entry.object.scale.copy(entry.scale);
          }
          for (const entry of transition.outgoing) entry.object.removeFromParent();
          for (const object of transition.stale) object.removeFromParent();
          transition.previous.disposeResources();
          transition = null;
        }
      }
      camera.getWorldQuaternion(cameraWorldQuaternion);
      for (const label of labels) {
        const parent = label.parent;
        if (!parent) continue;
        parent.getWorldQuaternion(parentWorldQuaternion);
        localLabelQuaternion.copy(parentWorldQuaternion).invert().multiply(cameraWorldQuaternion);
        label.quaternion.copy(localLabelQuaternion);
      }
    },
    disposeResources(): void {
      if (resourcesDisposed) return;
      resourcesDisposed = true;
      for (const label of labels) disposeScalableLabel(label);
      for (const geometry of geometries) geometry.dispose();
      for (const value of materials) value.dispose();
    },
    dispose(): void {
      if (disposed) return;
      if (transition) {
        transition.previous.disposeResources();
        transition.next.disposeResources();
      }
      transition = null;
      activeResources?.disposeResources();
      disposed = true;
      root.clear();
    },
  };
  activeResources = api;
  return api;
}
