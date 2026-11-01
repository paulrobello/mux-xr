import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpdateChecker, type UpdateManifest } from '../src/update-check';

const response = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as Response;

describe('update checker', () => {
  afterEach(() => vi.useRealTimers());

  it('notifies on the first differing manifest without racing duplicate polls', async () => {
    let resolve: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const changes: Array<UpdateManifest | null> = [];
    const checker = createUpdateChecker({
      runningBuildId: 'running',
      url: '/version.json',
      fetch: fetchMock,
      onChange: (manifest) => changes.push(manifest),
    });
    const first = checker.poll();
    const second = checker.poll();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve?.(response({ buildId: 'new', version: '1.2.3' }));
    await first;
    expect(changes).toEqual([{ buildId: 'new', version: '1.2.3' }]);
    checker.dispose();
  });

  it('clears a notice when the server rolls back to the embedded build', async () => {
    const manifests = [{ buildId: 'new' }, { buildId: 'new' }, { buildId: 'running' }];
    const fetchMock = vi.fn(async () => response(manifests.shift()));
    const changes: Array<UpdateManifest | null> = [];
    const checker = createUpdateChecker({
      runningBuildId: 'running',
      url: '/version.json',
      fetch: fetchMock,
      onChange: (manifest) => changes.push(manifest),
    });
    await checker.poll();
    await checker.poll();
    await checker.poll();
    expect(changes).toEqual([{ buildId: 'new' }, null]);
    checker.dispose();
  });

  it('retains the existing notice for HTTP errors, malformed JSON, and timeouts', async () => {
    vi.useFakeTimers();
    let mode: 'good' | 'http' | 'malformed' | 'timeout' = 'good';
    const fetchMock = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => {
      if (mode === 'good') return Promise.resolve(response({ buildId: 'new' }));
      if (mode === 'http') return Promise.resolve(response({}, false));
      if (mode === 'malformed') return Promise.resolve(response({ buildId: '' }));
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    });
    const changes: Array<UpdateManifest | null> = [];
    const checker = createUpdateChecker({
      runningBuildId: 'running',
      url: '/version.json',
      fetch: fetchMock,
      timeoutMs: 100,
      onChange: (manifest) => changes.push(manifest),
    });
    await checker.poll();
    mode = 'http';
    await checker.poll();
    mode = 'malformed';
    await checker.poll();
    mode = 'timeout';
    const pending = checker.poll();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(changes).toEqual([{ buildId: 'new' }]);
    checker.dispose();
  });

  it('starts with an immediate poll, avoids overlap, and disposes interval and request', async () => {
    vi.useFakeTimers();
    let resolve: ((value: Response) => void) | undefined;
    let aborted = false;
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((done) => {
          resolve = done;
          options?.signal?.addEventListener('abort', () => {
            aborted = true;
          });
        }),
    );
    const onChange = vi.fn();
    const checker = createUpdateChecker({
      runningBuildId: 'running',
      url: '/version.json',
      intervalMs: 1_000,
      fetch: fetchMock,
      onChange,
    });
    checker.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    checker.dispose();
    expect(aborted).toBe(true);
    resolve?.(response({ buildId: 'new' }));
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
