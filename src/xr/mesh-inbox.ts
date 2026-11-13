import * as THREE from 'three';
import { defaultHostFeedSource, type HostFeedFailure, type HostFeedSource } from '../host-feed';
import { type AgentRosterRow, formatAge } from '../workspace/agent-roster';
import { createFeedPoller, FEED_FAILURE_TEXT, isWidgetShown } from './feed-poller';
import { createScalableLabel, updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const MESH_INBOX_KIND = 'mesh-inbox';
export const MESH_INBOX_PATH = '/mesh-inbox';
export const MESH_INBOX_PROTOCOL = 'mux-xr-mesh-inbox-v1';
export const MESH_INBOX_POLL_MS = 30_000;
export const MESH_INBOX_MAX_ROWS = 6;

export type MeshPriority = 'interrupt' | 'next-turn';

export interface MeshMessage {
  from: string;
  to: string;
  subject: string;
  priority: MeshPriority;
  /** Milliseconds old when the streamer read the history. */
  ageMs: number;
  state: string;
  sealed: boolean;
}

export interface MeshInbox {
  host: string;
  messages: MeshMessage[];
  /** Headset clock when the answer arrived; ages count on from here. */
  receivedAt: number;
}

const MAX_SUBJECT = 80;
const MAX_ADDRESS = 96;
// Subjects come from any agent on the mesh: visible characters only, plain label text.
const visible = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' '))
        .slice(0, max)
        .join('')
        .trim()
    : '';

/** Rebuilds the server's answer field by field, so nothing unexpected reaches the scene. */
export function parseMeshInbox(data: unknown, receivedAt: number = Date.now()): MeshInbox | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  const host = visible(value.host, 64);
  if (
    typeof value.now !== 'number' ||
    !Number.isFinite(value.now) ||
    !host ||
    !Array.isArray(value.messages)
  )
    return null;
  const serverNow = value.now;
  const messages: MeshMessage[] = [];
  for (const row of value.messages) {
    if (!row || typeof row !== 'object') continue;
    const message = row as Record<string, unknown>;
    const from = visible(message.from, MAX_ADDRESS);
    const to = visible(message.to, MAX_ADDRESS);
    if (!from || !to || typeof message.ts !== 'number' || !Number.isFinite(message.ts)) continue;
    messages.push({
      from,
      to,
      subject: visible(message.subject, MAX_SUBJECT),
      priority: message.priority === 'interrupt' ? 'interrupt' : 'next-turn',
      ageMs: Math.max(0, serverNow - message.ts),
      state: visible(message.state, 16),
      sealed: message.sealed === true,
    });
  }
  return { host, messages, receivedAt };
}

/** `name@host:project` split into its parts; null for anything else, such as a broadcast. */
export function parseMeshAddress(
  address: string,
): { name: string; host: string; project: string } | null {
  const match = /^([^@\s*]+)@([^:\s*]+):([^\s*]+)$/.exec(address);
  return match ? { name: match[1] ?? '', host: match[2] ?? '', project: match[3] ?? '' } : null;
}

/** The part of an address before `@`, which is what the row shows. */
export function meshName(address: string): string {
  return address.split('@')[0] || address;
}

/**
 * The par-mux pane for a mesh recipient, from the same roster the agent board reads. par-mesh
 * addresses carry no pane, so a recipient maps only when its project has one agent pane on this
 * host, or one whose harness its name starts with (`claude-b50c` for a claude pane). Anything
 * ambiguous maps to nothing rather than to the wrong pane.
 */
export function recipientPane(
  address: string,
  host: string,
  roster: readonly AgentRosterRow[],
): string | null {
  const parsed = parseMeshAddress(address);
  if (!parsed || parsed.host !== host) return null;
  const inProject = roster.filter((row) => row.project === parsed.project);
  if (inProject.length === 1) return inProject[0]?.paneId ?? null;
  const byHarness = inProject.filter(
    (row) => row.agent && (parsed.name === row.agent || parsed.name.startsWith(`${row.agent}-`)),
  );
  return byHarness.length === 1 ? (byHarness[0]?.paneId ?? null) : null;
}

export type MeshInboxModel =
  | { kind: 'loading' }
  | { kind: 'failed'; code: HostFeedFailure }
  | { kind: 'inbox'; inbox: MeshInbox };

const FAILURE_TEXT: Record<HostFeedFailure, string> = {
  ...FEED_FAILURE_TEXT,
  disabled: 'Mesh inbox is off on the host',
  'not-configured': 'par-mesh is not set up on the host',
  upstream: 'par-mesh history unreachable on the host',
};

