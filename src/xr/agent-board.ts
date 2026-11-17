import { applyUIEnvironment, createScalableLabel, updateScalableLabel } from '@par/xr-workspace';
import * as THREE from 'three';
import {
  AGENT_BOARD_ROWS_DEFAULT,
  type AgentRosterRow,
  agentStateTone,
  formatAge,
  sortAgentRows,
} from '../workspace/agent-roster';
import { AGENT_TONE_COLORS } from './hierarchy-navigator';
import type { AgentRosterConsumer } from './widget-types';
import { disposeOwned, type Widget } from './widgets';

/**
 * Default rows per page on the XR agent board, shared with the settings validator; the
 * board rebuilds its geometry when the setting changes.
 */
export const AGENT_BOARD_MAX_ROWS = AGENT_BOARD_ROWS_DEFAULT;

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

/** Board height for a rows-per-page value. */
export const agentBoardHeight = (maxRows: number): number =>
  0.04 + HEADER_HEIGHT + maxRows * ROW_PITCH + FOOTER_HEIGHT;
const topEdge = (maxRows: number): number => agentBoardHeight(maxRows) / 2;
const rowsTop = (maxRows: number): number => topEdge(maxRows) - 0.02 - HEADER_HEIGHT;

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

/** What the builder hands back so the widget can render, tick and rebuild. */
interface BoardRefs {
  header: THREE.Mesh;
  empty: THREE.Mesh;
  pager: { prev: THREE.Mesh; label: THREE.Mesh; next: THREE.Mesh };
  pool: BoardRow[];
}

/**
 * The rows the board's first page shows, in slot order. Urgency (attention or stalled, then
 * state priority) only picks which agents fill the capped slots. Slots are sticky: an agent
 * keeps the slot it held in `previous`, a newcomer takes a vacated slot, and only a departure
 * with no newcomer closes the gap, so a state flip never moves a row, and its pane, under the
 * ray. Later pages list the rest through `agentBoardPage`.
 */
