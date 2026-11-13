import type * as THREE from 'three';
import type { HostFeedFailure, HostFeedResult, HostFeedSource } from '../host-feed';
import {
  HOST_LOAD_AUTH_RETRY_KEY,
  HOST_LOAD_AUTH_RETRY_MS,
  HOST_LOAD_RATE_LIMIT_RETRY_MS,
} from './host-load';

type RetryStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserSessionStorage = (): RetryStore | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

/** Shown for failures every feed shares; each widget names its own disabled, config and upstream text. */
export const FEED_FAILURE_TEXT: Record<
  Exclude<HostFeedFailure, 'disabled' | 'not-configured' | 'upstream'>,
  string
> = {
  'no-secret': 'Not paired: Settings > Host clipboard',
  auth: 'Host rejected the pairing secret',
  'rate-limited': 'Host busy, retrying',
  unavailable: 'Host service unreachable (port 4242)',
  timeout: 'Host service timed out',
};

export interface FeedPollerOptions<T> {
  source: HostFeedSource<T>;
  pollMs: number;
  onResult: (result: HostFeedResult<T>) => void;
  /** Where the rejected-secret deadline survives a reload; sessionStorage by default. */
  retryStore?: () => RetryStore | undefined;
  now?: () => number;
  /** Delay before the first poll; random up to FEED_FIRST_POLL_JITTER_MS by default. */
  firstPollDelayMs?: number;
}

/**
 * Saved widgets mount in the same frame. Their handshakes count toward the host's shared limit of
 * five in-flight or failed proofs a minute until they finish, so the first polls are spread out.
 */
export const FEED_FIRST_POLL_JITTER_MS = 3_000;

export interface FeedPoller {
  /** Polls when due; `request` null skips polling (nothing to ask about yet). */
  update(nowMs: number, shown: boolean, request: string | null): void;
  /** Drops any answer in flight and polls on the next update, as after a focus change. */
  reset(): void;
  dispose(): void;
  /** True while a rejected secret is being waited out. */
  backingOff(nowMs: number): boolean;
}

/**
 * Poll pacing shared by the feed widgets. A rejected secret waits out the server's 60 s auth-failure
 * window, which it shares with the clipboard route, under the same sessionStorage key as host load,
 * so no widget locks out Paste host and a reload does not retry early.
 */
export function createFeedPoller<T>(options: FeedPollerOptions<T>): FeedPoller {
  const retryStore = options.retryStore ?? browserSessionStorage;
  const clock = options.now ?? Date.now;
  let disposed = false;
  let inFlight = false;
  let generation = 0;
  const firstPollAt =
    clock() + (options.firstPollDelayMs ?? Math.random() * FEED_FIRST_POLL_JITTER_MS);
  let nextPollAt = firstPollAt;
  let authUntil = Number.NEGATIVE_INFINITY;
  const storeRetry = (deadline: number | null): void => {
    try {
      if (deadline === null) retryStore()?.removeItem(HOST_LOAD_AUTH_RETRY_KEY);
      else retryStore()?.setItem(HOST_LOAD_AUTH_RETRY_KEY, String(deadline));
    } catch {
      /* Storage unavailable: the backoff then lasts for this page only. */
    }
  };
  const restore = (): void => {
    let stored = Number.NaN;
    try {
      stored = Number(retryStore()?.getItem(HOST_LOAD_AUTH_RETRY_KEY) ?? Number.NaN);
    } catch {
      /* Storage unavailable. */
    }
    const startedAt = clock();
    if (
      Number.isFinite(stored) &&
      stored > startedAt &&
      stored <= startedAt + HOST_LOAD_AUTH_RETRY_MS
    )
      authUntil = Math.max(authUntil, stored);
  };
  restore();

  const poll = (nowMs: number, request: string): void => {
    inFlight = true;
    nextPollAt = nowMs + options.pollMs;
    const token = generation;
    let result: Promise<HostFeedResult<T>>;
    try {
      result = options.source(request);
    } catch {
      result = Promise.resolve({ ok: false, code: 'unavailable' });
    }
    void Promise.resolve(result)
      .catch((): HostFeedResult<T> => ({ ok: false, code: 'unavailable' }))
      .then((value) => {
        if (token !== generation) return;
        inFlight = false;
        if (disposed) return;
        if (!value.ok && value.code === 'auth') {
          authUntil = nowMs + HOST_LOAD_AUTH_RETRY_MS;
          storeRetry(authUntil);
        } else if (!value.ok && value.code === 'rate-limited')
          nextPollAt = nowMs + HOST_LOAD_RATE_LIMIT_RETRY_MS;
        else if (value.ok) storeRetry(null);
        options.onResult(value);
      });
  };

  return {
    update(nowMs, shown, request) {
      if (disposed || inFlight || !shown || request === null) return;
      if (nowMs < nextPollAt || nowMs < authUntil) return;
      // Another widget may have hit a rejected secret since this one last looked.
      restore();
      if (nowMs < authUntil) return;
      poll(nowMs, request);
    },
    reset() {
      generation += 1;
      inFlight = false;
      nextPollAt = firstPollAt;
    },
    dispose() {
      disposed = true;
      generation += 1;
    },
    backingOff: (nowMs) => nowMs < authUntil,
  };
}

/** Mounted, visible and not hidden by focus mode. */
export function isWidgetShown(object: THREE.Object3D): boolean {
  if (!object.parent) return false;
  for (let current: THREE.Object3D | null = object; current; current = current.parent)
    if (!current.visible || current.userData.focusHidden) return false;
  return true;
}

const LOCAL_TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});
const LOCAL_HOUR = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });
// Newer ICU puts a narrow no-break space before AM/PM; the label fonts may lack it.
const plainSpaces = (text: string): string => text.replace(/[  ]/g, ' ');

/** "9:40 PM". */
export function formatLocalTime(epochMs: number): string {
  return plainSpaces(LOCAL_TIME.format(new Date(epochMs)));
}

/** "10 PM". */
export function formatLocalHour(epochMs: number): string {
  return plainSpaces(LOCAL_HOUR.format(new Date(epochMs)));
}
