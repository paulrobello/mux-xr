import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  BOOKINGS_PROTOCOL,
  createBookingsFeed,
  createKanbanCli,
  parseBookings,
} from '../src/server/board-feeds';
import type { RepoCommandRunner } from '../src/server/repo-status-server';
import {
  BOOKING_LOOKBACK_MS,
  BOOKING_TIMELINE_POLL_MS,
  type Booking,
  type BookingsFeed,
  bookingTimelineView,
  createBookingTimelineWidget,
  formatBooking,
  parseBookingsFeed,
  TRACK_LEFT,
  TRACK_WIDTH,
  timelineX,
} from '../src/xr/booking-timeline';
import { formatLocalHour, formatLocalTime } from '../src/xr/feed-poller';
import {
  clientRequest,
  requestFeed,
  startFeedServer,
  stopFeedServers,
} from './helpers/feed-socket';

afterEach(stopFeedServers);

/** 2026-11-12 05:40 UTC, which is 9:40 PM on 11 November in Los Angeles (PST). */
const NOW = Date.UTC(2026, 10, 12, 5, 40);
const MIN = 60_000;

const RESOURCES = [
  { name: 'test-mac', bookable: true, description: 'never forwarded' },
  { name: 'dev-workstation', bookable: true },
  { name: 'backup-host', bookable: false },
];
const row = (overrides: Record<string, unknown>) => ({
  id: String(Math.random()),
  resource: 'test-mac',
  status: 'booked',
  state: 'upcoming',
  startAt: NOW + 10 * MIN,
  endAt: NOW + 40 * MIN,
  holder: 'codex-feed-it-finale',
  project: 'feed-it',
  purpose: 'never forwarded',
  loadTolerance: 'sensitive',
  cancelledBy: '',
  ...overrides,
});
const BOOKED = [
  row({ id: 'a' }),
  row({
    id: 'b',
    resource: 'dev-workstation',
    loadTolerance: 'tolerant',
    startAt: NOW + 60 * MIN,
    endAt: NOW + 90 * MIN,
    holder: 'claude-mux-xr',
    project: 'mux-xr',
  }),
  row({ id: 'gone', endAt: NOW - MIN, startAt: NOW - 30 * MIN }),
  row({ id: 'nas', resource: 'backup-host' }),
  row({ id: 'far', startAt: NOW + 7 * 60 * MIN, endAt: NOW + 8 * 60 * MIN }),
  row({ id: 'cancelled', status: 'cancelled' }),
];
const CHECKED_IN = [
  row({
    id: 'c',
    status: 'checked_in',
    state: 'current',
    startAt: NOW - 20 * MIN,
    endAt: NOW + 5 * MIN,
    holder: 'claude-fixtures',
  }),
  row({ id: 'a' }),
];

const runnerFor = (fail = false) => {
  const calls: string[][] = [];
  const run: RepoCommandRunner = async (_file, args) => {
    calls.push(args.slice(1));
    if (fail) return { code: 1, stdout: '', truncated: false };
    const command = args.slice(1, 3).join(' ');
    const status = args[4];
    const stdout =
      command === 'schedule resource-list'
        ? RESOURCES
        : command === 'schedule list'
          ? status === 'booked'
            ? BOOKED
            : CHECKED_IN
          : null;
    return stdout
      ? { code: 0, stdout: JSON.stringify(stdout), truncated: false }
      : { code: 1, stdout: '', truncated: false };
  };
  return {
    calls,
    cli: createKanbanCli({
      run,
      homeDir: () => '/Users/test',
      findExecutable: async (candidates) => candidates[0] ?? null,
      now: () => NOW,
    }),
  };
};

