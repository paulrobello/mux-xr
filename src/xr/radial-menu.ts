import * as THREE from 'three';
import { createScalableLabel, disposeScalableLabel } from './labels';

export type RadialMenuAction =
  | 'keyboard'
  | 'commands'
  | 'panes'
  | 'layout'
  | 'warp'
  | 'widgets'
  | 'settings'
  | 'cancel';
export type RadialAction = RadialMenuAction;

export interface RadialMenu {
  root: THREE.Group;
  readonly isOpen: boolean;
  readonly interactive: boolean;
  open(): void;
  close(): void;
  update(deltaSeconds: number): void;
  setHovered(action: RadialMenuAction | null): void;
  dispose(): void;
}

const ACTIONS = ['keyboard', 'commands', 'panes', 'layout', 'warp', 'widgets', 'settings'] as const;
const LABELS: Record<RadialMenuAction, string> = {
  keyboard: 'Keyboard',
  commands: 'Commands',
  panes: 'Panes',
  layout: 'Layout',
  warp: 'Warp',
  widgets: 'Widgets',
  settings: 'Settings',
  cancel: 'Cancel',
};
const COLORS = {
  glass: '#101c27',
  selected: '#315c6d',
  cancel: '#17212d',
  text: '#dce7ed',
};
const OPEN_SECONDS = 0.8;
const CLOSE_SECONDS = 0.15;
const FAN_RADIUS = 0.245;
const STACK_ANGLE = -Math.PI / 2;

function sectorGeometry(
  innerRadius: number,
  outerRadius: number,
  center: number,
): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const half = Math.PI / ACTIONS.length - 0.035;
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
  return new THREE.ShapeGeometry(shape);
}

function glassMaterial(color: string, opacity = 0.84): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

interface Target {
  action: RadialMenuAction;
  group: THREE.Group;
  label: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  finalAngle: number;
  finalPosition: THREE.Vector3;
  stackPosition: THREE.Vector3;
}

export function createRadialMenu(): RadialMenu {
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
  const targets: Target[] = [];
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
  const cancelLabel = createScalableLabel(LABELS.cancel, 0.15, 0.06, {
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

  for (const [index, action] of ACTIONS.entries()) {
    const finalAngle = Math.PI / 2 - (index * Math.PI * 2) / ACTIONS.length;
    const group = new THREE.Group();
    group.name = `radial-menu-${action}`;
    group.userData.inputAction = 'radialAction';
    group.userData.radialAction = action;
    group.userData.finalAngle = finalAngle;
    group.userData.finalPosition = [
      Math.cos(finalAngle) * FAN_RADIUS,
      Math.sin(finalAngle) * FAN_RADIUS,
    ];
    const mesh = new THREE.Mesh(
      sectorGeometry(0.14, 0.36, Math.PI / 2),
      glassMaterial(COLORS.glass),
    );
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
    mesh.userData.inputAction = 'radialAction';
    mesh.userData.radialAction = action;
    group.add(mesh);
    const label = createScalableLabel(LABELS[action], 0.2, 0.075, {
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
  let hovered: RadialMenuAction | null = null;
  let disposed = false;
  const origin = new THREE.Vector3();

  const ease = (value: number): number => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  const setOpacity = (opacity: number): void => {
    centerDisc.material.opacity = opacity * 0.84;
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

  const api: RadialMenu = {
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
      const centerProgress = ease(elapsed / 0.16);
      center.scale.setScalar(Math.max(0.001, centerProgress));
      const stackProgress = ease((elapsed - 0.16) / 0.16);
      const fanProgress = ease((elapsed - 0.32) / 0.48);
      for (const target of targets) {
        if (elapsed < 0.32) {
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
    setHovered(action): void {
      if (disposed || !api.interactive) return;
      if (
        action !== null &&
        action !== 'cancel' &&
        !targets.some((target) => target.action === action)
      )
        return;
      hovered = action;
      centerDisc.material.color.set(hovered === 'cancel' ? COLORS.selected : COLORS.cancel);
      for (const target of targets)
        target.material.color.set(target.action === hovered ? COLORS.selected : COLORS.glass);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const object of root.children) object.traverse((child) => disposeScalableLabel(child));
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      root.clear();
      phase = 'closed';
    },
  };
  return api;
}
