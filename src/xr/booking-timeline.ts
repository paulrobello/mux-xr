import * as THREE from 'three';
import { defaultHostFeedSource, type HostFeedFailure, type HostFeedSource } from '../host-feed';
import {
  createFeedPoller,
  FEED_FAILURE_TEXT,
  formatLocalHour,
  formatLocalTime,
  isWidgetShown,
} from './feed-poller';
import { createScalableLabel, updateScalableLabel } from './labels';
import { applyUIEnvironment } from './ui-environment';
import { disposeOwned, type Widget } from './widgets';

export const BOOKING_TIMELINE_KIND = 'booking-timeline';
export const BOOKINGS_PATH = '/bookings';
export const BOOKINGS_PROTOCOL = 'mux-xr-bookings-v1';
export const BOOKING_TIMELINE_POLL_MS = 60_000;
/** The timeline starts this long before now and spans {@link BOOKING_WINDOW_MS}. */
export const BOOKING_LOOKBACK_MS = 30 * 60_000;
export const BOOKING_WINDOW_MS = 4 * 60 * 60_000;
export const BOOKING_MAX_HOSTS = 5;

export type LoadTolerance = 'tolerant' | 'sensitive';

export interface Booking {
  resource: string;
  holder: string;
  project: string;
  startAt: number;
  endAt: number;
  status: 'booked' | 'checked_in';
  loadTolerance: LoadTolerance;
}

export interface BookingsFeed {
  hosts: string[];
  bookings: Booking[];
}

const MAX_TEXT = 64;
const visible = (value: unknown): string =>
  typeof value === 'string'
    ? Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, ' '))
        .slice(0, MAX_TEXT)
        .join('')
    : '';
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Rebuilds the server's answer field by field, so nothing unexpected reaches the scene. */
export function parseBookingsFeed(data: unknown): BookingsFeed | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (!Array.isArray(value.hosts) || !Array.isArray(value.bookings)) return null;
  const hosts = value.hosts.map(visible).filter(Boolean);
  const bookings: Booking[] = [];
  for (const row of value.bookings) {
    if (!row || typeof row !== 'object') continue;
    const booking = row as Record<string, unknown>;
    const resource = visible(booking.resource);
    if (!hosts.includes(resource) || !time(booking.startAt) || !time(booking.endAt)) continue;
    if (booking.endAt <= booking.startAt) continue;
    bookings.push({
      resource,
      holder: visible(booking.holder),
      project: visible(booking.project),
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status === 'checked_in' ? 'checked_in' : 'booked',
      loadTolerance: booking.loadTolerance === 'tolerant' ? 'tolerant' : 'sensitive',
    });
  }
  return { hosts, bookings };
}

export type BookingTimelineModel =
  | { kind: 'loading' }
  | { kind: 'failed'; code: HostFeedFailure }
  | { kind: 'feed'; feed: BookingsFeed };

const FAILURE_TEXT: Record<HostFeedFailure, string> = {
  ...FEED_FAILURE_TEXT,
  disabled: 'Board feeds are off on the host',
  'not-configured': 'Board feeds are not set up on the host',
  upstream: 'Kanban scheduler unreachable from the host',
};

const clip = (text: string, length: number): string => {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length <= length
    ? characters.join('')
    : `${characters.slice(0, length - 1).join('')}…`;
};

/** "9:40 PM–10:20 PM". */
export function formatWindow(booking: Pick<Booking, 'startAt' | 'endAt'>): string {
  return `${formatLocalTime(booking.startAt)}–${formatLocalTime(booking.endAt)}`;
}

export function formatBooking(booking: Booking): string {
  return [
    clip(booking.holder || 'unknown holder', 24),
    clip(booking.project || 'no project', 16),
    formatWindow(booking),
    booking.loadTolerance,
  ].join(' · ');
}

