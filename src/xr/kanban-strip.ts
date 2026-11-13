import * as THREE from 'three';
import { defaultHostFeedSource, type HostFeedFailure, type HostFeedSource } from '../host-feed';
import { createFeedPoller, FEED_FAILURE_TEXT, isWidgetShown } from './feed-poller';
import { createScalableLabel, updateScalableLabel } from './labels';
import { PERF_TONE_COLORS } from './perf-gauge';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const KANBAN_STRIP_KIND = 'kanban-strip';
export const KANBAN_STRIP_PATH = '/kanban-strip';
export const KANBAN_STRIP_PROTOCOL = 'mux-xr-kanban-strip-v1';
/** Matches the server's 30 s CLI cache; cards change slowly. */
export const KANBAN_STRIP_POLL_MS = 45_000;
/** A focus change waits this long for the pane to settle before asking. */
export const KANBAN_STRIP_SETTLE_MS = 1_000;
export const KANBAN_STRIP_MAX_ROWS = 5;

export type StripStatus = 'in_progress' | 'blocked';
export type StripPriority = 'low' | 'medium' | 'high' | 'critical';

export interface StripCard {
  title: string;
  status: StripStatus;
  priority: StripPriority | null;
  holder: string;
  claimStale: boolean;
  approval: boolean;
}

export type KanbanStrip =
  | { state: 'ok'; project: string; cards: StripCard[]; total: number }
  | { state: 'unregistered'; project: string }
  | { state: 'outside' }
  | { state: 'remote' };

const MAX_TEXT = 120;
const visible = (value: unknown): string =>
  typeof value === 'string'
    ? Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, ' '))
        .slice(0, MAX_TEXT)
        .join('')
    : '';
const PRIORITIES: readonly StripPriority[] = ['low', 'medium', 'high', 'critical'];

/** Rebuilds the server's answer field by field, so nothing unexpected reaches the scene. */
export function parseKanbanStrip(data: unknown): KanbanStrip | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (value.state === 'outside' || value.state === 'remote') return { state: value.state };
  const project = visible(value.project);
  if (!project) return null;
  if (value.state === 'unregistered') return { state: 'unregistered', project };
  if (value.state !== 'ok' || !Array.isArray(value.cards)) return null;
  const cards: StripCard[] = [];
  for (const row of value.cards) {
    if (!row || typeof row !== 'object') continue;
    const card = row as Record<string, unknown>;
    const title = visible(card.title);
    if (!title || (card.status !== 'in_progress' && card.status !== 'blocked')) continue;
    cards.push({
      title,
      status: card.status,
      priority: PRIORITIES.includes(card.priority as StripPriority)
        ? (card.priority as StripPriority)
        : null,
      holder: visible(card.holder),
      claimStale: card.claimStale === true,
      approval: card.approval === true,
    });
  }
  const total =
    typeof value.total === 'number' && Number.isInteger(value.total) && value.total >= cards.length
      ? value.total
      : cards.length;
  return { state: 'ok', project, cards, total };
}

export type KanbanStripModel =
  | { kind: 'no-pane' }
  | { kind: 'no-cwd' }
  | { kind: 'loading' }
  | { kind: 'failed'; code: HostFeedFailure }
  | { kind: 'strip'; strip: KanbanStrip };

const FAILURE_TEXT: Record<HostFeedFailure, string> = {
  ...FEED_FAILURE_TEXT,
  disabled: 'Board feeds are off on the host',
  'not-configured': 'Board feeds are not set up on the host',
  upstream: 'Kanban board unreachable from the host',
};

export interface KanbanStripView {
  header: string;
  /** Shown instead of rows: why there are none. */
  message: string;
  cards: StripCard[];
  /** Cards beyond the visible rows. */
  hidden: number;
}

export function kanbanStripView(model: KanbanStripModel): KanbanStripView {
  const quiet = (message: string, header = 'Board'): KanbanStripView => ({
    header,
    message,
    cards: [],
    hidden: 0,
  });
  switch (model.kind) {
    case 'no-pane':
      return quiet('No pane focused');
    case 'no-cwd':
      return quiet('Directory unknown: the shell does not report its cwd');
    case 'loading':
      return quiet('Checking…');
    case 'failed':
      return quiet(FAILURE_TEXT[model.code]);
  }
  const { strip } = model;
  if (strip.state === 'outside') return quiet('Not inside a ~/Repos project');
  if (strip.state === 'remote') return quiet('Remote shell: the pane is on another host');
  if (strip.state === 'unregistered')
    return quiet(`${strip.project} is not on the board`, `Board · ${strip.project}`);
  const approvals = strip.cards.filter((card) => card.approval).length;
  const header = `Board · ${strip.project}${approvals ? ` · ${approvals} approval` : ''}`;
  if (!strip.cards.length) return quiet('No in-progress or blocked cards', header);
  const cards = strip.cards.slice(0, KANBAN_STRIP_MAX_ROWS);
  return { header, message: '', cards, hidden: Math.max(0, strip.total - cards.length) };
}

