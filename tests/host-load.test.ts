import { webcrypto } from 'node:crypto';
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

import type { HostClipboardSocket } from '../src/host-clipboard';
import {
  createHostStatsClient,
  dictationServiceUrl,
  type HostStatsResult,
  parseHostStats,
} from '../src/host-stats';
import { hostStatsMac } from '../src/server/host-stats-server';
import {
  cpuTone,
  createHostLoadWidget,
  formatCpu,
  formatLoad,
  formatLoadTrend,
  HOST_LOAD_AUTH_RETRY_KEY,
  HOST_LOAD_AUTH_RETRY_MS,
  HOST_LOAD_POLL_MS,
  HOST_LOAD_RATE_LIMIT_RETRY_MS,
  HOST_LOAD_TONE_COLORS,
  HOST_LOAD_UNAVAILABLE,
  hostTone,
  loadTone,
} from '../src/xr/host-load';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const stats = (load1: number, cpu: number | null = 20): HostStatsResult => ({
  ok: true,
  value: { load: [load1, 4, 3], cpu, cores: 12 },
});

describe('host load thresholds', () => {
  it('warns above a 1-minute load of 15 and is critical above 30', () => {
    expect(loadTone(0)).toBe('ok');
    expect(loadTone(15)).toBe('ok');
    expect(loadTone(15.01)).toBe('warn');
    expect(loadTone(30)).toBe('warn');
    expect(loadTone(30.01)).toBe('critical');
    expect(loadTone(Number.NaN)).toBe('unknown');
  });

  it('warns at 75% CPU and is critical at 90%', () => {
    expect(cpuTone(74.9)).toBe('ok');
    expect(cpuTone(75)).toBe('warn');
    expect(cpuTone(90)).toBe('critical');
    expect(cpuTone(null)).toBe('unknown');
  });

  it('takes the worse of load and CPU, and the load alone when CPU is unmeasured', () => {
    expect(hostTone({ load: [2, 2, 2], cpu: 95, cores: 8 })).toBe('critical');
    expect(hostTone({ load: [16, 2, 2], cpu: 10, cores: 8 })).toBe('warn');
    expect(hostTone({ load: [16, 2, 2], cpu: null, cores: 8 })).toBe('warn');
    expect(hostTone({ load: [1, 2, 2], cpu: null, cores: 8 })).toBe('ok');
  });

  it('formats the readouts', () => {
    const value = { load: [3.214, 2.8, 120] as [number, number, number], cpu: 42.6, cores: 12 };
    expect(formatLoad(value)).toBe('load 3.21');
    expect(formatLoadTrend(value)).toBe('5m 2.80  15m 120  12 cores');
    expect(formatCpu(42.6)).toBe('CPU 43%');
    expect(formatCpu(null)).toBe('CPU --%');
  });
});

