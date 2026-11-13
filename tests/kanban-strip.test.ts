import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class MockText extends THREE.Mesh {
    sync(callback?: () => void): void {
      callback?.();
    }
    dispose(): void {
      /* test double */
    }
  },
  configureTextBuilder: vi.fn(),
}));

import type { HostFeedResult, HostFeedSource } from '../src/host-feed';
import {
  createKanbanStripWidget,
  formatHolder,
  KANBAN_STRIP_POLL_MS,
  KANBAN_STRIP_SETTLE_MS,
  type KanbanStrip,
  kanbanStripView,
  parseKanbanStrip,
  type StripCard,
} from '../src/xr/kanban-strip';

const card = (overrides: Partial<StripCard> = {}): StripCard => ({
  title: 'Integrate pane creation',
  status: 'in_progress',
  priority: 'medium',
  holder: 'mux-xr-core-081',
  claimStale: false,
  approval: false,
  ...overrides,
});

const memory = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
};

const deferred = () => {
  const calls: Array<{ request: string; resolve: (result: HostFeedResult<KanbanStrip>) => void }> =
    [];
  const source: HostFeedSource<KanbanStrip> = (request) =>
    new Promise((resolve) => {
      calls.push({ request, resolve });
    });
  return { calls, source };
};

const text = (widget: ReturnType<typeof createKanbanStripWidget>, name: string): string =>
  String(widget.root.getObjectByName(name)?.userData.labelText ?? '');
const shown = (widget: ReturnType<typeof createKanbanStripWidget>, name: string): boolean =>
  widget.root.getObjectByName(name)?.visible === true;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const mounted = (source: HostFeedSource<KanbanStrip>, now: () => number) => {
  const widget = createKanbanStripWidget(null, {
    source,
    retryStore: memory,
    firstPollDelayMs: 0,
    now,
  });
  new THREE.Scene().add(widget.root);
  return widget;
};

describe('kanban strip view', () => {
  it('names every state without a pane, cwd or answer', () => {
    expect(kanbanStripView({ kind: 'no-pane' }).message).toBe('No pane focused');
    expect(kanbanStripView({ kind: 'no-cwd' }).message).toMatch(/Directory unknown/);
    expect(kanbanStripView({ kind: 'failed', code: 'unavailable' }).message).toMatch(/unreachable/);
    expect(kanbanStripView({ kind: 'failed', code: 'disabled' }).message).toBe(
      'Board feeds are off on the host',
    );
    expect(kanbanStripView({ kind: 'failed', code: 'upstream' }).message).toMatch(/Kanban board/);
    const strip = (value: KanbanStrip) => kanbanStripView({ kind: 'strip', strip: value });
    expect(strip({ state: 'outside' }).message).toBe('Not inside a ~/Repos project');
    expect(strip({ state: 'remote' }).message).toMatch(/Remote shell/);
    expect(strip({ state: 'unregistered', project: 'scratch' }).message).toBe(
      'scratch is not on the board',
    );
    expect(strip({ state: 'ok', project: 'mux-xr', cards: [], total: 0 })).toMatchObject({
      header: 'Board · mux-xr',
      message: 'No in-progress or blocked cards',
    });
  });

  it('counts approvals in the header and the cards beyond five rows', () => {
    const cards = [card({ approval: true }), ...Array.from({ length: 6 }, () => card())];
    const view = kanbanStripView({
      kind: 'strip',
      strip: { state: 'ok', project: 'mux-xr', cards, total: 9 },
    });
    expect(view.header).toBe('Board · mux-xr · 1 approval');
    expect(view.cards).toHaveLength(5);
    expect(view.hidden).toBe(4);
  });

  it('formats the claim holder, stale or missing', () => {
    expect(formatHolder(card())).toBe('mux-xr-core-081');
    expect(formatHolder(card({ holder: '' }))).toBe('unclaimed');
    expect(formatHolder(card({ holder: 'gone-agent-with-long-name', claimStale: true }))).toBe(
      'gone-agen… (stale)',
    );
  });

  it('rebuilds the payload field by field', () => {
    expect(parseKanbanStrip({ state: 'remote', extra: 1 })).toEqual({ state: 'remote' });
    expect(parseKanbanStrip({ state: 'ok', project: 'p', cards: 'x' })).toBeNull();
    expect(
      parseKanbanStrip({
        state: 'ok',
        project: 'p',
        total: 1,
        cards: [{ title: 'T\u0007', status: 'blocked', priority: 'bogus', approval: 'yes' }],
      }),
    ).toEqual({
      state: 'ok',
      project: 'p',
      total: 1,
      cards: [
        {
          title: 'T ',
          status: 'blocked',
          priority: null,
          holder: '',
          claimStale: false,
          approval: false,
        },
      ],
    });
  });
});

