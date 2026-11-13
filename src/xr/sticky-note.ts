import * as THREE from 'three';
import { tagAccentMaterial } from './accent-colors';
import { createScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const STICKY_NOTE_KIND = 'sticky-note';
export const STICKY_NOTE_WIDTH = 0.34;
export const STICKY_NOTE_HEIGHT = 0.26;
/** A first press on the corner arms Delete; a second within this window deletes the note. */
export const STICKY_NOTE_CONFIRM_MS = 3000;

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x1d2c36;
const STRIP_COLOR = 0x73d6e6;
const STRIP_HEIGHT = 0.026;
const CORNER = 0.05;
const CONFIRM_WIDTH = 0.15;

let nextNoteId = 1;

export interface StickyNoteOptions {
  /** The note's store id; also its widget instance id. */
  id?: string;
  text?: string;
}

export function createStickyNoteWidget(
  envMap: THREE.Texture | null = null,
  options: StickyNoteOptions = {},
): Widget {
  const id = options.id ?? `sticky-note-${nextNoteId++}`;
  const root = new THREE.Group();
  root.name = `sticky-note-${id}`;
  root.userData.noteId = id;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(STICKY_NOTE_WIDTH, STICKY_NOTE_HEIGHT, 0.02),
    lit({ color: BODY_COLOR, roughness: 0.7, metalness: 0.2 }),
  );
  body.name = 'sticky-note-body';
  body.position.z = -0.006;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(STICKY_NOTE_WIDTH - 0.02, STICKY_NOTE_HEIGHT - 0.02, 0.01),
    lit({ color: FACE_COLOR, roughness: 0.75, metalness: 0.1 }),
  );
  face.name = 'sticky-note-face';
  face.position.z = 0.006;
  // The accent strip across the top reads as the note's adhesive edge and follows the accent color.
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(STICKY_NOTE_WIDTH - CORNER - 0.02, STRIP_HEIGHT, 0.012),
    tagAccentMaterial(lit({ color: STRIP_COLOR, roughness: 0.6 }), STRIP_COLOR),
  );
  strip.name = 'sticky-note-strip';
  strip.position.set(-CORNER / 2, STICKY_NOTE_HEIGHT / 2 - 0.01 - STRIP_HEIGHT / 2, 0.012);
  root.add(body, face, strip);

  const text = createScalableLabel(
    options.text ?? '',
    STICKY_NOTE_WIDTH - 0.05,
    STICKY_NOTE_HEIGHT - 0.03 - STRIP_HEIGHT - 0.03,
    { wrap: true, backplate: false, align: 'left' },
  );
  text.name = 'sticky-note-text';
  text.position.set(0, -(STRIP_HEIGHT + 0.01) / 2, 0.014);
  root.add(text);

  const close = createScalableLabel('×', CORNER, CORNER, { background: '#223946' });
  close.name = 'sticky-note-close';
  close.position.set(STICKY_NOTE_WIDTH / 2 - CORNER / 2, STICKY_NOTE_HEIGHT / 2 - CORNER / 2, 0.02);
  close.userData.inputAction = 'widgetControl';
  close.userData.helpText = 'Delete this note';
  const confirm = createScalableLabel('Delete?', CONFIRM_WIDTH, CORNER, {
    background: '#5a2626',
    border: '#d8605a',
  });
  confirm.name = 'sticky-note-confirm';
  confirm.position.set(
    STICKY_NOTE_WIDTH / 2 - CONFIRM_WIDTH / 2,
    STICKY_NOTE_HEIGHT / 2 - CORNER / 2,
    0.022,
  );
  // The scene's close path deletes the note and its stored text.
  confirm.userData.inputAction = 'closeWidget';
  confirm.userData.helpText = 'Press again to delete this note';
  confirm.visible = false;
  root.add(close, confirm);

  let armedUntil: number | null = null;
  let disposed = false;
  const disarm = (): void => {
    armedUntil = null;
    confirm.visible = false;
    close.visible = true;
  };
  const activate = (target: THREE.Object3D): void => {
    if (disposed || target !== close) return;
    armedUntil = Date.now() + STICKY_NOTE_CONFIRM_MS;
    close.visible = false;
    confirm.visible = true;
  };
  const update = (nowMs: number): void => {
    if (!disposed && armedUntil !== null && nowMs >= armedUntil) disarm();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = id;
    object.userData.widgetKind = STICKY_NOTE_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  return { root, update, dispose, activate };
}

/**
 * Where Pin as note puts a new note, from the viewer's heading: in view, up and right of the
 * keyboard panel's transcript. The note counts as placed there, so recenter leaves it.
 */
export const STICKY_NOTE_PIN_OFFSET: readonly [number, number, number] = [0.32, 0.16, -0.85];

/** Later notes step nearer and toward the centre from `base`, wrapping after six. */
export function stickyNoteSpawnOffset(
  base: readonly [number, number, number],
  slot: number,
): [number, number, number] {
  const step = Math.max(0, Math.floor(slot)) % 6;
  return [base[0] - Math.sign(base[0]) * step * 0.07, base[1] - step * 0.04, base[2] + step * 0.03];
}
