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

import {
  createLinkStatsRecorder,
  LINK_PING_TIMEOUT_MS,
  type TerminalLinkStats,
} from '../src/terminal/link-stats';
import {
  createStreamHealthTracker,
  createStreamHealthWidget,
  formatDuration,
  formatRate,
  formatRtt,
  STREAM_HEALTH_EVENT_WINDOW_MS,
  STREAM_HEALTH_MAX_ROWS,
  STREAM_HEALTH_STUCK_MS,
  type StreamLinkInput,
  streamTone,
} from '../src/xr/stream-health';

describe('link stats recorder', () => {
  it('counts bytes, reconnects after the first handshake, and resyncs only after damage', () => {
    const link = createLinkStatsRecorder();
    link.noteConnected();
    link.noteMessage(100);
    link.noteMessage(Number.NaN);
    link.noteOutput(false);
    expect(link.stats).toMatchObject({ bytesReceived: 100, reconnects: 0, resyncs: 0 });
    link.noteOutput(true);
    link.noteOutput(false);
    expect(link.stats.resyncs).toBe(1);
    link.noteConnected();
    expect(link.stats.reconnects).toBe(1);
    link.noteOutput(false);
    expect(link.stats.resyncs).toBe(1);
  });

  it('keeps one ping in flight, times its pong and counts a timeout as missed', () => {
    const link = createLinkStatsRecorder();
    const send = vi.fn(() => true);
    link.noteConnected();
    expect(link.ping(1000, send)).toBe(true);
    expect(link.ping(1500, send)).toBe(false);
    link.notePong(1030);
    expect(link.stats.rttMs).toBe(30);
    expect(link.ping(2000, send)).toBe(true);
    expect(link.ping(2000 + LINK_PING_TIMEOUT_MS, send)).toBe(true);
    expect(link.stats.missedPings).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
    link.notePong(2000 + LINK_PING_TIMEOUT_MS + 12);
    expect(link.stats.rttMs).toBe(12);
    link.notePong(9999);
    expect(link.stats.rttMs).toBe(12);
  });

  it('forgets an unanswerable ping on close and the old RTT on reconnect', () => {
    const link = createLinkStatsRecorder();
    const send = vi.fn(() => true);
    link.noteConnected();
    link.ping(0, send);
    link.notePong(20);
    link.ping(100, send);
    link.noteClosed();
    link.noteConnected();
    expect(link.stats.rttMs).toBeNull();
    expect(link.ping(200, send)).toBe(true);
    expect(link.stats.missedPings).toBe(0);
    expect(link.ping(300, () => false)).toBe(false);
  });
});

const stats = (overrides: Partial<TerminalLinkStats> = {}): TerminalLinkStats => ({
  bytesReceived: 0,
  reconnects: 0,
  resyncs: 0,
  missedPings: 0,
  rttMs: 20,
  ...overrides,
});
const input = (overrides: Partial<StreamLinkInput> = {}): StreamLinkInput => ({
  paneId: 'p1',
  label: 'Shell',
  status: 'connected',
  stats: stats(),
  ...overrides,
});

