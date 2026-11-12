import * as THREE from 'three';
import {
  type AgentRosterRow,
  agentStateTone,
  formatAge,
  sortAgentRows,
} from '../workspace/agent-roster';
import { AGENT_TONE_COLORS } from './hierarchy-navigator';
import { createScalableLabel, updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

/** Rows shown before the "+N more" line; sized so text stays legible at spawn distance. */
export const AGENT_BOARD_MAX_ROWS = 6;

export const AGENT_BOARD_WIDTH = 0.84;
const ROW_WIDTH = AGENT_BOARD_WIDTH - 0.06;
const ROW_HEIGHT = 0.07;
const ROW_PITCH = 0.082;
// Row text planes are shorter than the row so the font cap (0.58 × height) is uniform, and
// names clip to a length that fits that cap instead of shrinking per row.
const TEXT_HEIGHT = 0.042;
const NAME_WIDTH = 0.52;
const NAME_CHARACTERS = 34;
const HEADER_HEIGHT = 0.07;
const FOOTER_HEIGHT = 0.05;
export const AGENT_BOARD_HEIGHT =
  0.04 + HEADER_HEIGHT + AGENT_BOARD_MAX_ROWS * ROW_PITCH + FOOTER_HEIGHT;
const TOP = AGENT_BOARD_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT;

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const ROW_BACKGROUND = '#15232b';
const STALLED_BACKGROUND = '#33281a';
const STALLED_BORDER = '#c99545';

let nextBoardId = 1;

interface BoardRow {
  group: THREE.Group;
  parts: THREE.Object3D[];
  swatch: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  name: THREE.Mesh;
  stalled: THREE.Mesh;
  age: THREE.Mesh;
  row: AgentRosterRow | null;
}

/**
 * The rows the board shows, in slot order. Urgency (attention or stalled, then state priority)
 * only picks which agents fill the capped slots. Slots are sticky: an agent keeps the slot it
 * held in `previous`, a newcomer takes a vacated slot, and only a departure with no newcomer
 * closes the gap, so a state flip never moves a row, and its pane, under the ray.
 */
export function agentBoardRows(
  rows: readonly AgentRosterRow[],
  previous: readonly string[] = [],
): AgentRosterRow[] {
  const urgent = (row: AgentRosterRow): number =>
    row.stalled || agentStateTone(row.state) === 'attention' ? 0 : 1;
  const chosen = new Map(
    sortAgentRows(rows, 'priority')
      .sort((left, right) => urgent(left) - urgent(right))
      .slice(0, AGENT_BOARD_MAX_ROWS)
      .map((row) => [row.paneId, row]),
  );
  const kept = new Set(previous.filter((id) => chosen.has(id)));
  const newcomers = sortAgentRows(
    [...chosen.values()].filter((row) => !kept.has(row.paneId)),
    'pane',
  );
  const slots: (AgentRosterRow | undefined)[] = previous.map((id) =>
    kept.has(id) ? chosen.get(id) : newcomers.shift(),
  );
  return [...slots, ...newcomers].filter((row): row is AgentRosterRow => Boolean(row));
}

export function agentBoardName(row: AgentRosterRow): string {
  return [row.state, row.agent, row.title].filter(Boolean).join(' · ');
}

function clip(text: string): string {
  const characters = Array.from(text);
  return characters.length <= NAME_CHARACTERS
    ? text
    : `${characters.slice(0, NAME_CHARACTERS - 1).join('')}…`;
}

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

export function createAgentBoardWidget(envMap: THREE.Texture | null = null): Widget {
  const widgetId = `agent-board-${nextBoardId++}`;
  const root = new THREE.Group();
  root.name = widgetId;
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(AGENT_BOARD_WIDTH, AGENT_BOARD_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'agent-board-body';
  body.position.z = -0.012;
  body.userData.inputAction = 'grabWidget';
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(AGENT_BOARD_WIDTH - 0.035, AGENT_BOARD_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'agent-board-face';
  face.position.z = 0.014;
  face.userData.inputAction = 'grabWidget';
  root.add(body, face);

  // Same width and x as the row name labels, so the left-aligned text shares their column.
  const header = createScalableLabel('Agents', NAME_WIDTH, HEADER_HEIGHT * 0.8, {
    backplate: false,
    align: 'left',
  });
  header.name = 'agent-board-header';
  header.position.set(-ROW_WIDTH / 2 + 0.05 + NAME_WIDTH / 2, TOP - 0.02 - HEADER_HEIGHT / 2, 0.03);
  header.userData.inputAction = 'grabWidget';
  root.add(header);

  const close = createScalableLabel('×', 0.055, 0.055, { background: '#223946' });
  close.name = 'agent-board-close';
  close.position.set(AGENT_BOARD_WIDTH / 2 - 0.055 / 2, TOP - 0.055 / 2, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the agent board';
  root.add(close);

  const empty = createScalableLabel('No agents reporting', ROW_WIDTH * 0.7, TEXT_HEIGHT, {
    backplate: false,
  });
  empty.name = 'agent-board-empty';
  empty.position.set(0, ROWS_TOP - ROW_PITCH * 1.5, 0.03);
  empty.userData.inputAction = 'grabWidget';
  root.add(empty);

  const overflow = createScalableLabel('', ROW_WIDTH * 0.4, FOOTER_HEIGHT * 0.8, {
    backplate: false,
  });
  overflow.name = 'agent-board-overflow';
  overflow.position.set(0, ROWS_TOP - AGENT_BOARD_MAX_ROWS * ROW_PITCH - FOOTER_HEIGHT / 2, 0.03);
  overflow.userData.inputAction = 'grabWidget';
  overflow.visible = false;
  root.add(overflow);

  const swatchGeometry = new THREE.CircleGeometry(0.013, 24);
  const pool: BoardRow[] = [];
  for (let index = 0; index < AGENT_BOARD_MAX_ROWS; index += 1) {
    const group = new THREE.Group();
    group.name = `agent-board-row-${index + 1}`;
    group.position.set(0, ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2, 0.03);
    group.visible = false;
    const plate = createScalableLabel('', ROW_WIDTH, ROW_HEIGHT, { background: ROW_BACKGROUND });
    plate.name = 'agent-board-row-plate';
    const swatch = new THREE.Mesh(
      swatchGeometry,
      new THREE.MeshBasicMaterial({ color: AGENT_TONE_COLORS.unknown }),
    );
    swatch.name = 'agent-board-row-state';
    swatch.position.set(-ROW_WIDTH / 2 + 0.03, 0, 0.004);
    const name = createScalableLabel('', NAME_WIDTH, TEXT_HEIGHT, {
      backplate: false,
      align: 'left',
    });
    name.name = 'agent-board-row-name';
    name.position.set(-ROW_WIDTH / 2 + 0.05 + NAME_WIDTH / 2, 0, 0.004);
    const stalled = createScalableLabel('stalled', 0.11, ROW_HEIGHT * 0.66, {
      background: STALLED_BACKGROUND,
      border: STALLED_BORDER,
    });
    stalled.name = 'agent-board-row-stalled';
    stalled.position.set(ROW_WIDTH / 2 - 0.175, 0, 0.004);
    const age = createScalableLabel('', 0.1, TEXT_HEIGHT, { backplate: false });
    age.name = 'agent-board-row-age';
    age.position.set(ROW_WIDTH / 2 - 0.06, 0, 0.004);
    group.add(plate, swatch, name, stalled, age);
    root.add(group);
    pool.push({
      group,
      parts: [plate, swatch, name, stalled, age],
      swatch,
      name,
      stalled,
      age,
      row: null,
    });
  }

  let lastSecond = -1;
  let disposed = false;
  let slotIds: string[] = [];
  const setAgentRoster = (rows: readonly AgentRosterRow[]): void => {
    if (disposed) return;
    const ordered = agentBoardRows(rows, slotIds);
    slotIds = ordered.map((row) => row.paneId);
    const nowMs = Date.now();
    setText(header, rows.length ? `Agents · ${rows.length}` : 'Agents');
    empty.visible = rows.length === 0;
    const hidden = rows.length - ordered.length;
    overflow.visible = hidden > 0;
    if (hidden) setText(overflow, `+${hidden} more`);
    pool.forEach((slot, index) => {
      const row = ordered[index] ?? null;
      slot.row = row;
      slot.group.visible = Boolean(row);
      for (const part of slot.parts) {
        part.userData.inputAction = row ? 'selectAgentPane' : 'grabWidget';
        part.userData.agentPaneId = row?.paneId;
      }
      if (!row) return;
      const name = agentBoardName(row);
      for (const part of slot.parts)
        part.userData.helpText = `${name}${row.stalled ? ' · stalled' : ''} · Open pane`;
      slot.swatch.material.color.set(AGENT_TONE_COLORS[agentStateTone(row.state)]);
      setText(slot.name, clip(name));
      slot.stalled.visible = row.stalled;
      setText(slot.age, formatAge(row.lastActivityAt, nowMs));
    });
    lastSecond = Math.floor(nowMs / 1000);
  };

  // Called from the render loop; ages re-render at most once a second.
  const update = (nowMs: number): void => {
    if (disposed) return;
    const second = Math.floor(nowMs / 1000);
    if (second === lastSecond) return;
    lastSecond = second;
    for (const slot of pool)
      if (slot.row) setText(slot.age, formatAge(slot.row.lastActivityAt, nowMs));
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = 'agent-board';
  });
  setAgentRoster([]);
  return { root, update, dispose, setAgentRoster };
}
