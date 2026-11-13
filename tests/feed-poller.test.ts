import { describe, expect, it } from 'vitest';
import type { HostFeedResult } from '../src/host-feed';
import { createFeedPoller, FEED_FIRST_POLL_JITTER_MS } from '../src/xr/feed-poller';

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};

const pending = (): Promise<HostFeedResult<string>> => new Promise(() => undefined);

describe('feed poller', () => {
  it('waits out its first-poll delay, also after a reset, then polls', () => {
    const requests: string[] = [];
    const poller = createFeedPoller<string>({
      source: (request) => {
        requests.push(request);
        return pending();
      },
      pollMs: 30_000,
      onResult: () => undefined,
      retryStore: memory,
      now: () => 1_000,
      firstPollDelayMs: 2_500,
    });
    poller.update(3_499, true, '{}');
    poller.reset();
    poller.update(3_499, true, '{}');
    expect(requests).toEqual([]);
    poller.update(3_500, true, '{}');
    expect(requests).toEqual(['{}']);
  });

  it('spreads first polls across up to three seconds by default', () => {
    const firstPolls = Array.from({ length: 40 }, () => {
      let polled = false;
      const poller = createFeedPoller<string>({
        source: () => {
          polled = true;
          return pending();
        },
        pollMs: 30_000,
        onResult: () => undefined,
        retryStore: memory,
        now: () => 0,
      });
      for (let at = 0; at <= FEED_FIRST_POLL_JITTER_MS; at += 100) {
        poller.update(at, true, '{}');
        if (polled) return at;
      }
      return Number.POSITIVE_INFINITY;
    });
    expect(Math.max(...firstPolls)).toBeLessThanOrEqual(FEED_FIRST_POLL_JITTER_MS);
    expect(new Set(firstPolls).size).toBeGreaterThan(1);
  });
});
