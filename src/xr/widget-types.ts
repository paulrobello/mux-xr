/**
 * Data types and channels shared between the scene and the widgets. Widget modules import their
 * input types from here instead of from each other, which keeps `widgets.ts` free of imports from
 * the widgets it describes.
 */
import type { PerfSample } from '@par/xr-workspace';
import type * as THREE from 'three';
import type { TerminalStatus } from '../contracts';
import type { PairedHost } from '../host-pairing';
import type { PictureImage } from '../pictures/picture-image';
import type { TerminalLinkStats } from '../terminal/link-stats';
import type { AgentRosterRow } from '../workspace/agent-roster';

export interface BellFeedEntry {
  /** `bell:<paneId>` for bells, `notice:<text>` for HUD notices. */
  id: string;
  kind: 'bell' | 'notice';
  /** Pane the entry selects; null for HUD notices, which never select. */
  paneId: string | null;
  label: string;
  at: number;
}

/** One pane's stream as the scene reports it each sample. */
export interface StreamLinkInput {
  paneId: string;
  label: string;
  status: TerminalStatus;
  stats: Readonly<TerminalLinkStats> | undefined;
}

/** What the scene reports to stream health widgets each sample. */
export interface StreamLinksSample {
  links: readonly StreamLinkInput[];
  nowMs: number;
}

export type Unsubscribe = () => void;

