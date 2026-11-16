import { applyUIEnvironment, createScalableLabel, updateScalableLabel } from '@par/xr-workspace';
import * as THREE from 'three';
import { type DiagnosticEntry, diagnostics } from '../diagnostics';
import { formatAge } from '../workspace/agent-roster';
import { disposeOwned, type Widget } from './widgets';

/** Rows shown before the "+N more" line. */
export const DIAGNOSTICS_MAX_ROWS = 8;

const WIDTH = 0.72;
const ROW_WIDTH = WIDTH - 0.06;
const ROW_HEIGHT = 0.07;
const ROW_PITCH = 0.082;
const TEXT_HEIGHT = 0.042;
const LABEL_WIDTH = 0.44;
const LABEL_CHARACTERS = 24;
const HEADER_HEIGHT = 0.07;
const FOOTER_HEIGHT = 0.05;
export const DIAGNOSTICS_WIDTH = WIDTH;
export const DIAGNOSTICS_HEIGHT =
  0.04 + HEADER_HEIGHT + DIAGNOSTICS_MAX_ROWS * ROW_PITCH + FOOTER_HEIGHT;
const TOP = DIAGNOSTICS_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT;
const FOOTER_Y = ROWS_TOP - DIAGNOSTICS_MAX_ROWS * ROW_PITCH - FOOTER_HEIGHT / 2;

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const ROW_BACKGROUND = '#15232b';
const CLEAR_BACKGROUND = '#223946';

let nextWidgetId = 1;

interface DiagnosticsRow {
  group: THREE.Group;
  parts: THREE.Object3D[];
  label: THREE.Mesh;
  age: THREE.Mesh;
  entry: DiagnosticEntry | null;
}

function clip(text: string): string {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length <= LABEL_CHARACTERS
    ? characters.join('')
    : `${characters.slice(0, LABEL_CHARACTERS - 1).join('')}…`;
}

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

/**
 * The last time a Diagnostics widget refreshed, which is while it is spawned in the scene. The
 * Widgets panel marks the entry with a dot while the log holds entries newer than this.
 */
let lastSeenAt = 0;

/** Records that the log has been seen up to `nowMs`; called by the widget once per frame. */
export const markDiagnosticsSeen = (nowMs: number): void => {
  lastSeenAt = nowMs;
};

/** True when the log holds entries newer than the widget's last refresh. */
export const hasUnseenDiagnostics = (): boolean => {
  const newest = diagnostics.entries()[0];
  return newest !== undefined && newest.at > lastSeenAt;
};

export interface DiagnosticsConsumer {
  setEntries(entries: readonly DiagnosticEntry[]): void;
}

/**
 * The in-headset diagnostics log: a title with the entry count, the newest eight entries as
 * `scope · message · age` (×N when a report repeats) and a Clear button. It re-renders only when
 * the log notifies and refreshes ages at most once a second through `update`.
 */
