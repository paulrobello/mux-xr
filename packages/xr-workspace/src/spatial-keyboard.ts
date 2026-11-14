import * as THREE from 'three';
import { createCurvedSurfaceGeometry } from './curved-surface';
import {
  createModifierState,
  type KeyModifiers,
  keyboardDimensions,
  keyboardKeyLabel,
  keyboardKeys,
  type PositionedKey,
} from './keyboard';
import { curveKeyboardContent } from './keyboard-surface';
import { createKeyborbGlyphs, createKeyborbKey, createKeyborbShells } from './keyborb';
import { createScalableLabel, updateScalableLabel } from './labels';
import { disposeOwned } from './widget';

export type KeyboardStyle = 'panel' | 'keyborb';
export const KEYBOARD_UNIT = 0.13;

export function addKeyboardKeys(
  root: THREE.Group,
  style: KeyboardStyle,
  shift: boolean,
  decorate?: (mesh: THREE.Mesh, key: PositionedKey) => void,
): THREE.Mesh[] {
  return keyboardKeys.map((key, slot) => {
    const label =
      key.key.length === 1 && key.key !== ' ' ? keyboardKeyLabel(key.key, shift) : key.label;
    const diameter = KEYBOARD_UNIT - 0.025;
    const mesh =
      style === 'keyborb'
        ? createKeyborbKey(label, diameter)
        : createScalableLabel(
            label,
            key.width * KEYBOARD_UNIT - 0.014,
            key.height * KEYBOARD_UNIT - 0.03,
            {
              border: '#7197a8',
            },
          );
    Object.assign(mesh.userData, { inputAction: 'key', key: key.key, modifier: key.modifier });
    if (style === 'keyborb') mesh.userData.keyborbSlot = slot;
    mesh.position.set(
      (key.x + key.width / 2 - keyboardDimensions.width / 2) * KEYBOARD_UNIT,
      0.48 - (key.y + key.height / 2) * KEYBOARD_UNIT,
      style === 'keyborb' ? diameter / 2 + 0.003 : 0,
    );
    decorate?.(mesh, key);
    root.add(mesh);
    return mesh;
  });
}

export function addKeyborbBatches(root: THREE.Group): void {
  const orbs = root.children.filter(
    (child): child is THREE.Mesh => child.userData.keyborb === true,
  );
  const shells = createKeyborbShells(orbs);
  const glyphs = createKeyborbGlyphs(orbs);
  glyphs.batch.userData.disposeBatch = glyphs.dispose;
  root.add(shells.mesh, glyphs.batch);
  root.userData.keyborbShells = shells;
  root.userData.keyborbGlyphs = glyphs;
}

export interface SpatialKeyboardOptions {
  style?: KeyboardStyle;
  curvatureDegrees?: number;
  backing?: boolean;
  onKey(key: string, modifiers: Readonly<KeyModifiers>): void;
}

export interface SpatialKeyboard {
  root: THREE.Group;
  /** Supply the object hit by the host's ray, touch, or pinch. */
  press(target: THREE.Object3D): boolean;
  /** Refresh the Keyborb batches after input animates the orbs. */
  update(): void;
  dispose(): void;
}

export function createSpatialKeyboard(options: SpatialKeyboardOptions): SpatialKeyboard {
  const style = options.style ?? 'panel';
  const root = new THREE.Group();
  root.name = 'spatial-keyboard';
  const modifiers = createModifierState();
  const meshes = addKeyboardKeys(root, style, false);
  const width = keyboardDimensions.width * KEYBOARD_UNIT + 0.12;
  const height = keyboardDimensions.height * KEYBOARD_UNIT + 0.12;
  const degrees = options.curvatureDegrees ?? 0;
  const radians = Number.isFinite(degrees)
    ? THREE.MathUtils.degToRad(THREE.MathUtils.clamp(degrees, 0, 100))
    : 0;
  if (options.backing ?? style === 'panel') {
    const backing = new THREE.Mesh(
      radians
        ? createCurvedSurfaceGeometry({ width, height, radians })
        : new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color: 0x0d1720, depthWrite: !radians }),
    );
    backing.name = 'input-backdrop';
    backing.position.set(0, 0.48 - (keyboardDimensions.height * KEYBOARD_UNIT) / 2, -0.015);
    root.add(backing);
  }
  if (radians) curveKeyboardContent(root, width, radians);
  if (style === 'keyborb') addKeyborbBatches(root);
  const shells = root.userData.keyborbShells as ReturnType<typeof createKeyborbShells> | undefined;
  const glyphs = root.userData.keyborbGlyphs as ReturnType<typeof createKeyborbGlyphs> | undefined;
  let disposed = false;

  const updateShift = (previous: boolean): void => {
    const shift = Boolean(modifiers.active.shift);
    if (shift === previous) return;
    for (const [index, key] of keyboardKeys.entries()) {
      if (key.key.length !== 1 || key.key === ' ') continue;
      const mesh = meshes[index];
      const label = keyboardKeyLabel(key.key, shift);
      const labelMesh = (mesh.userData.keyborbLabel as THREE.Mesh | undefined) ?? mesh;
      updateScalableLabel(labelMesh, label);
      mesh.userData.labelText = label;
    }
  };

  return {
    root,
    press(target) {
      if (disposed) return false;
      let mesh: THREE.Object3D | null = target;
      while (mesh && mesh.parent !== root) mesh = mesh.parent;
      const slot = meshes.indexOf(mesh as THREE.Mesh);
      if (slot < 0) return false;
      const key = keyboardKeys[slot];
      const active = modifiers.active;
      if (key.modifier) modifiers.tap(key.modifier);
      else modifiers.consume();
      updateShift(Boolean(active.shift));
      if (!key.modifier) options.onKey(key.key, active);
      return true;
    },
    update() {
      if (disposed) return;
      shells?.update();
      glyphs?.update();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (glyphs) {
        glyphs.batch.removeFromParent();
        glyphs.dispose();
        const material = glyphs.batch.material;
        for (const item of Array.isArray(material) ? material : [material]) item.dispose();
      }
      shells?.mesh.dispose();
      disposeOwned(root);
      root.clear();
      root.removeFromParent();
    },
  };
}
