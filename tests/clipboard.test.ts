import { describe, expect, it, vi } from 'vitest';
import { type ClipboardProvider, createClipboardBridge } from '../src/clipboard';

const providerWith = (overrides: ClipboardProvider = {}): ClipboardProvider => ({
  writeText: async () => undefined,
  readText: async () => '',
  ...overrides,
});

describe('clipboard bridge', () => {
  it('copies exact Unicode and multiline text synchronously within the gesture', async () => {
    let gesture = true;
    const writeText = vi.fn(function (this: ClipboardProvider, text: string) {
      expect(this).toBe(provider);
      expect(gesture).toBe(true);
      expect(text).toBe('☃️ line one\nline two\u0000');
      return Promise.resolve();
    });
    const provider = providerWith({ writeText });
    const bridge = createClipboardBridge(() => provider);
    const result = bridge.copy('☃️ line one\nline two\u0000');
    gesture = false;
    expect(writeText).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe(true);
  });

  it('uses the local copy while an OS write is pending or denied', async () => {
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const bridge = createClipboardBridge(() => providerWith({ writeText: () => pending }));
    const copy = bridge.copy('local');
    await expect(bridge.read()).resolves.toBe('local');
    settle();
    await expect(copy).resolves.toBe(true);

    const denied = createClipboardBridge(() =>
      providerWith({ writeText: () => Promise.reject(new Error('denied')) }),
    );
    const deniedCopy = denied.copy('fallback');
    await expect(deniedCopy).resolves.toBe(false);
    await expect(denied.read()).resolves.toBe('fallback');
  });

  it('prefers the OS read, including an externally cleared clipboard', async () => {
    const readText = vi.fn(async () => 'external');
    const bridge = createClipboardBridge(() => providerWith({ readText }));
    await expect(bridge.copy('local')).resolves.toBe(true);
    await expect(bridge.read()).resolves.toBe('external');
    readText.mockResolvedValueOnce('');
    await expect(bridge.read()).resolves.toBe('');
  });

  it('reads an external clipboard before any app copy', async () => {
    const provider = providerWith({ readText: async () => 'already copied' });
    const bridge = createClipboardBridge(() => provider);
    await expect(bridge.read()).resolves.toBe('already copied');
  });

  it('resolves operations against a provider that appears after construction', async () => {
    let provider: ClipboardProvider | undefined;
    const bridge = createClipboardBridge(() => provider);
    await expect(bridge.copy('local')).resolves.toBe(false);
    provider = providerWith({ writeText: async () => undefined });
    await expect(bridge.copy('current')).resolves.toBe(true);
  });

  it('falls back to the local snapshot on OS read failure', async () => {
    const readText = vi.fn(() => Promise.reject(new Error('read failed')));
    const bridge = createClipboardBridge(() => providerWith({ readText }));
    await bridge.copy('cached');
    await expect(bridge.read()).resolves.toBe('cached');
  });

  it('does not let an older write completion alter the newer copy state', async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    const writeText = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const bridge = createClipboardBridge(() => providerWith({ writeText }));
    const firstCopy = bridge.copy('first');
    const secondCopy = bridge.copy('second');
    resolveFirst();
    await expect(firstCopy).resolves.toBe(true);
    await expect(bridge.read()).resolves.toBe('second');
    resolveSecond();
    await expect(secondCopy).resolves.toBe(true);
  });

  it('returns null after disposal and invalidates pending operations', async () => {
    let resolveWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const bridge = createClipboardBridge(() => providerWith({ writeText: () => write }));
    const copy = bridge.copy('gone');
    bridge.dispose();
    resolveWrite();
    await expect(copy).resolves.toBe(true);
    await expect(bridge.read()).resolves.toBe(null);
    await expect(bridge.copy('later')).resolves.toBe(false);
  });

  it('resolves a pending read as null when disposed', async () => {
    vi.useFakeTimers();
    try {
      let resolveRead!: (value: string) => void;
      const bridge = createClipboardBridge(
        () =>
          providerWith({
            readText: () =>
              new Promise<string>((resolve) => {
                resolveRead = resolve;
              }),
          }),
        { timeoutMs: 50 },
      );
      await bridge.copy('before');
      const read = bridge.read();
      bridge.dispose();
      resolveRead('late');
      await expect(read).resolves.toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out an OS read and keeps the call-start snapshot', async () => {
    vi.useFakeTimers();
    try {
      let resolveRead!: (value: string) => void;
      const bridge = createClipboardBridge(
        () =>
          providerWith({
            readText: () =>
              new Promise<string>((resolve) => {
                resolveRead = resolve;
              }),
          }),
        { timeoutMs: 50 },
      );
      await bridge.copy('before');
      const read = bridge.read();
      await bridge.copy('after');
      vi.advanceTimersByTime(50);
      await expect(read).resolves.toBe('before');
      resolveRead('late');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('host text kept after a refused write (F5)', () => {
  const refusing = (readText: () => Promise<string>) => ({
    writeText: () => Promise.reject(new Error('not focused')),
    readText,
  });

  it('serves only the next read, then falls back to readText', async () => {
    const readText = vi.fn(async () => 'quest text');
    const bridge = createClipboardBridge(() => refusing(readText));
    expect(await bridge.copy('host text', { fromHost: true })).toBe(false);
    expect(await bridge.read()).toBe('host text');
    expect(readText).not.toHaveBeenCalled();
    expect(await bridge.read()).toBe('quest text');
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('expires after 60 seconds', async () => {
    let now = 0;
    const bridge = createClipboardBridge(() => refusing(async () => 'quest text'), {
      now: () => now,
    });
    await bridge.copy('host text', { fromHost: true });
    now = 60_001;
    expect(await bridge.read()).toBe('quest text');
  });

  it('is never returned to a read that excludes host text, even as a fallback', async () => {
    const bridge = createClipboardBridge(() => refusing(() => Promise.reject(new Error('denied'))));
    await bridge.copy('host text', { fromHost: true });
    expect(await bridge.read({ excludeHost: true })).toBeNull();
    expect(await bridge.read()).toBe('host text');
  });

  it('keeps local Mux XR copies reusable as before', async () => {
    const bridge = createClipboardBridge(() => refusing(async () => 'quest text'));
    await bridge.copy('local selection');
    expect(await bridge.read()).toBe('local selection');
    expect(await bridge.read()).toBe('local selection');
    expect(await bridge.read({ excludeHost: true })).toBe('local selection');
  });

  it('sends the latest terminal selection when the system read returns older text', async () => {
    const bridge = createClipboardBridge(() => ({
      writeText: async () => undefined,
      readText: async () => 'stale host text',
    }));
    await bridge.copy('host text', { fromHost: true });
    await bridge.copy('quest selection');
    expect(await bridge.read({ excludeHost: true, preferLocal: true })).toBe('quest selection');
  });

  it('never prefers kept host text for a local-first read', async () => {
    const bridge = createClipboardBridge(() => refusing(async () => 'quest text'));
    await bridge.copy('host text', { fromHost: true });
    expect(await bridge.read({ excludeHost: true, preferLocal: true })).toBe('quest text');
  });
});