describe('bookings feed', () => {
  it('keeps live bookings on bookable hosts in the next six hours, without purposes', () => {
    const feed = parseBookings(RESOURCES, [BOOKED, CHECKED_IN], NOW);
    expect(feed?.hosts).toEqual(['dev-workstation', 'test-mac']);
    expect(feed?.bookings.map((booking) => booking.holder)).toEqual([
      'claude-fixtures',
      'codex-feed-it-finale',
      'claude-mux-xr',
    ]);
    expect(feed?.bookings[2]).toEqual({
      resource: 'dev-workstation',
      holder: 'claude-mux-xr',
      project: 'mux-xr',
      startAt: NOW + 60 * MIN,
      endAt: NOW + 90 * MIN,
      status: 'booked',
      state: 'upcoming',
      loadTolerance: 'tolerant',
    });
    expect(JSON.stringify(feed)).not.toContain('never forwarded');
    expect(parseBookings({}, [[], []], NOW)).toBeNull();
    expect(parseBookings([], [null], NOW)).toBeNull();
  });

  it('reads the hosts and both live statuses through read-only CLI commands only', async () => {
    const { cli, calls } = runnerFor();
    const feed = await createBookingsFeed({ cli, now: () => NOW })();
    expect(feed.bookings).toHaveLength(3);
    expect(calls).toEqual([
      ['schedule', 'resource-list', '--format', 'json'],
      ['schedule', 'list', '--status', 'booked', '--limit', '200', '--format', 'json'],
      ['schedule', 'list', '--status', 'checked_in', '--limit', '200', '--format', 'json'],
    ]);
  });

  it('answers upstream when the scheduler cannot be read', async () => {
    const { cli } = runnerFor(true);
    await expect(createBookingsFeed({ cli, now: () => NOW })()).rejects.toMatchObject({
      code: 'upstream',
    });
  });

  it('serves the feed on /bookings behind --board-feeds and the secret proof', async () => {
    const { cli } = runnerFor();
    const on = await startFeedServer({ boardFeeds: { enabled: true, cli, now: () => NOW } });
    const { reply } = await requestFeed(`${on.base}/bookings`, BOOKINGS_PROTOCOL, '{}');
    expect(reply).toMatchObject({ type: 'feed', data: { hosts: ['dev-workstation', 'test-mac'] } });
    const parsed = await clientRequest(
      `${on.base}/bookings`,
      BOOKINGS_PROTOCOL,
      parseBookingsFeed,
      '{}',
    );
    expect(parsed.ok && parsed.value.bookings).toHaveLength(3);
    const off = await startFeedServer({ boardFeeds: { enabled: false, cli } });
    expect(
      await clientRequest(`${off.base}/bookings`, BOOKINGS_PROTOCOL, parseBookingsFeed, '{}'),
    ).toEqual({ ok: false, code: 'disabled' });
  });
});

const feed: BookingsFeed = parseBookingsFeed(
  parseBookings(RESOURCES, [BOOKED, CHECKED_IN], NOW),
) ?? {
  hosts: [],
  bookings: [],
};