export interface MeshInboxRow {
  route: string;
  subject: string;
  priority: string;
  interrupt: boolean;
  age: string;
  help: string;
  paneId: string | null;
}

export interface MeshInboxView {
  header: string;
  message: string;
  rows: MeshInboxRow[];
}

const clip = (text: string, length: number): string => {
  const characters = Array.from(text);
  return characters.length <= length ? text : `${characters.slice(0, length - 1).join('')}…`;
};

export function meshInboxView(
  model: MeshInboxModel,
  nowMs: number,
  roster: readonly AgentRosterRow[] = [],
): MeshInboxView {
  const quiet = (message: string): MeshInboxView => ({ header: 'Mesh inbox', message, rows: [] });
  if (model.kind === 'loading') return quiet('Checking…');
  if (model.kind === 'failed') return quiet(FAILURE_TEXT[model.code]);
  const { inbox } = model;
  if (!inbox.messages.length) return quiet('No recent messages');
  const elapsed = Math.max(0, nowMs - inbox.receivedAt);
  const rows = inbox.messages.slice(0, MESH_INBOX_MAX_ROWS).map((message) => {
    const route = `${clip(meshName(message.from), 12)} → ${clip(meshName(message.to), 12)}`;
    const subject = message.subject || (message.sealed ? '(sealed)' : '(no subject)');
    const paneId = recipientPane(message.to, inbox.host, roster);
    return {
      route,
      subject: clip(subject, 30),
      priority: message.priority === 'interrupt' ? 'int' : 'next',
      interrupt: message.priority === 'interrupt',
      age: formatAge(nowMs - message.ageMs - elapsed, nowMs),
      help: `${message.from} → ${message.to}: ${subject}${paneId ? ' · Open recipient pane' : ''}`,
      paneId,
    };
  });
  return { header: `Mesh inbox · ${inbox.host}`, message: '', rows };
}

export const MESH_INTERRUPT_COLOR = 0xe07a3c;
const INTERRUPT_ROW_COLOR = 0x3a2618;

const WIDTH = 0.84;
const PAD = 0.03;
const HEADER_HEIGHT = 0.065;
const ROW_PITCH = 0.052;
const ROW_TEXT = 0.038;
export const MESH_INBOX_WIDTH = WIDTH;
export const MESH_INBOX_HEIGHT = 0.04 + HEADER_HEIGHT + MESH_INBOX_MAX_ROWS * ROW_PITCH + 0.02;
const TOP = MESH_INBOX_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT;
const FONT = 0.021;
const LEFT = -WIDTH / 2 + PAD;
const ROUTE = { x: LEFT + 0.016, width: 0.29 };
const SUBJECT = { x: ROUTE.x + ROUTE.width + 0.005, width: 0.35 };
const PRIORITY = { x: SUBJECT.x + SUBJECT.width, width: 0.05 };
const AGE = {
  x: PRIORITY.x + PRIORITY.width,
  width: WIDTH / 2 - PAD - (PRIORITY.x + PRIORITY.width),
};

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;

let nextMeshInboxId = 1;

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
  tint: THREE.Mesh;
  accent: THREE.Mesh;
  route: THREE.Mesh;
  subject: THREE.Mesh;
  priority: THREE.Mesh;
  age: THREE.Mesh;
  parts: THREE.Object3D[];
}

export interface MeshInboxWidgetOptions {
  source?: HostFeedSource<MeshInbox>;
  pollMs?: number;
  retryStore?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  now?: () => number;
  firstPollDelayMs?: number;
}

