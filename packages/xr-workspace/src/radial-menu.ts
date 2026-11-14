import * as THREE from 'three';
import { tintToLuminance } from './accent-colors';
import { createScalableLabel, disposeScalableLabel } from './labels';

export interface RadialMenuItem<Action extends string> {
  id: Action;
  label: string;
}

export interface RadialMenuOptions<Action extends string> {
  items: readonly RadialMenuItem<Action>[];
  accentColor?: string | null;
  footer?: { label: string; id: string; name?: string; helpText?: string };
}

export interface RadialMenu<Action extends string> {
  root: THREE.Group;
  readonly isOpen: boolean;
  readonly interactive: boolean;
  open(): void;
  close(): void;
  update(deltaSeconds: number): void;
  setFooterVisible(available: boolean): void;
  /** Recolors the outline and hover fill; an empty accent restores the authored cyan. */
  setAccent(accent: string): void;
  /** Resolves a sector or the center from a host hit while the menu accepts input. */
  actionAt(target: THREE.Object3D): Action | 'cancel' | null;
  setHovered(action: Action | 'cancel' | null): void;
  dispose(): void;
}

const COLORS = {
  glass: '#101c27',
  selected: '#315c6d',
  cancel: '#17212d',
  text: '#dce7ed',
  outline: '#66d5e7',
};
const OUTLINE_WIDTH = 0.005;
const OUTLINE_OPACITY = 0.9;
const OPEN_SECONDS = 0.64;
const CLOSE_SECONDS = 0.15;
const FAN_RADIUS = 0.245;
const STACK_ANGLE = -Math.PI / 2;

function sectorShape(
  innerRadius: number,
  outerRadius: number,
  center: number,
  itemCount: number,
): THREE.Shape {
  const shape = new THREE.Shape();
  const half = Math.PI / itemCount - 0.035;
  const steps = 10;
  const start = center - half;
  const end = center + half;
  const anchorX = Math.cos(Math.PI / 2) * FAN_RADIUS;
  const anchorY = Math.sin(Math.PI / 2) * FAN_RADIUS;
  shape.moveTo(Math.cos(start) * outerRadius - anchorX, Math.sin(start) * outerRadius - anchorY);
  for (let index = 1; index <= steps; index += 1) {
    const angle = start + ((end - start) * index) / steps;
    shape.lineTo(Math.cos(angle) * outerRadius - anchorX, Math.sin(angle) * outerRadius - anchorY);
  }
  shape.lineTo(Math.cos(end) * innerRadius - anchorX, Math.sin(end) * innerRadius - anchorY);
  for (let index = steps - 1; index >= 0; index -= 1) {
    const angle = start + ((end - start) * index) / steps;
    shape.lineTo(Math.cos(angle) * innerRadius - anchorX, Math.sin(angle) * innerRadius - anchorY);
  }
  shape.closePath();
  return shape;
}