describe('host load widget', () => {
  const memoryStore = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      values,
    };
  };
  const mounted = (
    source: () => Promise<HostStatsResult>,
    store = memoryStore(),
    now: () => number = () => 0,
  ) => {
    const widget = createHostLoadWidget(null, { source, retryStore: () => store, now });
    const scene = new THREE.Scene();
    scene.add(widget.root);
    const find = (name: string) => widget.root.getObjectByName(name) as THREE.Mesh;
    const text = (name: string) => String(find(name).userData.labelText);
    const toneHex = () =>
      (find('host-load-tone').material as THREE.MeshBasicMaterial).color.getHex();
    return { widget, scene, find, text, toneHex };
  };

  it('renders the ok state with a dot, load, trend and a CPU bar', async () => {
    const view = mounted(async () => stats(3.21, 40));
    view.widget.update(0);
    await flush();
    expect(view.text('host-load-value')).toBe('load 3.21');
    expect(view.text('host-load-trend')).toBe('5m 4.00  15m 3.00  12 cores');
    expect(view.text('host-load-cpu')).toBe('CPU 40%');
    expect(view.toneHex()).toBe(HOST_LOAD_TONE_COLORS.ok);
    expect(view.find('host-load-tone').visible).toBe(true);
    expect(view.find('host-load-warning').visible).toBe(false);
    expect(view.find('host-load-cpu-bar').visible).toBe(true);
    expect(view.find('host-load-cpu-bar').scale.x).toBeGreaterThan(0.05);
    view.widget.dispose();
  });

  it('renders warn and critical as a triangle in the threshold colour', async () => {
    let next = stats(16.5, 30);
    const view = mounted(async () => next);
    view.widget.update(0);
    await flush();
    expect(view.toneHex()).toBe(HOST_LOAD_TONE_COLORS.warn);
    expect(view.find('host-load-warning').visible).toBe(true);
    expect(view.find('host-load-tone').visible).toBe(false);
    next = stats(4, 96);
    view.widget.update(HOST_LOAD_POLL_MS);
    await flush();
    expect(view.toneHex()).toBe(HOST_LOAD_TONE_COLORS.critical);
    expect(
      (view.find('host-load-cpu-bar').material as THREE.MeshBasicMaterial).color.getHex(),
    ).toBe(HOST_LOAD_TONE_COLORS.critical);
    view.widget.dispose();
  });

  it('shows a clear unavailable state with the reason, and drops stale numbers', async () => {
    let next: HostStatsResult = stats(3);
    const view = mounted(async () => next);
    view.widget.update(0);
    await flush();
    next = { ok: false, code: 'unavailable' };
    view.widget.update(HOST_LOAD_POLL_MS);
    await flush();
    expect(view.text('host-load-value')).toBe('Unavailable');
    expect(view.text('host-load-trend')).toBe(HOST_LOAD_UNAVAILABLE.unavailable);
    expect(view.text('host-load-cpu')).toBe('CPU --%');
    expect(view.find('host-load-cpu-bar').visible).toBe(false);
    expect(view.toneHex()).toBe(HOST_LOAD_TONE_COLORS.unknown);
    next = { ok: false, code: 'auth' };
    view.widget.update(HOST_LOAD_POLL_MS * 2);
    await flush();
    expect(view.text('host-load-trend')).toBe(HOST_LOAD_UNAVAILABLE.auth);
    view.widget.dispose();
  });

  it('treats a throwing or rejecting source as unavailable', async () => {
    const view = mounted(() => Promise.reject(new Error('boom')));
    view.widget.update(0);
    await flush();
    expect(view.text('host-load-value')).toBe('Unavailable');
    view.widget.dispose();
  });

  it('polls about every 5 s, one request at a time', async () => {
    let release: (value: HostStatsResult) => void = () => undefined;
    const source = vi.fn(
      () =>
        new Promise<HostStatsResult>((resolve) => {
          release = resolve;
        }),
    );
    const view = mounted(source);
    view.widget.update(0);
    view.widget.update(HOST_LOAD_POLL_MS * 3);
    expect(source).toHaveBeenCalledTimes(1);
    release(stats(1));
    await flush();
    view.widget.update(HOST_LOAD_POLL_MS * 3 + 1);
    expect(source).toHaveBeenCalledTimes(2);
    release(stats(1));
    await flush();
    view.widget.update(HOST_LOAD_POLL_MS * 3 + 100);
    expect(source).toHaveBeenCalledTimes(2);
    view.widget.dispose();
  });

  it('shows busy and retries after 15 s when rate-limited', async () => {
    const source = vi.fn(
      async (): Promise<HostStatsResult> => ({ ok: false, code: 'rate-limited' }),
    );
    const view = mounted(source);
    view.widget.update(0);
    await flush();
    expect(view.text('host-load-trend')).toBe('Host stats busy, retrying');
    view.widget.update(HOST_LOAD_POLL_MS * 2);
    expect(source).toHaveBeenCalledTimes(1);
    view.widget.update(HOST_LOAD_RATE_LIMIT_RETRY_MS);
    expect(source).toHaveBeenCalledTimes(2);
    view.widget.dispose();
  });

  it('keeps the rejected-secret deadline across a reload and clears it on success', async () => {
    const store = memoryStore();
    let clock = 1_000_000;
    const now = () => clock;
    let next: HostStatsResult = { ok: false, code: 'auth' };
    const source = vi.fn(async () => next);
    const first = mounted(source, store, now);
    first.widget.update(clock);
    await flush();
    expect(store.values.get(HOST_LOAD_AUTH_RETRY_KEY)).toBe(
      String(clock + HOST_LOAD_AUTH_RETRY_MS),
    );
    first.widget.dispose();
    clock += 10_000;
    const reloaded = mounted(source, store, now);
    expect(reloaded.text('host-load-trend')).toBe(HOST_LOAD_UNAVAILABLE.auth);
    reloaded.widget.update(clock);
    expect(source).toHaveBeenCalledTimes(1);
    clock = 1_000_000 + HOST_LOAD_AUTH_RETRY_MS;
    next = stats(2);
    reloaded.widget.update(clock);
    await flush();
    expect(source).toHaveBeenCalledTimes(2);
    expect(store.values.has(HOST_LOAD_AUTH_RETRY_KEY)).toBe(false);
    reloaded.widget.dispose();
  });

  it('ignores a stored deadline that is past or implausibly far ahead', () => {
    for (const stored of [5, 1_000_000 + HOST_LOAD_AUTH_RETRY_MS + 1, Number.NaN]) {
      const store = memoryStore();
      store.setItem(HOST_LOAD_AUTH_RETRY_KEY, String(stored));
      const source = vi.fn(async () => stats(1));
      const view = mounted(source, store, () => 1_000_000);
      view.widget.update(1_000_000);
      expect(source, String(stored)).toHaveBeenCalledTimes(1);
      view.widget.dispose();
    }
  });

  it('backs off past the server failure window after a rejected secret', async () => {
    const source = vi.fn(async (): Promise<HostStatsResult> => ({ ok: false, code: 'auth' }));
    const view = mounted(source);
    view.widget.update(0);
    await flush();
    expect(view.text('host-load-trend')).toBe(HOST_LOAD_UNAVAILABLE.auth);
    view.widget.update(HOST_LOAD_POLL_MS);
    view.widget.update(60_000);
    expect(source).toHaveBeenCalledTimes(1);
    view.widget.update(HOST_LOAD_AUTH_RETRY_MS);
    expect(source).toHaveBeenCalledTimes(2);
    view.widget.dispose();
  });

  it('stops polling while hidden, unmounted or disposed', async () => {
    const source = vi.fn(async () => stats(1));
    const view = mounted(source);
    view.widget.root.visible = false;
    view.widget.update(0);
    view.scene.visible = true;
    view.widget.root.visible = true;
    view.widget.root.userData.focusHidden = true;
    view.widget.update(1);
    view.widget.root.userData.focusHidden = false;
    view.scene.visible = false;
    view.widget.update(2);
    view.scene.visible = true;
    view.widget.root.removeFromParent();
    view.widget.update(3);
    expect(source).not.toHaveBeenCalled();
    view.scene.add(view.widget.root);
    view.widget.update(4);
    expect(source).toHaveBeenCalledTimes(1);
    await flush();
    view.widget.dispose();
    view.widget.update(HOST_LOAD_POLL_MS * 10);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('never touches the network on creation', () => {
    const source = vi.fn(async () => stats(1));
    const widget = createHostLoadWidget(null, { source });
    expect(source).not.toHaveBeenCalled();
    expect(widget.root.userData.widgetKind).toBe('host-load');
    widget.dispose();
  });
});