const STATUS_TEXT: Record<StripStatus, string> = { in_progress: 'doing', blocked: 'blocked' };
const PRIORITY_TEXT: Record<StripPriority, string> = {
  low: 'low',
  medium: 'med',
  high: 'high',
  critical: 'crit',
};

const clip = (text: string, length: number): string => {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length <= length
    ? characters.join('')
    : `${characters.slice(0, length - 1).join('')}…`;
};

export function formatHolder(card: StripCard): string {
  if (!card.holder) return 'unclaimed';
  return card.claimStale ? `${clip(card.holder, 10)} (stale)` : clip(card.holder, 17);
}

export const KANBAN_STATUS_COLORS: Record<StripStatus, number> = {
  in_progress: 0x5a9fd8,
  blocked: PERF_TONE_COLORS.warn,
};
export const KANBAN_APPROVAL_COLOR = 0xc77ddb;

const WIDTH = 0.72;
const PAD = 0.03;
const HEADER_HEIGHT = 0.065;
const ROW_PITCH = 0.052;
const ROW_TEXT = 0.038;
const FOOTER_HEIGHT = 0.045;
export const KANBAN_STRIP_WIDTH = WIDTH;
export const KANBAN_STRIP_HEIGHT =
  0.04 + HEADER_HEIGHT + KANBAN_STRIP_MAX_ROWS * ROW_PITCH + FOOTER_HEIGHT;
const TOP = KANBAN_STRIP_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT;
const FONT = 0.021;
const LEFT = -WIDTH / 2 + PAD;
const MARK_X = LEFT + 0.003;
const TONE_X = LEFT + 0.02;
const TITLE = { x: LEFT + 0.04, width: 0.33 };
const STATUS = { x: TITLE.x + TITLE.width + 0.005, width: 0.085 };
const PRIORITY = { x: STATUS.x + STATUS.width, width: 0.06 };
const HOLDER = {
  x: PRIORITY.x + PRIORITY.width,
  width: WIDTH / 2 - PAD - (PRIORITY.x + PRIORITY.width),
};

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;

let nextKanbanStripId = 1;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

function cell(text: string, column: { x: number; width: number }, y: number): THREE.Mesh {
  const label = createScalableLabel(text, column.width, ROW_TEXT, {
    backplate: false,
    align: 'left',
    fontSize: FONT,
  });
  label.position.set(column.x + column.width / 2, y, 0.03);
  return label;
}

interface Slot {
  mark: THREE.Mesh;
  dot: THREE.Mesh;
  warning: THREE.Mesh;
  title: THREE.Mesh;
  status: THREE.Mesh;
  priority: THREE.Mesh;
  holder: THREE.Mesh;
  parts: THREE.Object3D[];
}

export interface KanbanStripWidgetOptions {
  source?: HostFeedSource<KanbanStrip>;
  pollMs?: number;
  retryStore?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  now?: () => number;
  firstPollDelayMs?: number;
}