/** A closed stroke of constant width centered on the polygon, with mitered corners. */
function outlineGeometry(polygon: THREE.Vector2[], width: number): THREE.BufferGeometry {
  const points = polygon.filter(
    (point, index) => point.distanceToSquared(polygon[(index + 1) % polygon.length]) > 1e-12,
  );
  const count = points.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const previous = points[(index + count - 1) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const inNormal = new THREE.Vector2(current.y - previous.y, previous.x - current.x).normalize();
    const outNormal = new THREE.Vector2(next.y - current.y, current.x - next.x).normalize();
    const miter = inNormal.clone().add(outNormal).normalize();
    const length = width / 2 / Math.max(0.3, miter.dot(outNormal));
    positions.push(
      current.x + miter.x * length,
      current.y + miter.y * length,
      0,
      current.x - miter.x * length,
      current.y - miter.y * length,
      0,
    );
    const a = index * 2;
    const b = ((index + 1) % count) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function glassMaterial(color: string, opacity = 0.84): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

interface Target<Action extends string> {
  action: Action;
  group: THREE.Group;
  label: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  finalAngle: number;
  finalPosition: THREE.Vector3;
  stackPosition: THREE.Vector3;
}

export function createRadialMenu<Action extends string>(
  options: RadialMenuOptions<Action>,
): RadialMenu<Action> {
  const { items, footer } = options;
  if (items.length < 2 || items.length > 8) {
    throw new RangeError('A radial menu requires between two and eight items');
  }
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length || items.some((item) => item.id === 'cancel')) {
    throw new RangeError('Radial menu item IDs must be unique and may not be cancel');
  }
  const root = new THREE.Group();
  const contents = new THREE.Group();
  contents.name = 'radial-menu-contents';
  root.name = 'radial-menu';
  root.visible = false;
  root.userData.inputAction = 'grabRadial';
  root.userData.rootUIgrabbable = true;
  root.userData.scaleLimits = [0.4, 1.6];
  root.userData.radialMenu = true;

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const targets: Target<Action>[] = [];
  let selectedColor: string = COLORS.selected;
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.outline,
    transparent: true,
    opacity: OUTLINE_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.add(outlineMaterial);
  const addOutline = (parent: THREE.Object3D, polygon: THREE.Vector2[]): void => {
    const outline = new THREE.Mesh(outlineGeometry(polygon, OUTLINE_WIDTH), outlineMaterial);
    outline.name = 'radial-outline';
    outline.position.z = 0.002;
    outline.raycast = () => undefined;
    geometries.add(outline.geometry);
    parent.add(outline);
  };
  const footerButton = footer
    ? createScalableLabel(footer.label, 0.34, 0.075, {
        background: COLORS.selected,
        backplate: true,
      })
    : null;
  if (footer && footerButton) {
    footerButton.name = footer.name ?? `radial-menu-${footer.id}`;
    footerButton.position.set(0, -0.43, 0.01);
    footerButton.traverse((child) => {
      child.userData.inputAction = footer.id;
      child.userData.helpText = footer.helpText;
    });
    footerButton.visible = false;
    contents.add(footerButton);
  }
  const center = new THREE.Group();
  center.name = 'radial-menu-cancel';
  center.userData.inputAction = 'radialAction';
  center.userData.radialAction = 'cancel';
  const centerDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.105, 32),
    glassMaterial(COLORS.cancel),
  );
  geometries.add(centerDisc.geometry);
  materials.add(centerDisc.material);
  centerDisc.userData.inputAction = 'radialAction';
  centerDisc.userData.radialAction = 'cancel';
  center.add(centerDisc);
  addOutline(center, new THREE.Path().absarc(0, 0, 0.105, 0, Math.PI * 2, false).getPoints(32));
  const cancelLabel = createScalableLabel('Cancel', 0.15, 0.06, {
    background: COLORS.cancel,
    backplate: false,
  });
  cancelLabel.userData.inputAction = 'radialAction';
  cancelLabel.userData.radialAction = 'cancel';
  cancelLabel.traverse((child) => {
    child.userData.inputAction = 'radialAction';
    child.userData.radialAction = 'cancel';
  });
  center.add(cancelLabel);
  contents.add(center);

  for (const [index, { id: action, label: text }] of items.entries()) {
    const finalAngle = Math.PI / 2 - (index * Math.PI * 2) / items.length;
    const group = new THREE.Group();
    group.name = `radial-menu-${action}`;
    group.userData.inputAction = 'radialAction';
    group.userData.radialAction = action;
    group.userData.finalAngle = finalAngle;
    group.userData.finalPosition = [
      Math.cos(finalAngle) * FAN_RADIUS,
      Math.sin(finalAngle) * FAN_RADIUS,
    ];
    const shape = sectorShape(0.14, 0.36, Math.PI / 2, items.length);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), glassMaterial(COLORS.glass));
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
    mesh.userData.inputAction = 'radialAction';
    mesh.userData.radialAction = action;
    group.add(mesh);
    addOutline(group, shape.getPoints());
    const label = createScalableLabel(text, 0.17, 0.07, {
      background: COLORS.glass,
      backplate: false,
    });
    label.userData.inputAction = 'radialAction';
    label.userData.radialAction = action;
    label.userData.labelColor = COLORS.text;
    label.traverse((child) => {
      child.userData.inputAction = 'radialAction';
      child.userData.radialAction = action;
    });
    group.add(label);
    contents.add(group);
    const finalPosition = new THREE.Vector3(
      Math.cos(finalAngle) * FAN_RADIUS,
      Math.sin(finalAngle) * FAN_RADIUS,
      0,
    );
    const stackPosition = new THREE.Vector3(
      (index - 2) * 0.008,
      -FAN_RADIUS + (index - 2) * 0.004,
      index * 0.001,
    );
    targets.push({
      action,
      group,
      label,
      material: mesh.material,
      finalAngle,
      finalPosition,
      stackPosition,
    });
  }
  root.add(contents);

  let phase: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  let elapsed = 0;
  let hovered: Action | 'cancel' | null = null;
  let disposed = false;
  const origin = new THREE.Vector3();

  const ease = (value: number): number => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  const setOpacity = (opacity: number): void => {
    centerDisc.material.opacity = opacity * 0.84;
    outlineMaterial.opacity = opacity * OUTLINE_OPACITY;
    for (const target of targets) target.material.opacity = opacity * 0.84;
  };
  const resetTransforms = (): void => {
    contents.scale.setScalar(1);
    center.scale.setScalar(0.001);
    for (const target of targets) {
      target.group.position.set(0, 0, 0);
      target.group.rotation.z = 0;
      target.group.scale.setScalar(0.001);
      target.label.rotation.z = 0;
    }
  };
  resetTransforms();

  const api: RadialMenu<Action> = {
    root,
    get isOpen(): boolean {
      return phase === 'opening' || phase === 'open';
    },
    get interactive(): boolean {
      return phase === 'open';
    },
    open(): void {
      if (disposed) return;
      phase = 'opening';
      elapsed = 0;
      hovered = null;
      root.visible = true;
      root.userData.interactive = false;
      resetTransforms();
      setOpacity(1);
      centerDisc.material.color.set(COLORS.cancel);
      for (const target of targets) target.material.color.set(COLORS.glass);
    },
    close(): void {
      if (disposed || phase === 'closed') return;
      phase = 'closing';
      elapsed = 0;
      root.userData.interactive = false;
    },
    update(deltaSeconds: number): void {
      if (disposed || phase === 'closed') return;
      const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
      elapsed += delta;
      if (phase === 'closing') {
        const progress = ease(elapsed / CLOSE_SECONDS);
        contents.scale.setScalar(1 - progress);
        setOpacity(1 - progress);
        if (progress >= 1) {
          phase = 'closed';
          root.visible = false;
          contents.scale.setScalar(1);
          resetTransforms();
        }
        return;
      }
      const centerProgress = ease(elapsed / 0.128);
      center.scale.setScalar(Math.max(0.001, centerProgress));
      const stackProgress = ease((elapsed - 0.128) / 0.128);
      const fanProgress = ease((elapsed - 0.256) / 0.384);
      for (const target of targets) {
        if (elapsed < 0.256) {
          target.group.position.lerpVectors(origin, target.stackPosition, stackProgress);
        } else {
          const angle = STACK_ANGLE + (target.finalAngle - STACK_ANGLE) * fanProgress;
          target.group.position.set(
            Math.cos(angle) * FAN_RADIUS,
            Math.sin(angle) * FAN_RADIUS,
            target.stackPosition.z,
          );
        }
        target.group.rotation.z = (target.finalAngle - Math.PI / 2) * fanProgress;
        target.group.scale.setScalar(Math.max(0.001, stackProgress));
        target.label.rotation.z = -target.group.rotation.z;
      }
      if (elapsed >= OPEN_SECONDS) {
        phase = 'open';
        root.userData.interactive = true;
        for (const target of targets) {
          target.group.position.copy(target.finalPosition);
          target.group.rotation.z = target.finalAngle - Math.PI / 2;
          target.group.scale.setScalar(1);
          target.label.rotation.z = -(target.finalAngle - Math.PI / 2);
        }
      }
    },
    setFooterVisible(visible): void {
      if (footerButton) footerButton.visible = visible;
    },
    actionAt(target) {
      if (!api.interactive) return null;
      for (
        let node: THREE.Object3D | null = target;
        node && node !== contents;
        node = node.parent
      ) {
        if (node.parent !== contents) continue;
        if (node === center) return 'cancel';
        return targets.find((item) => item.group === node)?.action ?? null;
      }
      return null;
    },
    setHovered(action): void {
      if (disposed || !api.interactive) return;
      if (
        action !== null &&
        action !== 'cancel' &&
        !targets.some((target) => target.action === action)
      )
        return;
      hovered = action;
      centerDisc.material.color.set(hovered === 'cancel' ? selectedColor : COLORS.cancel);
      for (const target of targets)
        target.material.color.set(target.action === hovered ? selectedColor : COLORS.glass);
    },
    setAccent(accent): void {
      outlineMaterial.color.set(accent || COLORS.outline);
      // The hover fill keeps the authored fill's brightness so white labels stay readable on it.
      const authored = new THREE.Color(COLORS.selected);
      selectedColor = `#${tintToLuminance(new THREE.Color(), authored, accent ? new THREE.Color(accent) : null).getHexString()}`;
      if (hovered !== null) {
        const current = hovered;
        hovered = null;
        api.setHovered(current);
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const object of root.children) object.traverse((child) => disposeScalableLabel(child));
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      root.clear();
      root.removeFromParent();
      phase = 'closed';
    },
  };
  if (options.accentColor) api.setAccent(options.accentColor);
  return api;
}
