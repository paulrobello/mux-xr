import { webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  checkHostClipboardText,
  createHostClipboardClient,
  createHostClipboardSecretStore,
  HOST_CLIPBOARD_MAX_BYTES,
  HOST_CLIPBOARD_SECRET_KEY,
  type HostClipboardSocket,
} from '../src/host-clipboard';
import type { ClipboardHost, ClipboardSecret } from '../src/server/clipboard-server';
import { attachDictationServer } from '../src/server/dictation-server';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';
const servers: Array<{ server: Server; close: () => Promise<void> }> = [];

const start = async (loadSecret: () => ClipboardSecret, host: ClipboardHost) => {
  const server = createServer();
  const attached = attachDictationServer(server, {
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard: { loadSecret, host },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `ws://127.0.0.1:${address.port}/clipboard`;
};
const socketFactory = vi.fn(
  (url: string) => new WebSocket(url, { origin: ORIGIN }) as unknown as HostClipboardSocket,
);
const client = (url: string, secret: string | null = PAIRING) =>
  createHostClipboardClient({
    url: () => url,
    secret: () => secret,
    socketFactory,
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
    timeoutMs: 2_000,
  });
const enabled = (): ClipboardSecret => ({ enabled: true, key: Buffer.from(PAIRING) });
const fakeHost = (text = 'host 界 😀') => {
  const written: string[] = [];
  return {
    written,
    host: {
      read: vi.fn(async () => text),
      write: vi.fn(async (value: string) => {
        written.push(value);
      }),
    } satisfies ClipboardHost,
  };
};

afterEach(async () => {
  socketFactory.mockClear();
  for (const entry of servers.splice(0)) {
    await entry.close();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
});

describe('host clipboard client against the real route', () => {
  it('reads host text through the HMAC challenge', async () => {
    const { host } = fakeHost();
    const url = await start(enabled, host);
    await expect(client(url).read()).resolves.toEqual({ ok: true, value: 'host 界 😀' });
  });

  it('writes Quest text to the host', async () => {
    const { host, written } = fakeHost();
    const url = await start(enabled, host);
    await expect(client(url).write('quest\ttext 界')).resolves.toEqual({
      ok: true,
      value: Buffer.byteLength('quest\ttext 界'),
    });
    expect(written).toEqual(['quest\ttext 界']);
  });

  it('reports a wrong secret and a disabled host with setup guidance', async () => {
    const { host } = fakeHost();
    const url = await start(enabled, host);
    await expect(client(url, 'some-other-pairing-value').read()).resolves.toMatchObject({
      ok: false,
      code: 'auth',
    });
    const off = await start(() => ({ enabled: false, reason: 'missing' }), host);
    const result = await client(off).write('x');
    expect(result).toMatchObject({ ok: false, code: 'disabled' });
    expect(result.ok ? '' : result.message).toContain('make install-whisper-agent');
    expect(host.read).not.toHaveBeenCalled();
    expect(host.write).not.toHaveBeenCalled();
  });

  it('refuses locally without a secret, over the cap or with NUL, before connecting', async () => {
    const url = 'ws://127.0.0.1:9/clipboard';
    await expect(client(url, null).read()).resolves.toMatchObject({ code: 'no-secret' });
    await expect(
      client(url).write('a'.repeat(HOST_CLIPBOARD_MAX_BYTES + 1)),
    ).resolves.toMatchObject({ code: 'too-large' });
    await expect(client(url).write('a\0b')).resolves.toMatchObject({ code: 'invalid-text' });
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it('reports an unreachable host', async () => {
    await expect(client('ws://127.0.0.1:9/clipboard').read()).resolves.toMatchObject({
      ok: false,
      code: 'unavailable',
    });
  });

  it('measures the cap in UTF-8 bytes', () => {
    expect(checkHostClipboardText('界'.repeat(HOST_CLIPBOARD_MAX_BYTES / 3))).toMatchObject({
      ok: true,
    });
    expect(checkHostClipboardText('界'.repeat(HOST_CLIPBOARD_MAX_BYTES / 3 + 1))).toEqual({
      ok: false,
      code: 'too-large',
    });
  });
});

describe('host clipboard secret store', () => {
  it('saves trimmed under its own key and forgets', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const store = createHostClipboardSecretStore(() => storage);
    expect(store.get()).toBeNull();
    expect(store.set('   ')).toBe(false);
    expect(store.set(`  ${PAIRING}\n`)).toBe(true);
    expect(values.get(HOST_CLIPBOARD_SECRET_KEY)).toBe(PAIRING);
    expect(store.get()).toBe(PAIRING);
    store.forget();
    expect(store.get()).toBeNull();
    expect([...values.keys()]).toEqual([]);
  });

  it('survives unavailable storage', () => {
    const store = createHostClipboardSecretStore(() => {
      throw new Error('blocked');
    });
    expect(store.get()).toBeNull();
    expect(store.set(PAIRING)).toBe(false);
    expect(() => store.forget()).not.toThrow();
  });
});

describe('host clipboard challenge validation (F8)', () => {
  const run = (frames: string[]) => {
    const sent: unknown[] = [];
    const factory = () => {
      const socket: HostClipboardSocket = {
        binaryType: 'blob',
        readyState: 1,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: (data) => void sent.push(data),
        close: () => undefined,
      };
      setTimeout(() => {
        for (const data of frames) socket.onmessage?.({ data });
      }, 0);
      return socket;
    };
    const result = createHostClipboardClient({
      url: () => 'wss://host.test/clipboard',
      secret: () => PAIRING,
      socketFactory: factory,
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
      timeoutMs: 500,
    }).read();
    return { result, sent };
  };
  const nonce = Buffer.alloc(32, 7).toString('base64');

  it('refuses a malformed nonce without answering it', async () => {
    for (const bad of ['short', `${nonce}x`, 'a'.repeat(44)]) {
      const { result, sent } = run([JSON.stringify({ type: 'challenge', nonce: bad })]);
      await expect(result).resolves.toMatchObject({ ok: false, code: 'unavailable' });
      expect(sent).toEqual([]);
    }
  });

  it('refuses a second challenge on the same connection', async () => {
    const challenge = JSON.stringify({ type: 'challenge', nonce });
    const { result } = run([challenge, challenge]);
    await expect(result).resolves.toMatchObject({ ok: false, code: 'unavailable' });
  });
});