export function createKanbanStripWidget(
  envMap: THREE.Texture | null = null,
  options: KanbanStripWidgetOptions = {},
): Widget {
  const widgetId = `${KANBAN_STRIP_KIND}-${nextKanbanStripId++}`;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, KANBAN_STRIP_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'kanban-strip-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.035, KANBAN_STRIP_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'kanban-strip-face';
  face.position.z = 0.014;
  root.add(body, face);

  const HEADER_WIDTH = WIDTH - PAD * 2 - 0.06;
  const header = createScalableLabel('Board', HEADER_WIDTH, HEADER_HEIGHT * 0.7, {
    backplate: false,
    align: 'left',
  });
  header.name = 'kanban-strip-header';
  header.position.set(LEFT + HEADER_WIDTH / 2, TOP - 0.02 - HEADER_HEIGHT / 2, 0.03);
  root.add(header);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'kanban-strip-close';
  close.position.set(WIDTH / 2 - 0.045, TOP - 0.045, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the kanban strip';
  root.add(close);

  const message = createScalableLabel('', WIDTH - PAD * 2, ROW_TEXT, {
    backplate: false,
    fontSize: FONT,
  });
  message.name = 'kanban-strip-message';
  message.position.set(0, ROWS_TOP - ROW_PITCH * 1.5, 0.03);
  root.add(message);

  const overflow = createScalableLabel('', WIDTH * 0.4, FOOTER_HEIGHT * 0.8, {
    backplate: false,
    fontSize: FONT,
  });
  overflow.name = 'kanban-strip-overflow';
  overflow.position.set(0, ROWS_TOP - KANBAN_STRIP_MAX_ROWS * ROW_PITCH - FOOTER_HEIGHT / 2, 0.03);
  overflow.visible = false;
  root.add(overflow);

  // Text is always white (labels.ts), so status is a shape plus a colour, as on the perf gauge.
  const statusMaterials: Record<StripStatus, THREE.MeshBasicMaterial> = {
    in_progress: new THREE.MeshBasicMaterial({ color: KANBAN_STATUS_COLORS.in_progress }),
    blocked: new THREE.MeshBasicMaterial({ color: KANBAN_STATUS_COLORS.blocked }),
  };
  const markMaterial = new THREE.MeshBasicMaterial({ color: KANBAN_APPROVAL_COLOR });
  const dotGeometry = new THREE.CircleGeometry(0.011, 20);
  const warningGeometry = new THREE.CircleGeometry(0.015, 3, Math.PI / 2);
  const markGeometry = new THREE.PlaneGeometry(0.007, ROW_PITCH * 0.78);

  const slots: Slot[] = [];
  for (let index = 0; index < KANBAN_STRIP_MAX_ROWS; index += 1) {
    const y = ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2;
    const prefix = `kanban-strip-row-${index + 1}`;
    const mark = new THREE.Mesh(markGeometry, markMaterial);
    mark.name = `${prefix}-approval`;
    mark.position.set(MARK_X, y, 0.03);
    mark.userData.helpText = 'Awaiting approval';
    const dot = new THREE.Mesh(dotGeometry, statusMaterials.in_progress);
    dot.name = `${prefix}-tone`;
    dot.position.set(TONE_X, y, 0.03);
    const warning = new THREE.Mesh(warningGeometry, statusMaterials.blocked);
    warning.name = `${prefix}-warning`;
    warning.position.set(TONE_X, y - 0.003, 0.03);
    const title = cell('', TITLE, y);
    title.name = `${prefix}-title`;
    const status = cell('', STATUS, y);
    status.name = `${prefix}-status`;
    const priority = cell('', PRIORITY, y);
    priority.name = `${prefix}-priority`;
    const holder = cell('', HOLDER, y);
    holder.name = `${prefix}-holder`;
    const parts = [mark, dot, warning, title, status, priority, holder];
    for (const part of parts) part.visible = false;
    root.add(...parts);
    slots.push({ mark, dot, warning, title, status, priority, holder, parts });
  }

  let disposed = false;
  let model: KanbanStripModel = { kind: 'no-pane' };
  let paneId: string | null = null;
  let cwd: string | null = null;
  let host: string | null = null;
  let settleUntil = Number.NEGATIVE_INFINITY;

  const render = (): void => {
    const view = kanbanStripView(model);
    setText(header, view.header);
    message.visible = view.message !== '';
    setText(message, view.message);
    overflow.visible = view.hidden > 0;
    if (view.hidden > 0) setText(overflow, `+${view.hidden} more`);
    slots.forEach((slot, index) => {
      const card = view.cards[index];
      for (const part of slot.parts) part.visible = Boolean(card);
      if (!card) return;
      slot.mark.visible = card.approval;
      slot.dot.visible = card.status === 'in_progress';
      slot.warning.visible = card.status === 'blocked';
      setText(slot.title, clip(card.title, 34));
      slot.title.userData.helpText = card.title;
      setText(slot.status, STATUS_TEXT[card.status]);
      setText(slot.priority, card.priority ? PRIORITY_TEXT[card.priority] : '');
      setText(slot.holder, formatHolder(card));
    });
  };

  const poller = createFeedPoller<KanbanStrip>({
    source:
      options.source ??
      defaultHostFeedSource(KANBAN_STRIP_PATH, KANBAN_STRIP_PROTOCOL, parseKanbanStrip),
    pollMs: options.pollMs ?? KANBAN_STRIP_POLL_MS,
    retryStore: options.retryStore,
    now: options.now,
    firstPollDelayMs: options.firstPollDelayMs,
    onResult: (result) => {
      if (disposed) return;
      model = result.ok
        ? { kind: 'strip', strip: result.value }
        : { kind: 'failed', code: result.code };
      render();
    },
  });

  const setFocusedPane = (
    nextPaneId: string | null,
    nextCwd: string | null,
    nextHost: string | null = null,
  ): void => {
    if (disposed || (nextPaneId === paneId && nextCwd === cwd && nextHost === host)) return;
    paneId = nextPaneId;
    cwd = nextPaneId ? nextCwd : null;
    host = nextHost;
    poller.reset();
    settleUntil = (options.now ?? Date.now)() + KANBAN_STRIP_SETTLE_MS;
    model = !paneId ? { kind: 'no-pane' } : !cwd ? { kind: 'no-cwd' } : { kind: 'loading' };
    render();
  };

  // Polls only from the scene's frame loop, so a closed, hidden or unrendered widget never asks.
  const update = (nowMs: number): void => {
    if (disposed || nowMs < settleUntil) return;
    poller.update(nowMs, isWidgetShown(root), cwd ? JSON.stringify({ cwd, host }) : null);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    poller.dispose();
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = KANBAN_STRIP_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  render();
  return { root, update, dispose, setFocusedPane };
}
