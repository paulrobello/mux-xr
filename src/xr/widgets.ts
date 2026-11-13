import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AgentRosterRow } from '../workspace/agent-roster';
import { tagAccentMaterial } from './accent-colors';
import type { BellFeedEntry } from './bell-feed';
import { createScalableLabel, disposeScalableLabel, updateScalableLabel } from './labels';
import type { PerfSample } from './perf-gauge';
import type { PictureImage } from './picture-image';
import { applyUIEnvironment } from './ui-environment';

export type ClockKind = 'digital-clock' | 'analog-clock';

export interface Widget {
  root: THREE.Group;
  update: (nowMs: number) => void;
  dispose: () => void;
  /** Receives every roster change; widgets that do not show agents omit it. */
  setAgentRoster?: (rows: readonly AgentRosterRow[]) => void;
  /** Handles a press on one of the widget's `widgetControl` buttons. */
  activate?: (target: THREE.Object3D) => void;
  /** Receives every bell feed change, newest first; widgets that do not show bells omit it. */
  setBellFeed?: (entries: readonly BellFeedEntry[]) => void;
  /** Whether a ray rests on one of the widget's controls this frame. */
  setPointed?: (pointed: boolean) => void;
  /** Receives frame stats each time the scene's frame counter reports (about 2 Hz). */
  setPerfSample?: (sample: PerfSample) => void;
  /** Drops frame-time history; called when an XR session starts. */
  resetPerf?: () => void;
  /** Receives the focused pane, its OSC 7 cwd and hostname every frame; widgets dedupe repeats. */
  setFocusedPane?: (paneId: string | null, cwd: string | null, host?: string | null) => void;
  /** Applies a new texture anisotropy, already capped to the renderer maximum. */
  setTextureAnisotropy?: (anisotropy: number) => void;
  /** Receives the weather ZIP setting on mount and on each change; empty when none is set. */
  setWeatherZip?: (zip: string) => void;
  /** Gives a picture frame its depth map; frames take ownership of the image's canvas. */
  setPictureDepth?: (depth: PictureImage) => void;
}

let nextWidgetId = 1;

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const ACCENT_COLOR = 0x73d6e6;

function setWidgetMetadata(object: THREE.Object3D, widgetId: string, kind: ClockKind): void {
  object.userData.widgetId = widgetId;
  object.userData.widgetKind = kind;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
}

export function disposeOwned(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object !== root && object.userData.disposeLabel) {
      disposeScalableLabel(object);
      return;
    }
    for (let parent = object.parent; parent; parent = parent.parent) {
      if (parent.userData.disposeLabel) return;
    }
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (materials.has(material)) continue;
        materials.add(material);
        disposeMaterial(material);
      }
    }
  });
}

function addBox(
  root: THREE.Group,
  geometry: THREE.BoxGeometry,
  material: THREE.MeshStandardMaterial,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  root.add(mesh);
  return mesh;
}

function digitalText(now: Date): string {
  const hours = now.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 || 12;
  return `${hour}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${suffix}`;
}