describe('host stats client', () => {
  const SECRET = 'not-a-real-pairing-value-for-tests-only';
  const NONCE = Buffer.alloc(32, 7).toString('base64');
  const fakeSocket = (
    onSend: (socket: HostClipboardSocket, data: string) => void,
  ): { factory: (url: string) => HostClipboardSocket; urls: string[] } => {
    const urls: string[] = [];
    const factory = (url: string): HostClipboardSocket => {
      urls.push(url);
      const socket: HostClipboardSocket = {
        binaryType: 'blob',
        readyState: 1,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: (data) => onSend(socket, String(data)),
        close: vi.fn(),
      };
      setTimeout(() =>
        socket.onmessage?.({
          data: JSON.stringify({
            type: 'challenge',
            nonce: NONCE,
            protocol: 'mux-xr-host-stats-v1',
          }),
        }),
      );
      return socket;
    };
    return { factory, urls };
  };

  it('proves the secret with the stats HMAC and parses the reply', async () => {
    const sent: unknown[] = [];
    const { factory, urls } = fakeSocket((socket, data) => {
      sent.push(JSON.parse(data));
      socket.onmessage?.({
        data: JSON.stringify({ type: 'stats', load: [1, 2, 3], cpu: 12.5, cores: 8 }),
      });
    });
    const source = createHostStatsClient({
      url: () => 'wss://host.test:4242/host-stats',
      secret: () => SECRET,
      socketFactory: factory,
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
    });
    expect(await source()).toEqual({ ok: true, value: { load: [1, 2, 3], cpu: 12.5, cores: 8 } });
    const expected = hostStatsMac(Buffer.from(SECRET), NONCE).toString('base64');
    expect(sent).toEqual([{ type: 'auth', mac: expected }]);
    expect(urls).toEqual(['wss://host.test:4242/host-stats']);
  });

  it('reports no-secret without connecting, and maps server errors', async () => {
    const { factory, urls } = fakeSocket(() => undefined);
    expect(
      await createHostStatsClient({ url: () => 'x', secret: () => null, socketFactory: factory })(),
    ).toEqual({ ok: false, code: 'no-secret' });
    expect(urls).toEqual([]);
    for (const [code, expected] of [
      ['auth', 'auth'],
      ['disabled', 'disabled'],
      ['rate_limited', 'rate-limited'],
      ['protocol', 'unavailable'],
    ]) {
      const rejecting = fakeSocket((socket) =>
        socket.onmessage?.({ data: JSON.stringify({ type: 'error', code }) }),
      );
      const result = await createHostStatsClient({
        url: () => 'wss://host.test:4242/host-stats',
        secret: () => SECRET,
        socketFactory: rejecting.factory,
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
      })();
      expect(result).toEqual({ ok: false, code: expected });
    }
  });

  it('reads a close before the challenge as rate-limited once the server has answered', async () => {
    let attempt = 0;
    const factory = (url: string): HostClipboardSocket => {
      void url;
      attempt += 1;
      const socket: HostClipboardSocket = {
        binaryType: 'blob',
        readyState: 1,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: () =>
          socket.onmessage?.({
            data: JSON.stringify({ type: 'stats', load: [1, 1, 1], cpu: 1, cores: 2 }),
          }),
        close: () => undefined,
      };
      const current = attempt;
      setTimeout(() => {
        if (current === 2) socket.onclose?.({ code: 1006 });
        else
          socket.onmessage?.({
            data: JSON.stringify({ type: 'challenge', nonce: NONCE, protocol: 'x' }),
          });
      });
      return socket;
    };
    const client = createHostStatsClient({
      url: () => 'x',
      secret: () => SECRET,
      socketFactory: factory,
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
    });
    expect((await client()).ok).toBe(true);
    expect(await client()).toEqual({ ok: false, code: 'rate-limited' });
  });

  it('times out and treats a closed socket as unavailable', async () => {
    const silent = (url: string): HostClipboardSocket => {
      void url;
      return {
        binaryType: 'blob',
        readyState: 1,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: () => undefined,
        close: () => undefined,
      };
    };
    expect(
      await createHostStatsClient({
        url: () => 'x',
        secret: () => SECRET,
        socketFactory: silent,
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
        timeoutMs: 10,
      })(),
    ).toEqual({ ok: false, code: 'timeout' });
    const closing = (url: string): HostClipboardSocket => {
      const socket = silent(url);
      setTimeout(() => socket.onclose?.({ code: 1006 }));
      return socket;
    };
    expect(
      await createHostStatsClient({
        url: () => 'x',
        secret: () => SECRET,
        socketFactory: closing,
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
      })(),
    ).toEqual({ ok: false, code: 'unavailable' });
  });

  it('rejects malformed payloads', () => {
    expect(parseHostStats({ type: 'stats', load: [1, 2, 3], cpu: null, cores: 4 })).not.toBeNull();
    expect(parseHostStats({ type: 'stats', load: [1, 2], cpu: 1, cores: 4 })).toBeNull();
    expect(parseHostStats({ type: 'stats', load: [1, 2, -1], cpu: 1, cores: 4 })).toBeNull();
    expect(parseHostStats({ type: 'stats', load: [1, 2, 3], cpu: 101, cores: 4 })).toBeNull();
    expect(parseHostStats({ type: 'stats', load: [1, 2, 3], cpu: 1, cores: 1.5 })).toBeNull();
    expect(parseHostStats(null)).toBeNull();
  });

  it('builds the dictation server URL like the clipboard client', () => {
    expect(
      dictationServiceUrl('/host-stats', {
        href: 'https://10.0.0.5:4240/app/?x=1#y',
        protocol: 'https:',
      }),
    ).toBe('wss://10.0.0.5:4242/host-stats');
    expect(
      dictationServiceUrl('/host-stats', { href: 'http://localhost:4240/', protocol: 'http:' }),
    ).toBe('ws://localhost:4242/host-stats');
  });
});