describe('kanban strip widget', () => {
  it('follows the focused pane, asking with its cwd and host after the pane settles', async () => {
    let now = 1_000_000;
    const { calls, source } = deferred();
    const widget = mounted(source, () => now);
    widget.update(now);
    expect(calls).toHaveLength(0);
    widget.setFocusedPane?.('pane-a', '/Users/me/Repos/mux-xr', 'dev-workstation');
    expect(text(widget, 'kanban-strip-message')).toBe('Checking…');
    widget.update(now);
    expect(calls).toHaveLength(0);
    now += KANBAN_STRIP_SETTLE_MS;
    widget.update(now);
    expect(calls.map((call) => JSON.parse(call.request))).toEqual([
      { cwd: '/Users/me/Repos/mux-xr', host: 'dev-workstation' },
    ]);
    calls[0]?.resolve({
      ok: true,
      value: {
        state: 'ok',
        project: 'mux-xr',
        total: 2,
        cards: [card({ approval: true, status: 'blocked', holder: '' }), card()],
      },
    });
    await flush();
    expect(text(widget, 'kanban-strip-header')).toBe('Board · mux-xr · 1 approval');
    expect(shown(widget, 'kanban-strip-message')).toBe(false);
    expect(shown(widget, 'kanban-strip-row-1-approval')).toBe(true);
    expect(shown(widget, 'kanban-strip-row-1-warning')).toBe(true);
    expect(shown(widget, 'kanban-strip-row-1-tone')).toBe(false);
    expect(text(widget, 'kanban-strip-row-1-status')).toBe('blocked');
    expect(text(widget, 'kanban-strip-row-1-holder')).toBe('unclaimed');
    expect(shown(widget, 'kanban-strip-row-2-approval')).toBe(false);
    expect(shown(widget, 'kanban-strip-row-2-tone')).toBe(true);
    expect(text(widget, 'kanban-strip-row-2-priority')).toBe('med');
    expect(shown(widget, 'kanban-strip-row-3-title')).toBe(false);
    // Repeats are ignored; the next poll waits for the interval.
    widget.setFocusedPane?.('pane-a', '/Users/me/Repos/mux-xr', 'dev-workstation');
    widget.update(now + 1_000);
    expect(calls).toHaveLength(1);
    widget.update(now + KANBAN_STRIP_POLL_MS);
    expect(calls).toHaveLength(2);
    widget.dispose();
  });

  it('drops a stale answer for the previous pane and never asks without a cwd', async () => {
    let now = 1_000_000;
    const { calls, source } = deferred();
    const widget = mounted(source, () => now);
    widget.setFocusedPane?.('pane-a', '/Users/me/Repos/alpha', null);
    now += KANBAN_STRIP_SETTLE_MS;
    widget.update(now);
    widget.setFocusedPane?.('pane-b', null, null);
    calls[0]?.resolve({ ok: true, value: { state: 'outside' } });
    await flush();
    expect(text(widget, 'kanban-strip-message')).toMatch(/Directory unknown/);
    now += KANBAN_STRIP_POLL_MS * 2;
    widget.update(now);
    expect(calls).toHaveLength(1);
    widget.dispose();
  });

  it('shows a disconnected streamer and backs off after a rejected secret', async () => {
    let now = 1_000_000;
    const { calls, source } = deferred();
    const widget = mounted(source, () => now);
    widget.setFocusedPane?.('pane-a', '/Users/me/Repos/alpha', null);
    now += KANBAN_STRIP_SETTLE_MS;
    widget.update(now);
    calls[0]?.resolve({ ok: false, code: 'unavailable' });
    await flush();
    expect(text(widget, 'kanban-strip-message')).toBe('Host service unreachable (port 4242)');
    now += KANBAN_STRIP_POLL_MS;
    widget.update(now);
    calls[1]?.resolve({ ok: false, code: 'auth' });
    await flush();
    expect(text(widget, 'kanban-strip-message')).toBe('Host rejected the pairing secret');
    widget.update(now + KANBAN_STRIP_POLL_MS);
    expect(calls).toHaveLength(2);
    widget.update(now + 65_000);
    expect(calls).toHaveLength(3);
    widget.dispose();
  });

  it('never polls while unmounted, hidden or after dispose', () => {
    const { calls, source } = deferred();
    const widget = createKanbanStripWidget(null, {
      source,
      retryStore: memory,
      firstPollDelayMs: 0,
      now: () => 0,
    });
    widget.setFocusedPane?.('pane-a', '/Users/me/Repos/alpha', null);
    widget.update(10_000);
    const scene = new THREE.Scene();
    scene.add(widget.root);
    widget.root.visible = false;
    widget.update(20_000);
    widget.root.visible = true;
    widget.dispose();
    widget.update(30_000);
    expect(calls).toHaveLength(0);
  });
});