export interface BookingRowView {
  host: string;
  /** Bookings overlapping the visible window, oldest first. */
  bookings: Booking[];
  /** The current booking, else the next one, else "free". */
  detail: string;
}

export interface BookingTimelineView {
  header: string;
  message: string;
  rows: BookingRowView[];
  hiddenHosts: number;
  /** Start of the visible window (epoch ms). */
  start: number;
}

export function bookingTimelineView(
  model: BookingTimelineModel,
  nowMs: number,
): BookingTimelineView {
  const start = nowMs - BOOKING_LOOKBACK_MS;
  const header = `Host bookings · ${formatLocalTime(nowMs)}`;
  const quiet = (message: string): BookingTimelineView => ({
    header,
    message,
    rows: [],
    hiddenHosts: 0,
    start,
  });
  if (model.kind === 'loading') return quiet('Checking…');
  if (model.kind === 'failed') return quiet(FAILURE_TEXT[model.code]);
  const { feed } = model;
  if (!feed.hosts.length) return quiet('No bookable hosts');
  const end = start + BOOKING_WINDOW_MS;
  const rows = feed.hosts.slice(0, BOOKING_MAX_HOSTS).map((host) => {
    const live = feed.bookings
      .filter((booking) => booking.resource === host && booking.endAt > nowMs)
      .sort((a, b) => a.startAt - b.startAt);
    const shown = live.filter((booking) => booking.startAt < end && booking.endAt > start);
    const first = live[0];
    const more = live.length - 1;
    return {
      host,
      bookings: shown,
      detail: first ? `${formatBooking(first)}${more > 0 ? ` · +${more}` : ''}` : 'free',
    };
  });
  const any = rows.some((row) => row.bookings.length);
  return {
    header,
    message: any ? '' : 'No live bookings in the next few hours',
    rows,
    hiddenHosts: Math.max(0, feed.hosts.length - rows.length),
    start,
  };
}

export const BOOKING_COLORS: Record<LoadTolerance, number> = {
  sensitive: 0xd08a3a,
  tolerant: 0x5a9fd8,
};

const WIDTH = 0.8;
const PAD = 0.03;
const HEADER_HEIGHT = 0.065;
const AXIS_HEIGHT = 0.04;
const ROW_PITCH = 0.082;
const FOOTER_HEIGHT = 0.035;
export const BOOKING_TIMELINE_WIDTH = WIDTH;
export const BOOKING_TIMELINE_HEIGHT =
  0.04 + HEADER_HEIGHT + AXIS_HEIGHT + BOOKING_MAX_HOSTS * ROW_PITCH + FOOTER_HEIGHT;
const TOP = BOOKING_TIMELINE_HEIGHT / 2;
const LEFT = -WIDTH / 2 + PAD;
const AXIS_Y = TOP - 0.02 - HEADER_HEIGHT - AXIS_HEIGHT / 2;
const ROWS_TOP = TOP - 0.02 - HEADER_HEIGHT - AXIS_HEIGHT;
const ROWS_BOTTOM = ROWS_TOP - BOOKING_MAX_HOSTS * ROW_PITCH;
const NAME_WIDTH = 0.12;
export const TRACK_LEFT = LEFT + NAME_WIDTH + 0.01;
export const TRACK_WIDTH = WIDTH / 2 - PAD - TRACK_LEFT;
const BAR_HEIGHT = 0.03;
const TRACK_OFFSET = 0.017;
const DETAIL_OFFSET = -0.022;
const FONT = 0.02;
const DETAIL_FONT = 0.017;
const BAR_POOL = 24;
const MAX_TICKS = 5;

/** Track x for a time, clamped to the visible window. */
export function timelineX(epochMs: number, start: number): number {
  const fraction = THREE.MathUtils.clamp((epochMs - start) / BOOKING_WINDOW_MS, 0, 1);
  return TRACK_LEFT + fraction * TRACK_WIDTH;
}