export function createDiagnosticsWidget(
  envMap: THREE.Texture | null = null,
): Widget & DiagnosticsConsumer {
  const widgetId = `diagnostics-${nextWidgetId++}`;
  const root = new THREE.Group();
  root.name = widgetId;
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, DIAGNOSTICS_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'diagnostics-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.035, DIAGNOSTICS_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'diagnostics-face';
  face.position.z = 0.014;
  root.add(body, face);

  const header = createScalableLabel('Diagnostics', LABEL_WIDTH, HEADER_HEIGHT * 0.8, {
    backplate: false,
    align: 'left',
  });
  header.name = 'diagnostics-header';
  header.position.set(
    -ROW_WIDTH / 2 + 0.02 + LABEL_WIDTH / 2,
    TOP - 0.02 - HEADER_HEIGHT / 2,
    0.03,
  );
  root.add(header);

  const close = createScalableLabel('×', 0.055, 0.055, { background: CLEAR_BACKGROUND });
  close.name = 'diagnostics-close';
  close.position.set(WIDTH / 2 - 0.045, TOP - 0.045, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the diagnostics log';
  root.add(close);

  const empty = createScalableLabel('No errors', ROW_WIDTH * 0.8, TEXT_HEIGHT, {
    backplate: false,
  });
  empty.name = 'diagnostics-empty';
  empty.position.set(0, ROWS_TOP - ROW_PITCH * 1.5, 0.03);
  root.add(empty);

  const overflow = createScalableLabel('', ROW_WIDTH * 0.5, FOOTER_HEIGHT * 0.8, {
    backplate: false,
  });
  overflow.name = 'diagnostics-overflow';
  overflow.position.set(ROW_WIDTH / 2 - 0.02 - ROW_WIDTH * 0.25, FOOTER_Y, 0.03);
  overflow.visible = false;
  root.add(overflow);

  const clearButton = createScalableLabel('Clear', 0.14, 0.05, { background: CLEAR_BACKGROUND });
  clearButton.name = 'diagnostics-clear';
  clearButton.position.set(-ROW_WIDTH / 2 + 0.02 + 0.07, FOOTER_Y, 0.03);
  clearButton.userData.inputAction = 'widgetControl';
  clearButton.userData.diagnosticsAction = 'clear';
  clearButton.userData.helpText = 'Clear the diagnostics log';
  root.add(clearButton);

  const pool: DiagnosticsRow[] = [];
  for (let index = 0; index < DIAGNOSTICS_MAX_ROWS; index += 1) {
    const group = new THREE.Group();
    group.name = `diagnostics-row-${index + 1}`;
    group.position.set(0, ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2, 0.03);
    group.visible = false;
    const plate = createScalableLabel('', ROW_WIDTH, ROW_HEIGHT, { background: ROW_BACKGROUND });
    plate.name = 'diagnostics-row-plate';
    const label = createScalableLabel('', LABEL_WIDTH, TEXT_HEIGHT, {
      backplate: false,
      align: 'left',
    });
    label.name = 'diagnostics-row-label';
    label.position.set(-ROW_WIDTH / 2 + 0.03 + LABEL_WIDTH / 2, 0, 0.004);
    const age = createScalableLabel('', 0.09, TEXT_HEIGHT, { backplate: false });
    age.name = 'diagnostics-row-age';
    age.position.set(ROW_WIDTH / 2 - 0.055, 0, 0.004);
    group.add(plate, label, age);
    root.add(group);
    pool.push({ group, parts: [plate, label, age], label, age, entry: null });
  }

  let entries: readonly DiagnosticEntry[] = [];
  let lastSecond = -1;
  let disposed = false;

  const render = (nowMs = Date.now()): void => {
    setText(header, entries.length ? `Diagnostics · ${entries.length}` : 'Diagnostics');
    empty.visible = entries.length === 0;
    const shown = Math.min(entries.length, DIAGNOSTICS_MAX_ROWS);
    const hidden = entries.length - shown;
    overflow.visible = hidden > 0;
    if (hidden) setText(overflow, `+${hidden} more`);
    pool.forEach((slot, index) => {
      const entry = entries[index] ?? null;
      slot.entry = entry;
      slot.group.visible = Boolean(entry);
      for (const part of slot.parts) {
        part.userData.helpText = entry ? `${entry.scope} · ${entry.message}` : undefined;
      }
      if (!entry) return;
      setText(
        slot.label,
        clip(`${entry.count > 1 ? `×${entry.count} ` : ''}${entry.scope} · ${entry.message}`),
      );
      setText(slot.age, formatAge(entry.at, nowMs));
    });
    lastSecond = Math.floor(nowMs / 1000);
  };

  const setEntries = (next: readonly DiagnosticEntry[]): void => {
    if (disposed) return;
    entries = next;
    render();
  };

  // Called from the render loop while the widget is spawned; also marks the log seen.
  const update = (nowMs: number): void => {
    if (disposed) return;
    markDiagnosticsSeen(nowMs);
    const second = Math.floor(nowMs / 1000);
    if (second === lastSecond) return;
    lastSecond = second;
    for (const slot of pool) if (slot.entry) setText(slot.age, formatAge(slot.entry.at, nowMs));
  };

  /** The Clear button routes here through the scene's `widgetControl` dispatch. */
  const activate = (target: THREE.Object3D): void => {
    if (disposed || target.userData.diagnosticsAction !== 'clear') return;
    diagnostics.clear();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = 'diagnostics';
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  render();
  return { root, update, dispose, setEntries, activate };
}