export function createClockWidget(kind: ClockKind, envMap: THREE.Texture | null = null): Widget {
  const widgetId = `clock-widget-${nextWidgetId++}`;
  const root = new THREE.Group();
  root.name = widgetId;
  root.position.set(0, 1.45, -1.35);
  root.scale.setScalar(1);
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];
  setWidgetMetadata(root, widgetId, kind);

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const width = kind === 'digital-clock' ? 0.62 : 0.58;
  const height = kind === 'digital-clock' ? 0.24 : 0.58;
  const body = addBox(
    root,
    new THREE.BoxGeometry(width, height, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
    'clock-body',
  );
  body.position.z = -0.012;
  body.userData.inputAction = 'grabWidget';
  const face = addBox(
    root,
    new THREE.BoxGeometry(width - 0.035, height - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
    'clock-face',
  );
  face.position.z = 0.014;
  face.userData.inputAction = 'grabWidget';

  const close = createScalableLabel('×', 0.055, 0.055, { background: '#223946' });
  close.name = 'clock-close';
  close.position.set(width / 2 - 0.055 / 2, height / 2 - 0.055 / 2, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close this clock widget';
  root.add(close);

  const date = new Date();
  let lastSecond = -1;
  let display: THREE.Mesh | undefined;
  let secondHand: THREE.Mesh | undefined;
  let minuteHand: THREE.Mesh | undefined;
  let hourHand: THREE.Mesh | undefined;

  if (kind === 'digital-clock') {
    display = createScalableLabel(digitalText(date), width - 0.08, height - 0.08, {
      background: '#15232b',
    });
    display.name = 'digital-clock-display';
    display.position.z = 0.032;
    display.userData.inputAction = 'grabWidget';
    root.add(display);
  } else {
    const radius = 0.23;
    // One mesh for all twelve markers: each draw costs about 0.02 ms of Quest main thread.
    const placement = new THREE.Object3D();
    const markerGeometries = Array.from({ length: 12 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 12;
      placement.position.set(Math.sin(angle) * radius, Math.cos(angle) * radius, 0.04);
      placement.rotation.z = -angle;
      placement.updateMatrix();
      return new THREE.BoxGeometry(0.012, index % 3 === 0 ? 0.045 : 0.025, 0.012).applyMatrix4(
        placement.matrix,
      );
    });
    const markers = new THREE.Mesh(
      mergeGeometries(markerGeometries),
      tagAccentMaterial(lit({ color: ACCENT_COLOR, roughness: 0.65 }), ACCENT_COLOR),
    );
    for (const geometry of markerGeometries) geometry.dispose();
    markers.name = 'clock-markers';
    markers.userData.inputAction = 'grabWidget';
    root.add(markers);
    const handMaterial = lit({
      color: 0xe8f7f8,
      roughness: 0.65,
      metalness: 0.15,
    });
    hourHand = addBox(
      root,
      new THREE.BoxGeometry(0.018, 0.13, 0.012),
      handMaterial,
      'clock-hour-hand',
    );
    minuteHand = addBox(
      root,
      new THREE.BoxGeometry(0.012, 0.18, 0.012),
      handMaterial,
      'clock-minute-hand',
    );
    secondHand = addBox(
      root,
      new THREE.BoxGeometry(0.006, 0.21, 0.008),
      tagAccentMaterial(lit({ color: ACCENT_COLOR }), ACCENT_COLOR),
      'clock-second-hand',
    );
    for (const [index, hand] of [hourHand, minuteHand, secondHand].entries()) {
      hand.geometry.translate(0, (hand.geometry as THREE.BoxGeometry).parameters.height / 2, 0);
      hand.position.z = 0.052 + index * 0.006;
      hand.userData.inputAction = 'grabWidget';
    }
  }

  root.traverse((child) => setWidgetMetadata(child, widgetId, kind));
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];
  root.userData.widgetKind = kind;

  const update = (nowMs: number): void => {
    const second = Math.floor(nowMs / 1000);
    if (second !== lastSecond) {
      date.setTime(nowMs);
      lastSecond = second;
      if (display) updateScalableLabel(display, digitalText(date));
    }
    if (secondHand && minuteHand && hourHand) {
      const fraction = (((nowMs % 1000) + 1000) % 1000) / 1000;
      const secondFraction = date.getSeconds() + fraction;
      secondHand.rotation.z = -(secondFraction / 60) * Math.PI * 2;
      minuteHand.rotation.z = -((date.getMinutes() + secondFraction / 60) / 60) * Math.PI * 2;
      hourHand.rotation.z =
        -(((date.getHours() % 12) + (date.getMinutes() + secondFraction / 60) / 60) / 12) *
        Math.PI *
        2;
    }
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };
  update(Date.now());
  return { root, update, dispose };
}