describe('booking timeline view', () => {
  it('formats times in Etc/GMT+8 like 9:40 PM', () => {
    expect(formatLocalTime(NOW)).toBe('9:40 PM');
    expect(formatLocalHour(NOW + 20 * MIN)).toBe('10 PM');
    const booking = feed.bookings.find((entry) => entry.holder === 'claude-mux-xr') as Booking;
    expect(formatBooking(booking)).toBe('claude-mux-xr · mux-xr · 10:40 PM–11:10 PM · tolerant');
  });

  it('shows each host with its current or next booking, and a now-relative window', () => {
    const view = bookingTimelineView({ kind: 'feed', feed }, NOW);
    expect(view.header).toBe('Host bookings · 9:40 PM');
    expect(view.message).toBe('');
    expect(view.rows.map((entry) => [entry.host, entry.detail])).toEqual([
      ['dev-workstation', 'claude-mux-xr · mux-xr · 10:40 PM–11:10 PM · tolerant'],
      ['test-mac', 'claude-fixtures · feed-it · 9:20 PM–9:45 PM · sensitive · +1'],
    ]);
    expect(view.start).toBe(NOW - BOOKING_LOOKBACK_MS);
    expect(timelineX(view.start - MIN, view.start)).toBe(TRACK_LEFT);
    expect(timelineX(NOW + 10 * 60 * MIN, view.start)).toBeCloseTo(TRACK_LEFT + TRACK_WIDTH, 9);
  });

  it('names empty, disconnected and disabled states', () => {
    expect(
      bookingTimelineView({ kind: 'feed', feed: { hosts: ['test-mac'], bookings: [] } }, NOW),
    ).toMatchObject({
      message: 'No live bookings in the next few hours',
      rows: [{ host: 'test-mac', detail: 'free' }],
    });
    expect(
      bookingTimelineView({ kind: 'feed', feed: { hosts: [], bookings: [] } }, NOW).message,
    ).toBe('No bookable hosts');
    expect(bookingTimelineView({ kind: 'failed', code: 'unavailable' }, NOW).message).toBe(
      'Host service unreachable (port 4242)',
    );
    expect(bookingTimelineView({ kind: 'failed', code: 'disabled' }, NOW).message).toBe(
      'Board feeds are off on the host',
    );
    expect(bookingTimelineView({ kind: 'failed', code: 'upstream' }, NOW).message).toMatch(
      /scheduler unreachable/,
    );
  });
});

describe('booking timeline widget', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  };

  it('draws a bar per booking, tolerance as height, a now line, and polls once a minute', async () => {
    let now = NOW;
    const calls: Array<(result: HostFeedResult<BookingsFeed>) => void> = [];
    const source: HostFeedSource<BookingsFeed> = () =>
      new Promise((resolve) => {
        calls.push(resolve);
      });
    const widget = createBookingTimelineWidget(null, {
      source,
      retryStore: memory,
      firstPollDelayMs: 0,
      now: () => now,
    });
    new THREE.Scene().add(widget.root);
    widget.update(now);
    expect(calls).toHaveLength(1);
    calls[0]?.({ ok: true, value: feed });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bars = [1, 2, 3, 4].map((index) =>
      widget.root.getObjectByName(`booking-timeline-bar-${index}`),
    );
    expect(bars.map((bar) => bar?.visible)).toEqual([true, true, true, false]);
    expect(bars[0]?.userData.helpText).toBe(
      'dev-workstation: claude-mux-xr · mux-xr · 10:40 PM–11:10 PM · tolerant',
    );
    expect(bars[0]?.scale.y).toBeCloseTo((bars[1]?.scale.y ?? 0) / 2, 9);
    const now0 = widget.root.getObjectByName('booking-timeline-now');
    expect(now0?.position.x).toBeCloseTo(timelineX(NOW, NOW - BOOKING_LOOKBACK_MS), 9);
    expect(
      widget.root.getObjectByName('booking-timeline-row-2-detail')?.userData.labelText,
    ).toMatch(/^claude-fixtures/);
    // A minute later the bars slide left under the fixed now line.
    const before = bars[0]?.position.x ?? 0;
    now += MIN / 2;
    widget.update(now);
    expect(bars[0]?.position.x).toBe(before);
    now = NOW + MIN - 1;
    widget.update(now);
    expect(bars[0]?.position.x).toBe(before);
    expect(calls).toHaveLength(1);
    widget.update(NOW + BOOKING_TIMELINE_POLL_MS);
    expect(bars[0]?.position.x).toBeLessThan(before);
    expect(calls).toHaveLength(2);
    calls[1]?.({ ok: false, code: 'unavailable' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bars[0]?.visible).toBe(false);
    expect(widget.root.getObjectByName('booking-timeline-message')?.userData.labelText).toBe(
      'Host service unreachable (port 4242)',
    );
    widget.dispose();
    widget.update(NOW + 10 * BOOKING_TIMELINE_POLL_MS);
    expect(calls).toHaveLength(2);
  });
});
