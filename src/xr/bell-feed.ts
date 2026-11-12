import * as THREE from 'three';
import { formatAge } from '../workspace/agent-roster';
import { createScalableLabel, updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

/** Rows shown before the "+N more" line. */
export const BELL_FEED_MAX_ROWS = 6;
/** Pane bells kept; one per pane, so this only bounds a very wide tree. */
export const BELL_FEED_BELL_CAPACITY = 24;
/** Notices kept, on their own budget so a burst of notices never evicts a pending bell. */
export const BELL_FEED_NOTICE_CAPACITY = 8;
/** Notice rows stop showing this long after they were raised. */
export const BELL_FEED_NOTICE_TTL_MS = 10 * 60_000;

export interface BellFeedEntry {
  /** `bell:<paneId>` for bells, `notice:<text>` for HUD notices. */
  id: string;
  kind: 'bell' | 'notice';
  /** Pane the entry selects; null for HUD notices, which never select. */
  paneId: string | null;
  label: string;
  at: number;
}

export interface BellFeedStore {
  pushBell(paneId: string, label: string, at?: number): void;
  pushNotice(text: string, at?: number): void;
  clearPane(paneId: string): void;
  /** Drops bells whose pane `keep` rejects. */
  retainPanes(keep: (paneId: string) => boolean): void;
  /** Relabels a pane's bell in place, keeping its position and time. */
  renamePane(paneId: string, label: string): void;
  /** Newest first. */
  entries(): readonly BellFeedEntry[];
  subscribe(listener: () => void): () => void;
}

/** Entries still shown at `nowMs`: every bell, and notices younger than the TTL. */
export function liveBellFeed(
  entries: readonly BellFeedEntry[],
  nowMs: number,
): readonly BellFeedEntry[] {
  const live = entries.filter(
    (entry) => entry.kind === 'bell' || nowMs - entry.at < BELL_FEED_NOTICE_TTL_MS,
  );
  return live.length === entries.length ? entries : live;
}

/**
 * One bell entry per pane (a pane's bell stays pending until viewed, so it only rises once), and
 * a repeated notice text moves to the top with a fresh time instead of adding a row. Bells and
 * notices have separate capacities, each dropping only its own oldest entries.
 */
export function createBellFeedStore(
  bellCapacity = BELL_FEED_BELL_CAPACITY,
  noticeCapacity = BELL_FEED_NOTICE_CAPACITY,
): BellFeedStore {
  let list: BellFeedEntry[] = [];
  const listeners = new Set<() => void>();
  const replace = (next: BellFeedEntry[]): void => {
    if (next.length === list.length && next.every((entry, index) => entry === list[index])) return;
    list = next;
    for (const listener of listeners) listener();
  };
  const push = (entry: BellFeedEntry): void => {
    let bells = 0;
    let notices = 0;
    replace(
      [entry, ...list.filter((item) => item.id !== entry.id)].filter((item) =>
        item.kind === 'bell' ? ++bells <= bellCapacity : ++notices <= noticeCapacity,
      ),
    );
  };
  const paneLabel = (paneId: string, label: string): string => label || paneId;
  return {
    pushBell: (paneId, label, at = Date.now()) =>
      push({ id: `bell:${paneId}`, kind: 'bell', paneId, label: paneLabel(paneId, label), at }),
    pushNotice: (text, at = Date.now()) =>
      push({ id: `notice:${text}`, kind: 'notice', paneId: null, label: text, at }),
    clearPane: (paneId) => replace(list.filter((item) => item.paneId !== paneId)),
    retainPanes: (keep) =>
      replace(list.filter((item) => item.paneId === null || keep(item.paneId))),
    renamePane: (paneId, label) =>
      replace(
        list.map((item) =>
          item.paneId === paneId && item.label !== paneLabel(paneId, label)
            ? { ...item, label: paneLabel(paneId, label) }
            : item,
        ),
      ),
    entries: () => list,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Slot contents, top to bottom; null leaves a slot empty. Unpointed, the newest entries fill the
 * slots in order. While a ray rests on the feed, rows hold still: an entry keeps its slot, a
 * cleared one leaves its slot empty, and new entries wait (counted in "+N more") until the ray
 * leaves, so nothing moves under the pointer.
 */
export function bellFeedRows(
  entries: readonly BellFeedEntry[],
  previous: readonly (string | null)[] = [],
  pointed = false,
): (BellFeedEntry | null)[] {
  if (!pointed || !previous.some(Boolean)) return entries.slice(0, BELL_FEED_MAX_ROWS);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return previous.slice(0, BELL_FEED_MAX_ROWS).map((id) => (id ? (byId.get(id) ?? null) : null));
}

const WIDTH = 0.72;
const ROW_WIDTH = WIDTH - 0.06;
const ROW_HEIGHT = 0.07;
const ROW_PITCH = 0.082;
const TEXT_HEIGHT = 0.042;
const TAG_WIDTH = 0.1;
const LABEL_WIDTH = 0.4;
const LABEL_CHARACTERS = 26;
const HEADER_HEIGHT = 0.07;
const FOOTER_HEIGHT = 0.05;
export const BELL_FEED_WIDTH = WIDTH;
export const BELL_FEED_HEIGHT =
  0.04 + HEADER_HEIGHT + BELL_FEED_MAX_ROWS * ROW_PITCH + FOOTER_HEIGHT;
const TOP = BELL_FEED_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT;

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const ROW_BACKGROUND = '#15232b';
const BELL_TAG_BACKGROUND = '#33281a';
const BELL_TAG_BORDER = '#c99545';
const NOTICE_TAG_BACKGROUND = '#1a2830';
const NOTICE_TAG_BORDER = '#4a6270';

let nextFeedId = 1;

interface FeedRow {
  group: THREE.Group;
  parts: THREE.Object3D[];
  bellTag: THREE.Mesh;
  noteTag: THREE.Mesh;
  label: THREE.Mesh;
  age: THREE.Mesh;
  entry: BellFeedEntry | null;
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

export function createBellFeedWidget(envMap: THREE.Texture | null = null): Widget {
  const widgetId = `bell-feed-${nextFeedId++}`;
  const root = new THREE.Group();
  root.name = widgetId;
  root.userData.inputAction = 'grabWidget';
  root.userData.scaleLimits = [0.25, 2];

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, BELL_FEED_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'bell-feed-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.035, BELL_FEED_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'bell-feed-face';
  face.position.z = 0.014;
  root.add(body, face);

  const header = createScalableLabel('Bells', LABEL_WIDTH, HEADER_HEIGHT * 0.8, {
    backplate: false,
    align: 'left',
  });
  header.name = 'bell-feed-header';
  header.position.set(
    -ROW_WIDTH / 2 + 0.02 + LABEL_WIDTH / 2,
    TOP - 0.02 - HEADER_HEIGHT / 2,
    0.03,
  );
  root.add(header);

  const close = createScalableLabel('×', 0.055, 0.055, { background: '#223946' });
  close.name = 'bell-feed-close';
  close.position.set(WIDTH / 2 - 0.045, TOP - 0.045, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the bell feed';
  root.add(close);

  const empty = createScalableLabel('No bells or notices', ROW_WIDTH * 0.8, TEXT_HEIGHT, {
    backplate: false,
  });
  empty.name = 'bell-feed-empty';
  empty.position.set(0, ROWS_TOP - ROW_PITCH * 1.5, 0.03);
  root.add(empty);

  const overflow = createScalableLabel('', ROW_WIDTH * 0.5, FOOTER_HEIGHT * 0.8, {
    backplate: false,
  });
  overflow.name = 'bell-feed-overflow';
  overflow.position.set(0, ROWS_TOP - BELL_FEED_MAX_ROWS * ROW_PITCH - FOOTER_HEIGHT / 2, 0.03);
  overflow.visible = false;
  root.add(overflow);

  const pool: FeedRow[] = [];
  for (let index = 0; index < BELL_FEED_MAX_ROWS; index += 1) {
    const group = new THREE.Group();
    group.name = `bell-feed-row-${index + 1}`;
    group.position.set(0, ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2, 0.03);
    group.visible = false;
    const plate = createScalableLabel('', ROW_WIDTH, ROW_HEIGHT, { background: ROW_BACKGROUND });
    plate.name = 'bell-feed-row-plate';
    const tag = (text: string, background: string, border: string): THREE.Mesh => {
      const mesh = createScalableLabel(text, TAG_WIDTH, ROW_HEIGHT * 0.66, { background, border });
      mesh.name = `bell-feed-row-${text}`;
      mesh.position.set(-ROW_WIDTH / 2 + 0.015 + TAG_WIDTH / 2, 0, 0.004);
      return mesh;
    };
    const bellTag = tag('bell', BELL_TAG_BACKGROUND, BELL_TAG_BORDER);
    const noteTag = tag('note', NOTICE_TAG_BACKGROUND, NOTICE_TAG_BORDER);
    const label = createScalableLabel('', LABEL_WIDTH, TEXT_HEIGHT, {
      backplate: false,
      align: 'left',
    });
    label.name = 'bell-feed-row-label';
    label.position.set(-ROW_WIDTH / 2 + 0.03 + TAG_WIDTH + LABEL_WIDTH / 2, 0, 0.004);
    const age = createScalableLabel('', 0.09, TEXT_HEIGHT, { backplate: false });
    age.name = 'bell-feed-row-age';
    age.position.set(ROW_WIDTH / 2 - 0.055, 0, 0.004);
    group.add(plate, bellTag, noteTag, label, age);
    root.add(group);
    const parts = [plate, bellTag, noteTag, label, age];
    pool.push({ group, parts, bellTag, noteTag, label, age, entry: null });
  }

  let entries: readonly BellFeedEntry[] = [];
  let slotIds: (string | null)[] = [];
  let pointed = false;
  let liveCount = 0;
  let lastSecond = -1;
  let disposed = false;

  const render = (nowMs = Date.now()): void => {
    const live = liveBellFeed(entries, nowMs);
    liveCount = live.length;
    const ordered = bellFeedRows(live, slotIds, pointed);
    slotIds = ordered.map((entry) => entry?.id ?? null);
    const bells = live.filter((entry) => entry.kind === 'bell').length;
    setText(header, bells ? `Bells · ${bells}` : 'Bells');
    empty.visible = live.length === 0;
    const shown = ordered.filter(Boolean).length;
    const hidden = live.length - shown;
    overflow.visible = hidden > 0;
    if (hidden) setText(overflow, `+${hidden} more`);
    pool.forEach((slot, index) => {
      const entry = ordered[index] ?? null;
      slot.entry = entry;
      slot.group.visible = Boolean(entry);
      const selectable = entry?.kind === 'bell' && Boolean(entry.paneId);
      for (const part of slot.parts) {
        part.userData.inputAction = selectable ? 'selectBellPane' : 'grabWidget';
        part.userData.bellPaneId = selectable ? entry?.paneId : undefined;
        part.userData.helpText = entry
          ? `${entry.label}${selectable ? ' · Open pane' : ''}`
          : undefined;
      }
      if (!entry) return;
      slot.bellTag.visible = entry.kind === 'bell';
      slot.noteTag.visible = entry.kind === 'notice';
      setText(slot.label, clip(entry.label));
      setText(slot.age, formatAge(entry.at, nowMs));
    });
    lastSecond = Math.floor(nowMs / 1000);
  };

  const setBellFeed = (next: readonly BellFeedEntry[]): void => {
    if (disposed) return;
    entries = next;
    render();
  };

  const setPointed = (next: boolean): void => {
    if (disposed || next === pointed) return;
    pointed = next;
    // Leaving re-sorts newest first; arriving keeps the current rows.
    if (!pointed) render();
  };

  // Called from the render loop; ages and notice expiry re-render at most once a second.
  const update = (nowMs: number): void => {
    if (disposed) return;
    const second = Math.floor(nowMs / 1000);
    if (second === lastSecond) return;
    lastSecond = second;
    if (liveBellFeed(entries, nowMs).length !== liveCount) {
      render(nowMs);
      return;
    }
    for (const slot of pool) if (slot.entry) setText(slot.age, formatAge(slot.entry.at, nowMs));
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeOwned(root);
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = 'bell-feed';
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  render();
  return { root, update, dispose, setBellFeed, setPointed };
}