describe('stream health tracker', () => {
  it('derives the receive rate over the last ten seconds', () => {
    const tracker = createStreamHealthTracker();
    expect(tracker.sample(0, [input()])[0]?.kbps).toBeNull();
    for (let second = 1; second <= 20; second += 1)
      tracker.sample(second * 1000, [input({ stats: stats({ bytesReceived: second * 2048 }) })]);
    const [row] = tracker.sample(21_000, [input({ stats: stats({ bytesReceived: 21 * 2048 }) })]);
    expect(row?.kbps).toBeCloseTo(2, 6);
  });

  it('counts events inside the five-minute window only', () => {
    const tracker = createStreamHealthTracker();
    tracker.sample(0, [input()]);
    tracker.sample(1000, [input({ stats: stats({ reconnects: 1, resyncs: 2, missedPings: 1 }) })]);
    let [row] = tracker.sample(2000, [
      input({ stats: stats({ reconnects: 1, resyncs: 2, missedPings: 1 }) }),
    ]);
    expect(row).toMatchObject({ reconnects: 1, resyncs: 2, missedPings: 1, tone: 'warn' });
    [row] = tracker.sample(2000 + STREAM_HEALTH_EVENT_WINDOW_MS, [
      input({ stats: stats({ reconnects: 1, resyncs: 2, missedPings: 1 }) }),
    ]);
    expect(row).toMatchObject({ reconnects: 0, resyncs: 0, missedPings: 0, tone: 'good' });
  });

  it('times a status and turns a pane stuck out of connected bad', () => {
    const tracker = createStreamHealthTracker();
    tracker.sample(0, [input()]);
    let [row] = tracker.sample(1000, [input({ status: 'connecting' })]);
    expect(row).toMatchObject({ statusForMs: 0, tone: 'warn', kbps: null, rttMs: null });
    [row] = tracker.sample(1000 + STREAM_HEALTH_STUCK_MS, [input({ status: 'connecting' })]);
    expect(row).toMatchObject({ statusForMs: STREAM_HEALTH_STUCK_MS, tone: 'bad' });
  });

  it('sorts worst first and forgets panes that left', () => {
    const tracker = createStreamHealthTracker();
    const rows = tracker.sample(0, [
      input({ paneId: 'a', label: 'Alpha' }),
      input({ paneId: 'b', label: 'Beta', status: 'error' }),
      input({ paneId: 'c', label: 'Gamma', stats: stats({ rttMs: 500 }) }),
    ]);
    expect(rows.map((row) => row.paneId)).toEqual(['b', 'c', 'a']);
    tracker.sample(1000, [input({ paneId: 'a', label: 'Alpha' })]);
    const [back] = tracker.sample(2000, [input({ paneId: 'b', label: 'Beta', status: 'error' })]);
    expect(back?.statusForMs).toBe(0);
  });

  it('tones exited panes unknown and repeated trouble bad', () => {
    const base = { statusForMs: 0, rttMs: 20, reconnects: 0, resyncs: 0, missedPings: 0 };
    expect(streamTone({ ...base, status: 'exited' })).toBe('unknown');
    expect(streamTone({ ...base, status: 'connected' })).toBe('good');
    expect(streamTone({ ...base, status: 'connected', reconnects: 2 })).toBe('bad');
    expect(streamTone({ ...base, status: 'connected', missedPings: 2 })).toBe('bad');
    expect(streamTone({ ...base, status: 'connected', resyncs: 1 })).toBe('warn');
    expect(streamTone({ ...base, status: 'connected', rttMs: 201 })).toBe('warn');
  });

  it('formats readouts', () => {
    expect(formatRate(null)).toBe('-- kB/s');
    expect(formatRate(3.25)).toBe('3.3 kB/s');
    expect(formatRate(312.4)).toBe('312 kB/s');
    expect(formatRate(2048)).toBe('2.0 MB/s');
    expect(formatRtt(null)).toBe('-- ms');
    expect(formatRtt(23.6)).toBe('24 ms');
    expect(formatDuration(12_400)).toBe('12 s');
    expect(formatDuration(125_000)).toBe('2 min');
  });
});

describe('stream health widget', () => {
  const text = (root: THREE.Object3D, name: string): unknown =>
    root.getObjectByName(name)?.userData.labelText;

  it('shows an empty state, then rows with a tone shape, and counts overflow', () => {
    const widget = createStreamHealthWidget();
    widget.setStreamLinks?.([], 0);
    expect(widget.root.getObjectByName('stream-health-empty')?.visible).toBe(true);
    const many = Array.from({ length: STREAM_HEALTH_MAX_ROWS + 2 }, (_, index) =>
      input({ paneId: `p${index}`, label: `Pane ${index}` }),
    );
    many[3] = input({ paneId: 'p3', label: 'Broken', status: 'disconnected' });
    widget.setStreamLinks?.(many, 1000);
    expect(widget.root.getObjectByName('stream-health-empty')?.visible).toBe(false);
    expect(text(widget.root, 'stream-health-row-1-name')).toBe('Broken');
    expect(text(widget.root, 'stream-health-row-1-rate')).toBe('disconnected');
    expect(text(widget.root, 'stream-health-row-1-rtt')).toBe('0 s');
    expect(widget.root.getObjectByName('stream-health-row-1-warning')?.visible).toBe(true);
    expect(widget.root.getObjectByName('stream-health-row-1-tone')?.visible).toBe(false);
    expect(text(widget.root, 'stream-health-row-2-rtt')).toBe('20 ms');
    expect(text(widget.root, 'stream-health-row-2-events')).toBe('0 · 0 · 0');
    expect(widget.root.getObjectByName('stream-health-overflow')?.visible).toBe(true);
    expect(text(widget.root, 'stream-health-overflow')).toBe('+2 more');
    widget.dispose();
    widget.setStreamLinks?.(many, 2000);
  });
});
