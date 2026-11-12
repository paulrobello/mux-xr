import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    text = '';
    anchorX: number | string = 0;
    textAlign = '';
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import {
  BELL_FEED_BELL_CAPACITY,
  BELL_FEED_MAX_ROWS,
  BELL_FEED_NOTICE_CAPACITY,
  BELL_FEED_NOTICE_TTL_MS,
  type BellFeedEntry,
  bellFeedRows,
  createBellFeedStore,
  createBellFeedWidget,
  liveBellFeed,
} from '../src/xr/bell-feed';

const NOW = 1_800_000_000_000;

type FeedWidget = ReturnType<typeof createBellFeedWidget>;

function shownRows(widget: FeedWidget): THREE.Object3D[] {
  return widget.root.children.filter(
    (child) => child.name.startsWith('bell-feed-row-') && child.visible,
  );
}

function part(row: THREE.Object3D, name: string): THREE.Object3D {
  const found = row.getObjectByName(`bell-feed-row-${name}`);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function labels(widget: FeedWidget): string[] {
  return shownRows(widget).map((row) => String(part(row, 'label').userData.labelText));
}

function named(widget: FeedWidget, name: string): THREE.Object3D {
  const found = widget.root.getObjectByName(name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe('bell feed store', () => {
  it('lists bells and notices newest first', () => {
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'build', NOW - 3000);
    feed.pushNotice('Terminal is disconnected.', NOW - 2000);
    feed.pushBell('%2', 'tests', NOW - 1000);
    expect(feed.entries().map((entry) => entry.label)).toEqual([
      'tests',
      'Terminal is disconnected.',
      'build',
    ]);
    expect(feed.entries().map((entry) => entry.paneId)).toEqual(['%2', null, '%1']);
  });

  it('keeps one entry per pane bell and per notice text, moving a repeat to the top', () => {
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'build', NOW - 3000);
    feed.pushNotice('Saved', NOW - 2000);
    feed.pushBell('%2', 'tests', NOW - 1000);
    feed.pushNotice('Saved', NOW);
    feed.pushBell('%1', 'build', NOW + 1000);
    expect(feed.entries().map((entry) => [entry.label, entry.at])).toEqual([
      ['build', NOW + 1000],
      ['Saved', NOW],
      ['tests', NOW - 1000],
    ]);
  });

  it('falls back to the pane id for an untitled pane', () => {
    const feed = createBellFeedStore();
    feed.pushBell('%7', '', NOW);
    expect(feed.entries()[0]?.label).toBe('%7');
  });

  it('caps notices on their own budget so a notice burst never evicts a pending bell', () => {
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'oldest bell', NOW - 1000);
    for (let index = 0; index < BELL_FEED_NOTICE_CAPACITY + 30; index += 1)
      feed.pushNotice(`notice ${index}`, NOW + index);
    const notices = feed.entries().filter((entry) => entry.kind === 'notice');
    expect(notices).toHaveLength(BELL_FEED_NOTICE_CAPACITY);
    expect(notices[0]?.label).toBe(`notice ${BELL_FEED_NOTICE_CAPACITY + 29}`);
    expect(notices.at(-1)?.label).toBe('notice 30');
    expect(feed.entries().at(-1)?.label).toBe('oldest bell');
  });

  it('caps bells separately, dropping only the oldest bell', () => {
    const feed = createBellFeedStore();
    feed.pushNotice('kept notice', NOW - 1000);
    for (let index = 0; index < BELL_FEED_BELL_CAPACITY + 2; index += 1)
      feed.pushBell(`%${index}`, `pane ${index}`, NOW + index);
    const bells = feed.entries().filter((entry) => entry.kind === 'bell');
    expect(bells).toHaveLength(BELL_FEED_BELL_CAPACITY);
    expect(bells.at(-1)?.label).toBe('pane 2');
    expect(feed.entries().at(-1)?.label).toBe('kept notice');
  });

  it('retains only listed panes and relabels a renamed pane in place', () => {
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'build', NOW);
    feed.pushNotice('Streamer restarted', NOW + 1);
    feed.pushBell('%2', 'tests', NOW + 2);
    feed.renamePane('%1', 'build (release)');
    expect(feed.entries().map((entry) => [entry.label, entry.at])).toEqual([
      ['tests', NOW + 2],
      ['Streamer restarted', NOW + 1],
      ['build (release)', NOW],
    ]);
    feed.retainPanes((paneId) => paneId === '%1');
    expect(feed.entries().map((entry) => entry.label)).toEqual([
      'Streamer restarted',
      'build (release)',
    ]);
  });

  it('expires notices after the TTL but keeps bells', () => {
    const entries = createBellFeedStore();
    entries.pushBell('%1', 'old bell', NOW - 2 * BELL_FEED_NOTICE_TTL_MS);
    entries.pushNotice('old notice', NOW - BELL_FEED_NOTICE_TTL_MS);
    entries.pushNotice('fresh notice', NOW - 1000);
    expect(liveBellFeed(entries.entries(), NOW).map((entry) => entry.label)).toEqual([
      'fresh notice',
      'old bell',
    ]);
  });

  it('clears only the viewed pane and notifies only on a change', () => {
    const feed = createBellFeedStore();
    const listener = vi.fn();
    feed.pushBell('%1', 'build', NOW);
    feed.pushBell('%2', 'tests', NOW);
    feed.pushNotice('Saved', NOW);
    feed.subscribe(listener);
    feed.clearPane('%1');
    expect(feed.entries().map((entry) => entry.label)).toEqual(['Saved', 'tests']);
    expect(listener).toHaveBeenCalledTimes(1);
    feed.clearPane('%1');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('bell feed rows', () => {
  const entry = (id: string): BellFeedEntry => ({
    id,
    kind: 'bell',
    paneId: id,
    label: id,
    at: NOW,
  });

  it('shows the newest entries in order when nothing points at the feed', () => {
    const entries = ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'].map(entry);
    expect(bellFeedRows(entries, ['a', 'b'], false).map((row) => row?.id)).toEqual([
      'h',
      'g',
      'f',
      'e',
      'd',
      'c',
    ]);
  });

  it('holds rows still while pointed: cleared slots stay empty and newcomers wait', () => {
    const before = ['c', 'b', 'a'].map(entry);
    const slots = bellFeedRows(before).map((row) => row?.id ?? null);
    // A new bell arrives and 'b' is viewed while the ray rests on the feed.
    const after = ['d', 'c', 'a'].map(entry);
    expect(bellFeedRows(after, slots, true).map((row) => row?.id ?? null)).toEqual([
      'c',
      null,
      'a',
    ]);
    expect(bellFeedRows(after, slots, false).map((row) => row?.id)).toEqual(['d', 'c', 'a']);
  });

  it('fills from newest when pointed at an empty feed', () => {
    expect(bellFeedRows([entry('a')], [], true).map((row) => row?.id)).toEqual(['a']);
  });
});

describe('bell feed widget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a quiet empty state', () => {
    const widget = createBellFeedWidget(null);
    expect(shownRows(widget)).toHaveLength(0);
    expect(named(widget, 'bell-feed-empty').visible).toBe(true);
    expect(named(widget, 'bell-feed-header').userData.labelText).toBe('Bells');
    expect(named(widget, 'bell-feed-overflow').visible).toBe(false);
    expect(widget.root.userData.widgetKind).toBe('bell-feed');
    widget.dispose();
  });

  it('renders pane label, tag and age newest first, and only bell rows select', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'build server', NOW - 3 * 60_000);
    feed.pushNotice(
      'Clipboard is empty or unavailable. Highlight text to copy it first.',
      NOW - 42_000,
    );
    feed.pushBell('%2', 'tests', NOW - 2000);
    const widget = createBellFeedWidget(null);
    widget.setBellFeed?.(feed.entries());
    expect(named(widget, 'bell-feed-empty').visible).toBe(false);
    // The header counts bells only.
    expect(named(widget, 'bell-feed-header').userData.labelText).toBe('Bells · 2');
    expect(labels(widget)).toEqual(['tests', 'Clipboard is empty or una…', 'build server']);
    const rows = shownRows(widget);
    expect(rows.map((row) => part(row, 'age').userData.labelText)).toEqual(['now', '42s', '3m']);
    expect(rows.map((row) => part(row, 'bell').visible)).toEqual([true, false, true]);
    expect(rows.map((row) => part(row, 'note').visible)).toEqual([false, true, false]);
    for (const child of (rows[0] as THREE.Object3D).children) {
      expect(child.userData.inputAction).toBe('selectBellPane');
      expect(child.userData.bellPaneId).toBe('%2');
      expect(child.userData.widgetKind).toBe('bell-feed');
    }
    for (const child of (rows[1] as THREE.Object3D).children) {
      expect(child.userData.inputAction).toBe('grabWidget');
      expect(child.userData.bellPaneId).toBeUndefined();
    }
    // The clipped notice keeps its full text in the hover help.
    expect(part(rows[1] as THREE.Object3D, 'plate').userData.helpText).toBe(
      'Clipboard is empty or unavailable. Highlight text to copy it first.',
    );
    expect(part(rows[0] as THREE.Object3D, 'plate').userData.helpText).toBe('tests · Open pane');
    widget.dispose();
  });

  it('caps rows, counts the overflow and drops viewed panes', () => {
    const feed = createBellFeedStore();
    for (let index = 1; index <= BELL_FEED_MAX_ROWS + 2; index += 1)
      feed.pushBell(`%${index}`, `pane ${index}`, NOW + index);
    const widget = createBellFeedWidget(null);
    widget.setBellFeed?.(feed.entries());
    expect(shownRows(widget)).toHaveLength(BELL_FEED_MAX_ROWS);
    expect(labels(widget)[0]).toBe('pane 8');
    expect(named(widget, 'bell-feed-overflow').userData.labelText).toBe('+2 more');
    feed.clearPane('%8');
    feed.clearPane('%7');
    feed.clearPane('%6');
    widget.setBellFeed?.(feed.entries());
    expect(labels(widget)).toEqual(['pane 5', 'pane 4', 'pane 3', 'pane 2', 'pane 1']);
    expect(named(widget, 'bell-feed-overflow').visible).toBe(false);
    const freed = widget.root.getObjectByName(`bell-feed-row-${BELL_FEED_MAX_ROWS}`);
    expect(freed?.visible).toBe(false);
    for (const child of freed?.children ?? [])
      expect(child.userData.inputAction).toBe('grabWidget');
    widget.dispose();
  });

  it('holds rows under the ray and re-sorts when the ray leaves', () => {
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'one', NOW);
    feed.pushBell('%2', 'two', NOW + 1);
    const widget = createBellFeedWidget(null);
    widget.setBellFeed?.(feed.entries());
    widget.setPointed?.(true);
    feed.pushBell('%3', 'three', NOW + 2);
    feed.clearPane('%2');
    widget.setBellFeed?.(feed.entries());
    // 'two' left an empty slot above 'one'; 'three' waits in the overflow count.
    expect(widget.root.getObjectByName('bell-feed-row-1')?.visible).toBe(false);
    expect(labels(widget)).toEqual(['one']);
    expect(named(widget, 'bell-feed-overflow').userData.labelText).toBe('+1 more');
    widget.setPointed?.(false);
    expect(labels(widget)).toEqual(['three', 'one']);
    expect(named(widget, 'bell-feed-overflow').visible).toBe(false);
    widget.dispose();
  });

  it('drops an expired notice row on the next tick', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'one', NOW - 1000);
    feed.pushNotice('Streamer restarted', NOW - 2000);
    const widget = createBellFeedWidget(null);
    widget.setBellFeed?.(feed.entries());
    expect(labels(widget)).toEqual(['Streamer restarted', 'one']);
    widget.update(NOW + BELL_FEED_NOTICE_TTL_MS);
    expect(labels(widget)).toEqual(['one']);
    expect(named(widget, 'bell-feed-header').userData.labelText).toBe('Bells · 1');
    widget.dispose();
  });

  it('ticks ages at most once a second and ignores feeds once disposed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const feed = createBellFeedStore();
    feed.pushBell('%1', 'one', NOW - 5000);
    const widget = createBellFeedWidget(null);
    widget.setBellFeed?.(feed.entries());
    const age = (): unknown =>
      part(shownRows(widget)[0] as THREE.Object3D, 'age').userData.labelText;
    expect(age()).toBe('now');
    widget.update(NOW + 400);
    expect(age()).toBe('now');
    widget.update(NOW + 60_000);
    expect(age()).toBe('1m');
    widget.dispose();
    expect(() => widget.setBellFeed?.([])).not.toThrow();
    expect(() => widget.setPointed?.(true)).not.toThrow();
    expect(() => widget.update(NOW + 120_000)).not.toThrow();
  });
});
