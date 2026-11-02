import * as THREE from 'three';
import { createScalableLabel, disposeScalableLabel } from './labels';

export type RadialAction = 'keyboard' | 'commands' | 'layout' | 'warp' | 'widgets' | 'cancel';
export type RadialVariant = 'ring' | 'satellites';

export interface RadialPrototypeOptions {
  variant: RadialVariant;
  glass: boolean;
  onSelect?: (action: RadialAction) => void;
}

export interface RadialPrototype {
  root: THREE.Group;
  update(dt: number): void;
  setHovered(action: RadialAction | null): void;
  dispose(): void;
}

const ACTIONS = ['keyboard', 'commands', 'layout', 'warp', 'widgets'] as const;
const LABELS: Record<RadialAction, string> = {
  keyboard: 'Keyboard',
  commands: 'Commands',
  layout: 'Layout',
  warp: 'Warp',
  widgets: 'Widgets',
  cancel: 'Cancel',
};
const COLORS = {
  body: '#192b38',
  glass: '#101c27',
  selected: '#315c6d',
  cancel: '#17212d',
  text: '#dce7ed',
};

interface Target {
  action: RadialAction;
  root: THREE.Object3D;
  baseScale: number;
  targetScale: number;
  currentScale: number;
}

function sectorGeometry(
  innerRadius: number,
  outerRadius: number,
  start: number,
  end: number,
): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const steps = 12;
  shape.moveTo(Math.cos(start) * outerRadius, Math.sin(start) * outerRadius);
  for (let index = 1; index <= steps; index += 1) {
    const angle = start + ((end - start) * index) / steps;
    shape.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
  }
  shape.lineTo(Math.cos(end) * innerRadius, Math.sin(end) * innerRadius);
  for (let index = steps - 1; index >= 0; index -= 1) {
    const angle = start + ((end - start) * index) / steps;
    shape.lineTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function material(color: string, glass: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: glass,
    opacity: glass ? 0.84 : 1,
    depthWrite: !glass,
  });
}

function addLabel(
  target: THREE.Object3D,
  text: string,
  width: number,
  height: number,
  background: string,
): THREE.Mesh {
  const label = createScalableLabel(text, width, height, { background });
  label.userData.inputAction = 'prototypeRadial';
  target.add(label);
  return label;
}

export function createRadialPrototype(options: RadialPrototypeOptions): RadialPrototype {
  const root = new THREE.Group();
  root.name = 'radial-prototype';
  root.userData.inputAction = 'prototypeRadial';
  root.userData.prototypeRadial = true;
  root.userData.animationDurationMs = 150;
  root.userData.radialVariant = options.variant;
  root.userData.glass = options.glass;

  const targets: Target[] = [];
  const ownedMaterials = new Set<THREE.Material>();
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const background = options.glass ? COLORS.glass : COLORS.body;
  const addTarget = (action: RadialAction, targetRoot: THREE.Object3D, baseScale = 1): void => {
    targetRoot.userData.inputAction = `prototypeRadial/${action}`;
    targetRoot.userData.radialAction = action;
    targetRoot.userData.onSelect = () => options.onSelect?.(action);
    targets.push({
      action,
      root: targetRoot,
      baseScale,
      targetScale: baseScale,
      currentScale: baseScale,
    });
  };

  if (options.variant === 'ring') {
    const gap = 0.035;
    const segment = (Math.PI * 2) / ACTIONS.length;
    for (const [index, action] of ACTIONS.entries()) {
      const center = Math.PI / 2 - index * segment;
      const start = center - segment / 2 + gap;
      const end = center + segment / 2 - gap;
      const sector = new THREE.Mesh(
        sectorGeometry(0.14, 0.36, start, end),
        material(background, options.glass),
      );
      ownedGeometries.add(sector.geometry);
      ownedMaterials.add(sector.material);
      const angle = (start + end) / 2;
      const label = addLabel(
        sector,
        LABELS[action],
        0.2,
        0.075,
        options.glass ? COLORS.glass : COLORS.selected,
      );
      label.position.set(Math.cos(angle) * 0.245, Math.sin(angle) * 0.245, 0.006);
      addTarget(action, sector, 1);
      root.add(sector);
    }
  } else {
    const radius = 0.31;
    for (const [index, action] of ACTIONS.entries()) {
      const angle = Math.PI / 2 - (index * Math.PI * 2) / ACTIONS.length;
      const satellite = new THREE.Group();
      satellite.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      const label = addLabel(
        satellite,
        LABELS[action],
        0.25,
        0.1,
        options.glass ? COLORS.glass : COLORS.body,
      );
      label.userData.inputAction = 'prototypeRadial';
      addTarget(action, satellite, 1);
      root.add(satellite);
    }
  }

  const cancel = new THREE.Group();
  const cancelDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.105, 32),
    material(COLORS.cancel, options.glass),
  );
  ownedGeometries.add(cancelDisc.geometry);
  ownedMaterials.add(cancelDisc.material);
  cancel.add(cancelDisc);
  addLabel(cancel, LABELS.cancel, 0.15, 0.06, COLORS.cancel);
  addTarget('cancel', cancel, 1);
  root.add(cancel);

  let hovered: RadialAction | null = null;
  let disposed = false;
  return {
    root,
    update(dt): void {
      if (disposed) return;
      const amount = Math.min(1, Math.max(0, Number.isFinite(dt) ? dt : 0) * 12);
      for (const target of targets) {
        target.currentScale += (target.targetScale - target.currentScale) * amount;
        target.root.scale.setScalar(target.currentScale);
      }
    },
    setHovered(action): void {
      if (disposed || (action !== null && !targets.some((target) => target.action === action)))
        return;
      hovered = action;
      for (const target of targets) {
        target.targetScale = target.baseScale * (target.action === hovered ? 1.12 : 1);
        const mesh = target.root instanceof THREE.Mesh ? target.root : target.root.children[0];
        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshBasicMaterial) {
          mesh.material.color.set(target.action === hovered ? COLORS.selected : background);
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.traverse((object) => {
        if (object !== root) disposeScalableLabel(object);
      });
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const ownedMaterial of ownedMaterials) ownedMaterial.dispose();
      root.clear();
    },
  };
}