export function createMeshInboxWidget(
  envMap: THREE.Texture | null = null,
  options: MeshInboxWidgetOptions = {},
): Widget {
  const widgetId = `${MESH_INBOX_KIND}-${nextMeshInboxId++}`;
  const clock = options.now ?? Date.now;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, MESH_INBOX_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'mesh-inbox-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.035, MESH_INBOX_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'mesh-inbox-face';
  face.position.z = 0.014;
  root.add(body, face);

  const HEADER_WIDTH = WIDTH - PAD * 2 - 0.06;
  const header = createScalableLabel('Mesh inbox', HEADER_WIDTH, HEADER_HEIGHT * 0.7, {
    backplate: false,
    align: 'left',
  });
  header.name = 'mesh-inbox-header';
  header.position.set(LEFT + HEADER_WIDTH / 2, TOP - 0.02 - HEADER_HEIGHT / 2, 0.03);
  root.add(header);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'mesh-inbox-close';
  close.position.set(WIDTH / 2 - 0.045, TOP - 0.045, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the mesh inbox';
  root.add(close);

  const message = createScalableLabel('', WIDTH - PAD * 2, ROW_TEXT, {
    backplate: false,
    fontSize: FONT,
  });
  message.name = 'mesh-inbox-message';
  message.position.set(0, ROWS_TOP - ROW_PITCH * 1.5, 0.03);
  root.add(message);

  // Text is always white (labels.ts), so an interrupt is an accent bar over a tinted row.
  const tintGeometry = new THREE.PlaneGeometry(WIDTH - PAD * 2, ROW_PITCH * 0.9);
  const tintMaterial = new THREE.MeshBasicMaterial({ color: INTERRUPT_ROW_COLOR });
  const accentGeometry = new THREE.PlaneGeometry(0.007, ROW_PITCH * 0.78);
  const accentMaterial = new THREE.MeshBasicMaterial({ color: MESH_INTERRUPT_COLOR });

  const slots: Slot[] = [];
  for (let index = 0; index < MESH_INBOX_MAX_ROWS; index += 1) {
    const y = ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2;
    const prefix = `mesh-inbox-row-${index + 1}`;
    const tint = new THREE.Mesh(tintGeometry, tintMaterial);
    tint.name = `${prefix}-tint`;
    tint.position.set(0, y, 0.027);
    const accent = new THREE.Mesh(accentGeometry, accentMaterial);
    accent.name = `${prefix}-accent`;
    accent.position.set(LEFT + 0.004, y, 0.03);
    const route = cell('', ROUTE, y);
    route.name = `${prefix}-route`;
    const subject = cell('', SUBJECT, y);
    subject.name = `${prefix}-subject`;
    const priority = cell('', PRIORITY, y);
    priority.name = `${prefix}-priority`;
    const age = cell('', AGE, y);
    age.name = `${prefix}-age`;
    const parts = [tint, accent, route, subject, priority, age];
    for (const part of parts) part.visible = false;
    root.add(...parts);
    slots.push({ tint, accent, route, subject, priority, age, parts });
  }

  let disposed = false;
  let model: MeshInboxModel = { kind: 'loading' };
  let roster: readonly AgentRosterRow[] = [];
  let lastSecond = -1;

  const render = (nowMs: number): void => {
    lastSecond = Math.floor(nowMs / 1000);
    const view = meshInboxView(model, nowMs, roster);
    setText(header, view.header);
    message.visible = view.message !== '';
    setText(message, view.message);
    slots.forEach((slot, index) => {
      const row = view.rows[index];
      for (const part of slot.parts) {
        part.visible = Boolean(row);
        // A recipient with no pane leaves the row inert under a pinch, as an empty board slot is.
        part.userData.inputAction = row?.paneId ? 'selectAgentPane' : 'grabWidget';
        part.userData.agentPaneId = row?.paneId ?? undefined;
        part.userData.helpText = row?.help;
      }
      if (!row) return;
      slot.tint.visible = row.interrupt;
      slot.accent.visible = row.interrupt;
      setText(slot.route, row.route);
      setText(slot.subject, row.subject);
      setText(slot.priority, row.priority);
      setText(slot.age, row.age);
    });
  };

  const poller = createFeedPoller<MeshInbox>({
    source:
      options.source ??
      defaultHostFeedSource(MESH_INBOX_PATH, MESH_INBOX_PROTOCOL, (data) =>
        parseMeshInbox(data, clock()),
      ),
    pollMs: options.pollMs ?? MESH_INBOX_POLL_MS,
    retryStore: options.retryStore,
    now: options.now,
    firstPollDelayMs: options.firstPollDelayMs,
    onResult: (result) => {
      if (disposed) return;
      model = result.ok
        ? { kind: 'inbox', inbox: result.value }
        : { kind: 'failed', code: result.code };
      render(clock());
    },
  });

  const setAgentRoster = (rows: readonly AgentRosterRow[]): void => {
    if (disposed) return;
    roster = rows;
    render(clock());
  };

  // Polls only from the scene's frame loop; ages re-render at most every ten seconds.
  const update = (nowMs: number): void => {
    if (disposed) return;
    poller.update(nowMs, isWidgetShown(root), '{}');
    if (Math.floor(nowMs / 10_000) !== Math.floor(lastSecond / 10)) render(nowMs);
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
    object.userData.widgetKind = MESH_INBOX_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  render(clock());
  return { root, update, dispose, setAgentRoster };
}