export function agentBoardRows(
  rows: readonly AgentRosterRow[],
  previous: readonly string[] = [],
  maxRows: number = AGENT_BOARD_MAX_ROWS,
): AgentRosterRow[] {
  const urgent = (row: AgentRosterRow): number =>
    row.stalled || agentStateTone(row.state) === 'attention' ? 0 : 1;
  const chosen = new Map(
    sortAgentRows(rows, 'priority')
      .sort((left, right) => urgent(left) - urgent(right))
      .slice(0, maxRows)
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

/**
 * Pages the roster spans at `maxRows` rows per page; at least one.
 */
export function agentBoardPageCount(
  rows: readonly AgentRosterRow[],
  maxRows: number = AGENT_BOARD_MAX_ROWS,
): number {
  if (rows.length <= maxRows) return 1;
  return 1 + Math.ceil((rows.length - maxRows) / maxRows);
}

/**
 * The rows page `page` (0-based) shows. Page 0 keeps the sticky urgent-first slot selection;
 * later pages list the agents left off page 0 in priority sort order, in that order. The page
 * clamps into range, so an out-of-range page shows the closest valid one.
 */
export function agentBoardPage(
  rows: readonly AgentRosterRow[],
  previous: readonly string[] = [],
  page = 0,
  maxRows: number = AGENT_BOARD_MAX_ROWS,
): AgentRosterRow[] {
  const shown = Math.max(0, Math.min(page, agentBoardPageCount(rows, maxRows) - 1));
  const pageZero = agentBoardRows(rows, previous, maxRows);
  if (shown === 0) return pageZero;
  const pageZeroIds = new Set(pageZero.map((row) => row.paneId));
  return sortAgentRows(
    rows.filter((row) => !pageZeroIds.has(row.paneId)),
    'priority',
  ).slice((shown - 1) * maxRows, shown * maxRows);
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

/** The pager and rows surface the registry subscribes; beyond `Widget` and the roster feed. */
export interface AgentBoardPager {
  /** Rebuilds the board geometry for a new rows-per-page value. */
  setAgentBoardMaxRows(maxRows: number): void;
  /** Steps the page from a pager button hit (`userData.agentBoardAction`). */
  activate(target: THREE.Object3D): void;
}

export function createAgentBoardWidget(
  envMap: THREE.Texture | null = null,
  options: { maxRows?: number } = {},
): Widget & AgentRosterConsumer & AgentBoardPager {
  const widgetId = `agent-board-${nextBoardId++}`;
  const root = new THREE.Group();
  root.name = widgetId;
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);

  let maxRows = options.maxRows ?? AGENT_BOARD_MAX_ROWS;
  let page = 0;
  let lastRoster: readonly AgentRosterRow[] = [];
  let slotIds: string[] = [];
  let disposed = false;
  let lastSecond = -1;
  let header!: THREE.Mesh;
  let empty!: THREE.Mesh;
  let pager!: BoardRefs['pager'];
  let pool: BoardRow[] = [];

  const build = (rows: number): void => {
    const height = agentBoardHeight(rows);
    const top = topEdge(rows);
    const rowsY = rowsTop(rows);
    const footerY = rowsY - rows * ROW_PITCH - FOOTER_HEIGHT / 2;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(AGENT_BOARD_WIDTH, height, 0.045),
      lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
    );
    body.name = 'agent-board-body';
    body.position.z = -0.012;
    body.userData.inputAction = 'grabWidget';
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(AGENT_BOARD_WIDTH - 0.035, height - 0.035, 0.025),
      lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
    );
    face.name = 'agent-board-face';
    face.position.z = 0.014;
    face.userData.inputAction = 'grabWidget';
    root.add(body, face);

    // Same width and x as the row name labels, so the left-aligned text shares their column.
    const headerLabel = createScalableLabel('Agents', NAME_WIDTH, HEADER_HEIGHT * 0.8, {
      backplate: false,
      align: 'left',
    });
    headerLabel.name = 'agent-board-header';
    headerLabel.position.set(
      -ROW_WIDTH / 2 + 0.05 + NAME_WIDTH / 2,
      top - 0.02 - HEADER_HEIGHT / 2,
      0.03,
    );
    headerLabel.userData.inputAction = 'grabWidget';
    root.add(headerLabel);
    header = headerLabel;

    const close = createScalableLabel('×', 0.055, 0.055, { background: '#223946' });
    close.name = 'agent-board-close';
    close.position.set(AGENT_BOARD_WIDTH / 2 - 0.055 / 2, top - 0.055 / 2, 0.04);
    close.userData.inputAction = 'closeWidget';
    close.userData.helpText = 'Close the agent board';
    root.add(close);

    const emptyLabel = createScalableLabel('No agents reporting', ROW_WIDTH * 0.7, TEXT_HEIGHT, {
      backplate: false,
    });
    emptyLabel.name = 'agent-board-empty';
    emptyLabel.position.set(0, rowsY - ROW_PITCH * 1.5, 0.03);
    emptyLabel.userData.inputAction = 'grabWidget';
    root.add(emptyLabel);
    empty = emptyLabel;

    // The pager sits where the overflow line was; the buttons ride the widget-control path.
    const prev = createScalableLabel('‹', 0.05, FOOTER_HEIGHT * 0.8, { backplate: false });
    prev.name = 'agent-board-page-prev';
    prev.position.set(-0.09, footerY, 0.03);
    prev.userData.inputAction = 'widgetControl';
    prev.userData.agentBoardAction = 'prev';
    prev.userData.helpText = 'Previous agents page';
    prev.visible = false;
    const label = createScalableLabel('', 0.1, FOOTER_HEIGHT * 0.8, { backplate: false });
    label.name = 'agent-board-page-label';
    label.position.set(0, footerY, 0.03);
    label.userData.inputAction = 'grabWidget';
    label.visible = false;
    const next = createScalableLabel('›', 0.05, FOOTER_HEIGHT * 0.8, { backplate: false });
    next.name = 'agent-board-page-next';
    next.position.set(0.09, footerY, 0.03);
    next.userData.inputAction = 'widgetControl';
    next.userData.agentBoardAction = 'next';
    next.userData.helpText = 'Next agents page';
    next.visible = false;
    root.add(prev, label, next);
    pager = { prev, label, next };

    const swatchGeometry = new THREE.CircleGeometry(0.013, 24);
    pool = [];
    for (let index = 0; index < rows; index += 1) {
      const group = new THREE.Group();
      group.name = `agent-board-row-${index + 1}`;
      group.position.set(0, rowsY - ROW_PITCH * index - ROW_PITCH / 2, 0.03);
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
    root.traverse((object) => {
      object.userData.widgetId = widgetId;
      object.userData.widgetKind = 'agent-board';
    });
  };

  build(maxRows);

  const render = (): void => {
    if (disposed) return;
    const pageCount = agentBoardPageCount(lastRoster, maxRows);
    page = Math.max(0, Math.min(page, pageCount - 1));
    const pageZero = agentBoardRows(lastRoster, slotIds, maxRows);
    slotIds = pageZero.map((row) => row.paneId);
    const ordered = page === 0 ? pageZero : agentBoardPage(lastRoster, slotIds, page, maxRows);
    const nowMs = Date.now();
    setText(header, lastRoster.length ? `Agents · ${lastRoster.length}` : 'Agents');
    empty.visible = lastRoster.length === 0;
    pager.label.visible = pager.prev.visible = pager.next.visible = pageCount > 1;
    if (pageCount > 1) setText(pager.label, `${page + 1}/${pageCount}`);
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

  const setAgentRoster = (rows: readonly AgentRosterRow[]): void => {
    if (disposed) return;
    lastRoster = rows;
    render();
  };

  const setAgentBoardMaxRows = (rows: number): void => {
    if (disposed || rows === maxRows) return;
    maxRows = rows;
    disposeOwned(root);
    root.clear();
    build(rows);
    render();
  };

  const activate = (target: THREE.Object3D): void => {
    if (disposed) return;
    const action = target.userData?.agentBoardAction;
    if (action === 'next') page += 1;
    else if (action === 'prev') page -= 1;
    else return;
    render();
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
    object.userData.inputAction ??= 'grabWidget';
  });
  setAgentRoster([]);
  return { root, update, dispose, setAgentRoster, setAgentBoardMaxRows, activate };
}