const BODY_COLOR = 0x101820;
const FACE_COLOR = 0x182935;
const TRACK_COLOR = 0x0e1a21;
const TICK_COLOR = 0x8fa3ae;
const NOW_COLOR = 0xe8f7f8;

let nextTimelineId = 1;

function setText(label: THREE.Mesh, text: string): void {
  if (label.userData.labelText !== text) updateScalableLabel(label, text);
}

export interface BookingTimelineWidgetOptions {
  source?: HostFeedSource<BookingsFeed>;
  pollMs?: number;
  retryStore?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;
  now?: () => number;
  firstPollDelayMs?: number;
}

export function createBookingTimelineWidget(
  envMap: THREE.Texture | null = null,
  options: BookingTimelineWidgetOptions = {},
): Widget {
  const widgetId = `${BOOKING_TIMELINE_KIND}-${nextTimelineId++}`;
  const clock = options.now ?? Date.now;
  const root = new THREE.Group();
  root.name = widgetId;

  const lit = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
    applyUIEnvironment(new THREE.MeshStandardMaterial(parameters), envMap);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH, BOOKING_TIMELINE_HEIGHT, 0.045),
    lit({ color: BODY_COLOR, roughness: 0.62, metalness: 0.32 }),
  );
  body.name = 'booking-timeline-body';
  body.position.z = -0.012;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH - 0.035, BOOKING_TIMELINE_HEIGHT - 0.035, 0.025),
    lit({ color: FACE_COLOR, roughness: 0.65, metalness: 0.18 }),
  );
  face.name = 'booking-timeline-face';
  face.position.z = 0.014;
  root.add(body, face);

  const HEADER_WIDTH = WIDTH - PAD * 2 - 0.06;
  const header = createScalableLabel('Host bookings', HEADER_WIDTH, HEADER_HEIGHT * 0.7, {
    backplate: false,
    align: 'left',
  });
  header.name = 'booking-timeline-header';
  header.position.set(LEFT + HEADER_WIDTH / 2, TOP - 0.02 - HEADER_HEIGHT / 2, 0.03);
  root.add(header);

  const close = createScalableLabel('×', 0.05, 0.05, { background: '#223946' });
  close.name = 'booking-timeline-close';
  close.position.set(WIDTH / 2 - 0.045, TOP - 0.045, 0.04);
  close.userData.inputAction = 'closeWidget';
  close.userData.helpText = 'Close the host booking timeline';
  root.add(close);

  const message = createScalableLabel('', WIDTH - PAD * 2, 0.036, {
    backplate: false,
    fontSize: FONT,
  });
  message.name = 'booking-timeline-message';
  message.position.set(0, ROWS_BOTTOM + ROW_PITCH * 0.5, 0.034);
  root.add(message);

  const tickGeometry = new THREE.PlaneGeometry(0.0015, ROWS_TOP - ROWS_BOTTOM + AXIS_HEIGHT * 0.3);
  const tickMaterial = new THREE.MeshBasicMaterial({
    color: TICK_COLOR,
    transparent: true,
    opacity: 0.35,
  });
  const ticks = Array.from({ length: MAX_TICKS }, (_, index) => {
    const line = new THREE.Mesh(tickGeometry, tickMaterial);
    line.name = `booking-timeline-tick-${index + 1}`;
    line.position.set(0, (ROWS_TOP + ROWS_BOTTOM) / 2 + AXIS_HEIGHT * 0.15, 0.029);
    const label = createScalableLabel('', 0.08, AXIS_HEIGHT * 0.8, {
      backplate: false,
      fontSize: DETAIL_FONT,
    });
    label.name = `booking-timeline-tick-${index + 1}-label`;
    label.position.set(0, AXIS_Y, 0.03);
    root.add(line, label);
    return { line, label };
  });

  const rows = Array.from({ length: BOOKING_MAX_HOSTS }, (_, index) => {
    const y = ROWS_TOP - ROW_PITCH * index - ROW_PITCH / 2;
    const name = createScalableLabel('', NAME_WIDTH, 0.036, {
      backplate: false,
      align: 'left',
      fontSize: FONT,
    });
    name.name = `booking-timeline-row-${index + 1}-host`;
    name.position.set(LEFT + NAME_WIDTH / 2, y + TRACK_OFFSET, 0.03);
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_WIDTH, BAR_HEIGHT),
      new THREE.MeshBasicMaterial({ color: TRACK_COLOR }),
    );
    track.name = `booking-timeline-row-${index + 1}-track`;
    track.position.set(TRACK_LEFT + TRACK_WIDTH / 2, y + TRACK_OFFSET, 0.027);
    const detail = createScalableLabel('', TRACK_WIDTH, 0.03, {
      backplate: false,
      align: 'left',
      fontSize: DETAIL_FONT,
    });
    detail.name = `booking-timeline-row-${index + 1}-detail`;
    detail.position.set(TRACK_LEFT + TRACK_WIDTH / 2, y + DETAIL_OFFSET, 0.03);
    root.add(name, track, detail);
    return { name, track, detail, y };
  });

  // Load tolerance is a bar height plus a colour: sensitive fills the track, tolerant half of it.
  const barMaterials: Record<LoadTolerance, THREE.MeshBasicMaterial> = {
    sensitive: new THREE.MeshBasicMaterial({ color: BOOKING_COLORS.sensitive }),
    tolerant: new THREE.MeshBasicMaterial({ color: BOOKING_COLORS.tolerant }),
  };
  const barGeometry = new THREE.PlaneGeometry(1, 1);
  barGeometry.translate(0.5, 0, 0);
  const bars = Array.from({ length: BAR_POOL }, (_, index) => {
    const bar = new THREE.Mesh(barGeometry, barMaterials.sensitive);
    bar.name = `booking-timeline-bar-${index + 1}`;
    bar.visible = false;
    bar.scale.set(0.001, 0.001, 1);
    root.add(bar);
    return bar;
  });

  const nowLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.003, ROWS_TOP - ROWS_BOTTOM + AXIS_HEIGHT * 0.5),
    new THREE.MeshBasicMaterial({ color: NOW_COLOR }),
  );
  nowLine.name = 'booking-timeline-now';
  nowLine.userData.helpText = 'Now';
  nowLine.position.set(
    TRACK_LEFT + (TRACK_WIDTH * BOOKING_LOOKBACK_MS) / BOOKING_WINDOW_MS,
    (ROWS_TOP + ROWS_BOTTOM) / 2 + AXIS_HEIGHT * 0.25,
    0.033,
  );
  root.add(nowLine);

  const FOOTER_Y = ROWS_BOTTOM - FOOTER_HEIGHT / 2;
  const legend = (tolerance: LoadTolerance, x: number): void => {
    const swatch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.03, tolerance === 'sensitive' ? 0.018 : 0.009),
      barMaterials[tolerance],
    );
    swatch.name = `booking-timeline-legend-${tolerance}`;
    swatch.position.set(x, FOOTER_Y, 0.03);
    const label = createScalableLabel(tolerance, 0.1, 0.03, {
      backplate: false,
      align: 'left',
      fontSize: DETAIL_FONT,
    });
    label.name = `booking-timeline-legend-${tolerance}-label`;
    label.position.set(x + 0.025 + 0.05, FOOTER_Y, 0.03);
    root.add(swatch, label);
  };
  legend('sensitive', TRACK_LEFT + 0.015);
  legend('tolerant', TRACK_LEFT + 0.18);
  const overflow = createScalableLabel('', 0.2, 0.03, {
    backplate: false,
    align: 'left',
    fontSize: DETAIL_FONT,
  });
  overflow.name = 'booking-timeline-overflow';
  overflow.position.set(TRACK_LEFT + 0.35 + 0.1, FOOTER_Y, 0.03);
  root.add(overflow);

  let disposed = false;
  let model: BookingTimelineModel = { kind: 'loading' };
  let lastMinute = -1;

  const render = (nowMs: number): void => {
    lastMinute = Math.floor(nowMs / 60_000);
    const view = bookingTimelineView(model, nowMs);
    setText(header, view.header);
    message.visible = view.message !== '';
    setText(message, view.message);
    overflow.visible = view.hiddenHosts > 0;
    if (view.hiddenHosts > 0) setText(overflow, `+${view.hiddenHosts} hosts`);
    const offsetMs = new Date(view.start).getTimezoneOffset() * 60_000;
    const firstHour = Math.ceil((view.start - offsetMs) / 3_600_000) * 3_600_000 + offsetMs;
    ticks.forEach((tick, index) => {
      const at = firstHour + index * 3_600_000;
      const inside = at < view.start + BOOKING_WINDOW_MS;
      tick.line.visible = inside;
      tick.label.visible = inside;
      if (!inside) return;
      const x = timelineX(at, view.start);
      tick.line.position.x = x;
      // Kept inside the face so an hour near either end never widens the widget.
      tick.label.position.x = THREE.MathUtils.clamp(x, TRACK_LEFT, WIDTH / 2 - PAD - 0.04);
      setText(tick.label, formatLocalHour(at));
    });
    let used = 0;
    rows.forEach((row, index) => {
      const data = view.rows[index];
      row.name.visible = Boolean(data);
      row.track.visible = Boolean(data);
      row.detail.visible = Boolean(data);
      if (!data) return;
      setText(row.name, clip(data.host, 10));
      setText(row.detail, clip(data.detail, 58));
      for (const booking of data.bookings) {
        const bar = bars[used];
        if (!bar) break;
        used += 1;
        const left = timelineX(booking.startAt, view.start);
        const right = timelineX(booking.endAt, view.start);
        const tolerant = booking.loadTolerance === 'tolerant';
        bar.visible = true;
        bar.material = barMaterials[booking.loadTolerance];
        bar.position.set(left, row.y + TRACK_OFFSET, 0.03);
        bar.scale.set(Math.max(0.003, right - left), tolerant ? BAR_HEIGHT / 2 : BAR_HEIGHT, 1);
        bar.userData.helpText = `${data.host}: ${formatBooking(booking)}`;
        bar.userData.bookingHolder = booking.holder;
      }
    });
    for (const bar of bars.slice(used)) bar.visible = false;
  };

  const poller = createFeedPoller<BookingsFeed>({
    source:
      options.source ?? defaultHostFeedSource(BOOKINGS_PATH, BOOKINGS_PROTOCOL, parseBookingsFeed),
    pollMs: options.pollMs ?? BOOKING_TIMELINE_POLL_MS,
    retryStore: options.retryStore,
    now: clock,
    firstPollDelayMs: options.firstPollDelayMs,
    onResult: (result) => {
      if (disposed) return;
      model = result.ok
        ? { kind: 'feed', feed: result.value }
        : { kind: 'failed', code: result.code };
      render(clock());
    },
  });

  // Polls only from the scene's frame loop; the now marker and ticks move once a minute.
  const update = (nowMs: number): void => {
    if (disposed) return;
    poller.update(nowMs, isWidgetShown(root), '{}');
    if (Math.floor(nowMs / 60_000) !== lastMinute) render(nowMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    poller.dispose();
    disposeOwned(root);
    // Bars swap materials, so one not on a mesh right now would escape disposeOwned.
    for (const material of Object.values(barMaterials)) material.dispose();
    root.clear();
  };
  root.traverse((object) => {
    object.userData.widgetId = widgetId;
    object.userData.widgetKind = BOOKING_TIMELINE_KIND;
    if (!object.userData.inputAction) object.userData.inputAction = 'grabWidget';
  });
  root.userData.scaleLimits = [0.25, 2];
  render(clock());
  return { root, update, dispose };
}
