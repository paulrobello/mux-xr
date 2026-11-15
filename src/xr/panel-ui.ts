import { createScalableLabel, HAND_COLOR_PRESETS } from '@par/xr-workspace';
import * as THREE from 'three';
import type { BackgroundMode } from '../contracts';
import { getControlHelp } from '../control-help';
import { accent } from './accent-state';
import { BACKGROUND_LABELS } from './background-picker';
import { actionData, type PanelAction } from './panel-actions';

/**
 * Shared construction helpers for the XR panel modules under `panels/`. Both the scene factory and
 * the panel modules import from here, so the panel graph stays acyclic and the panel builders never
 * reach back into `scene.ts`.
 */

/** Amber styling applied to a control while its double-press confirm is armed. */
export const ARMED_STYLE = { armed: true, labelBackground: '#7a4a0c', labelBorder: '#f1b65e' };

/** Border color of a pinned quick-command panel button. */
export const PINNED_BORDER = '#66d5e7';

export type CommandTool = 'run' | 'pin' | 'edit' | 'remove';

export const COMMAND_TOOLS: Array<[CommandTool, string]> = [
  ['run', 'Run'],
  ['pin', 'Pin'],
  ['edit', 'Edit'],
  ['remove', 'Remove'],
];

export const COMMAND_TOOL_HINTS: Record<CommandTool, string> = {
  run: '',
  pin: 'Choose commands to pin or unpin',
  edit: 'Choose a command to edit',
  remove: 'Choose a command to remove',
};

/** Surfaces that a select lands on without pressing a control; they get no click cue. */
export const PASSIVE_ACTIONS = new Set([
  'noop',
  'grabInput',
  'grabWidget',
  'grabRadial',
  'scrollStrip',
]);

type ConfirmAction = 'exit' | 'resetLayout';

export type { ConfirmAction };

export const CONFIRM_LABELS: Record<ConfirmAction, [string, string]> = {
  exit: ['Exit', 'Exit?'],
  resetLayout: ['Reset layout', 'Reset?'],
};

// Keyboard-panel units; the panel spawns at 0.38 scale, so this is about 11 mm raised, 6 mm travel.
export const BUTTON_DEPTH = 0.03;
export const BUTTON_GAP = 0.002;

export function createLabelButton(
  label: string,
  width: number,
  height: number,
  data: Record<string, unknown>,
): THREE.Mesh {
  const mesh = createScalableLabel(label, width, height, {
    background: typeof data.labelBackground === 'string' ? data.labelBackground : '#1c2a35',
    wrap: Boolean(data.wrap),
    border:
      typeof data.labelBorder === 'string'
        ? data.labelBorder
        : typeof data.key === 'string'
          ? '#7197a8'
          : undefined,
  });
  Object.assign(mesh.userData, data, { helpText: getControlHelp(data) });
  return mesh;
}

/** Adds captioned rows of color swatches; each swatch shows its own color, a white border the current one. */
export function addColorSwatchRows(
  root: THREE.Group,
  top: number,
  rows: ReadonlyArray<readonly [string, string, string, string]>,
): void {
  for (const [row, [caption, action, current, empty]] of rows.entries()) {
    const y = top - row * 0.24;
    const label = createLabelButton(caption, 0.6, 0.08, actionData({ type: 'noop' }));
    label.position.y = y;
    root.add(label);
    for (const [index, { name, color }] of HAND_COLOR_PRESETS.entries()) {
      const swatch = createLabelButton(
        color ? name : empty,
        0.19,
        0.1,
        actionData({ type: action, [action]: color } as PanelAction, {
          labelBackground: color || '#1c2a35',
          ...(current === color ? { labelBorder: '#ffffff' } : {}),
        }),
      );
      swatch.position.set((index - (HAND_COLOR_PRESETS.length - 1) / 2) * 0.21, y - 0.11, 0);
      root.add(swatch);
    }
  }
}

export function raisePanelButton(mesh: THREE.Mesh): void {
  const width = Number(mesh.userData.labelWidth);
  const height = Number(mesh.userData.labelHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  // Hand contact identifies keys the same way, so a press can find the button's rebuilt copy.
  const { x, y } = mesh.position;
  mesh.userData.pressKey = `${mesh.userData.inputAction}:${mesh.userData.commandId ?? ''}:${x.toFixed(4)}:${y.toFixed(4)}`;
  mesh.position.z += BUTTON_DEPTH;
  Object.assign(mesh.userData, {
    raisedButton: true,
    buttonDepth: BUTTON_DEPTH,
    buttonGap: BUTTON_GAP,
  });
}

export function stackAboveControls(root: THREE.Group, rows: THREE.Mesh[][], gap = 0.03): void {
  let top = Number.NEGATIVE_INFINITY;
  root.updateMatrixWorld(true);
  for (const child of root.children) {
    const geometry = (child as THREE.Mesh).geometry;
    if (!geometry) continue;
    geometry.computeBoundingBox();
    if (geometry.boundingBox)
      top = Math.max(top, geometry.boundingBox.clone().applyMatrix4(child.matrix).max.y);
  }
  if (!Number.isFinite(top)) top = 0;
  for (const row of rows) {
    const height = Math.max(...row.map((mesh) => Number(mesh.userData.labelHeight) || 0.09));
    const y = top + gap + height / 2;
    const spacing = 0.04;
    const widths = row.map((mesh) => Number(mesh.userData.labelWidth) || 0.4);
    let x = -(widths.reduce((sum, width) => sum + width, 0) + spacing * (row.length - 1)) / 2;
    for (const [index, mesh] of row.entries()) {
      mesh.position.set(x + widths[index] / 2, y, 0);
      x += widths[index] + spacing;
      root.add(mesh);
    }
    top = y + height / 2;
  }
}

/** The World panel's background button; it opens the Backgrounds picker. */
export function createBackgroundSelect(mode: BackgroundMode): THREE.Group {
  const root = new THREE.Group();
  root.name = 'background-select';
  const trigger = createLabelButton(BACKGROUND_LABELS[mode], 0.48, 0.09, {
    inputAction: 'backgroundSelect',
  });
  trigger.name = 'background-select-trigger';
  trigger.userData.helpText = 'Choose a background';
  const shape = new THREE.Shape().moveTo(-0.006, 0.009).lineTo(-0.006, -0.009).lineTo(0.006, 0);
  shape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  arrow.position.set(0.2, 0, 0.003);
  arrow.raycast = () => undefined;
  root.add(trigger, arrow);
  return root;
}

export function setModifierVisual(object: THREE.Object3D, armed: boolean): void {
  object.userData.activeState = armed;
  const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
  if (material?.color) material.color.setHex(armed ? accent.hex : 0xffffff);
}