/** A read-only view of one data source the scene feeds to widgets. */
export interface Channel<T> {
  /** The latest published value, or the channel's initial value before any publish. */
  get(): T;
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export interface Publisher<T> extends Channel<T> {
  publish(value: T): void;
  hasSubscribers(): boolean;
}

/**
 * A channel that `publish`es to every subscriber. With `replay`, a new subscriber is called at
 * once with the current value, for slow data that widgets must hold when they are created after it
 * arrived. Without it a subscriber hears only later publishes, for per-frame data where a replayed
 * value would be stale.
 */
export function createChannel<T>(initial: T, replay: boolean): Publisher<T> {
  const listeners = new Set<(value: T) => void>();
  let current = initial;
  return {
    get: () => current,
    hasSubscribers: () => listeners.size > 0,
    publish(value) {
      current = value;
      for (const listener of listeners) listener(value);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (replay) listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type FocusedPaneListener = (paneId: string | null, cwd: string | null, host: string | null) => void;

/** The focused pane, its directory, and its hostname. */
export interface FocusedPaneChannel {
  subscribe(listener: FocusedPaneListener): Unsubscribe;
  publish(paneId: string | null, cwd: string | null, host: string | null): void;
}

/**
 * The focused pane as the scene sees it. The scene publishes on every frame, so each subscriber is
 * called only when its own last value differs; a new subscriber therefore hears the next publish
 * even when the value has not changed, and a stale value is never replayed to it.
 */
export function createFocusedPaneChannel(): FocusedPaneChannel {
  interface Subscription {
    listener: FocusedPaneListener;
    delivered: boolean;
    paneId: string | null;
    cwd: string | null;
    host: string | null;
  }
  const subscriptions = new Set<Subscription>();
  return {
    publish(paneId, cwd, host) {
      for (const subscription of subscriptions) {
        if (
          subscription.delivered &&
          subscription.paneId === paneId &&
          subscription.cwd === cwd &&
          subscription.host === host
        )
          continue;
        subscription.delivered = true;
        subscription.paneId = paneId;
        subscription.cwd = cwd;
        subscription.host = host;
        subscription.listener(paneId, cwd, host);
      }
    },
    subscribe(listener) {
      const subscription: Subscription = {
        listener,
        delivered: false,
        paneId: null,
        cwd: null,
        host: null,
      };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
  };
}

/** The data sources the scene feeds to widgets. */
export interface WidgetChannels {
  /** Every roster change; replayed to a new widget. */
  agentRoster: Channel<readonly AgentRosterRow[]>;
  /** Every bell feed change, newest first; replayed to a new widget. */
  bellFeed: Channel<readonly BellFeedEntry[]>;
  /** Frame stats each time the scene's frame counter reports (about 2 Hz). */
  perfSample: Channel<PerfSample>;
  /** An XR session started: drop frame-time history. */
  perfReset: Channel<void>;
  /** Every pane stream about once a second, only while a subscriber exists. */
  streamLinks: Channel<StreamLinksSample>;
  focusedPane: FocusedPaneChannel;
  /** Texture anisotropy already capped to the renderer maximum; replayed to a new widget. */
  textureAnisotropy: Channel<number>;
  /** The weather ZIP setting; empty when none is set. Replayed to a new widget. */
  weatherZip: Channel<string>;
}

/** The scene's side of `WidgetChannels`: the same channels with `publish`. */
export interface WidgetChannelPublishers extends WidgetChannels {
  agentRoster: Publisher<readonly AgentRosterRow[]>;
  bellFeed: Publisher<readonly BellFeedEntry[]>;
  perfSample: Publisher<PerfSample>;
  perfReset: Publisher<void>;
  streamLinks: Publisher<StreamLinksSample>;
  textureAnisotropy: Publisher<number>;
  weatherZip: Publisher<string>;
}

export function createWidgetChannels(initial: {
  bellFeed: readonly BellFeedEntry[];
  textureAnisotropy: number;
  weatherZip: string;
}): WidgetChannelPublishers {
  return {
    agentRoster: createChannel<readonly AgentRosterRow[]>([], true),
    bellFeed: createChannel(initial.bellFeed, true),
    // The initial sample is never delivered: a new subscriber hears only later samples.
    perfSample: createChannel<PerfSample>({ fps: 0, worstFrameMs: 0, targetHz: 60 }, false),
    perfReset: createChannel<void>(undefined, false),
    streamLinks: createChannel<StreamLinksSample>({ links: [], nowMs: 0 }, false),
    focusedPane: createFocusedPaneChannel(),
    textureAnisotropy: createChannel(initial.textureAnisotropy, true),
    weatherZip: createChannel(initial.weatherZip, true),
  };
}

/** The scene's connection to the host service; widgets build their feed clients from it. */
export type WidgetHost = PairedHost;

/** Widget capabilities the registry wires to a channel; the base `Widget` carries none of them. */
export interface AgentRosterConsumer {
  setAgentRoster(rows: readonly AgentRosterRow[]): void;
}
export interface BellFeedConsumer {
  setBellFeed(entries: readonly BellFeedEntry[]): void;
}
export interface StreamLinksConsumer {
  setStreamLinks(links: readonly StreamLinkInput[], nowMs: number): void;
}
export interface FocusedPaneConsumer {
  /** Widgets dedupe repeats; `host` is the OSC 7 hostname. */
  setFocusedPane(paneId: string | null, cwd: string | null, host?: string | null): void;
}
/** A picture frame takes its depth map by picture id, not from a channel. */
export interface PictureDepthTarget {
  /** Frames take ownership of the image's canvas. */
  setPictureDepth(depth: PictureImage): void;
}

/** Everything a registry entry needs to build its widget. */
export interface WidgetContext {
  /** The shared UI environment map; null without a working renderer. */
  readonly envMap: THREE.Texture | null;
  readonly host: WidgetHost;
  readonly channels: WidgetChannels;
}

/**
 * Subscribes `widget` to channels and ends the subscriptions when it is disposed. `subscribe`
 * returns the unsubscribe functions.
 */
export function subscribed<W extends { dispose(): void }>(
  widget: W,
  subscribe: (widget: W) => readonly Unsubscribe[],
): W {
  const subscriptions = subscribe(widget);
  const dispose = widget.dispose;
  widget.dispose = () => {
    for (const unsubscribe of subscriptions) unsubscribe();
    dispose.call(widget);
  };
  return widget;
}
