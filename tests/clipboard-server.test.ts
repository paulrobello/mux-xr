import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  CLIPBOARD_MAX_BYTES,
  type ClipboardHost,
  ClipboardHostError,
  type ClipboardSecret,
  clientKey,
  clipboardMac,
  createFailureLimiter,
  createMacClipboardHost,
  decodeClipboardText,
  loadClipboardSecret,
} from '../src/server/clipboard-server';
import { attachDictationServer } from '../src/server/dictation-server';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';
const enabled = (): ClipboardSecret => ({ enabled: true, key: Buffer.from(PAIRING) });

const servers: Array<{ server: Server; close: () => Promise<void> }> = [];
const start = async (
  options: {
    loadSecret?: () => ClipboardSecret;
    host?: ClipboardHost;
    now?: () => number;
    authTimeoutMs?: number;
    onEvent?: (event: unknown) => void;
    configured?: boolean;
  } = {},
) => {
  const server = createServer();
  const attached = attachDictationServer(server, {
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard:
      options.configured === false
        ? undefined
        : {
            loadSecret: options.loadSecret ?? enabled,
            host: options.host,
            now: options.now,
            authTimeoutMs: options.authTimeoutMs,
            onEvent: options.onEvent,
          },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `ws://127.0.0.1:${address.port}/clipboard`;
};

type Frame = { binary: boolean; data: Buffer };
type Session = {
  socket: WebSocket;
  frames: Frame[];
  next(): Promise<Frame>;
  json(): Promise<Record<string, unknown>>;
  closed: Promise<number>;
};
const open = (url: string, origin: string | undefined = ORIGIN) =>
  new Promise<Session>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    const frames: Frame[] = [];
    const waiters: Array<(frame: Frame) => void> = [];
    socket.on('message', (data, binary) => {
      const frame = { binary, data: Buffer.from(data as Buffer) };
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    });
    const closed = new Promise<number>((done) => socket.once('close', (code) => done(code)));
    const next = () =>
      new Promise<Frame>((done) => {
        const frame = frames.shift();
        if (frame) done(frame);
        else waiters.push(done);
      });
    socket.once('open', () =>
      resolve({
        socket,
        frames,
        next,
        json: async () => JSON.parse((await next()).data.toString('utf8')),
        closed,
      }),
    );
    socket.once('error', reject);
  });
const upgradeStatus = (url: string, origin?: string) =>
  new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once('open', () => reject(new Error('upgrade unexpectedly accepted')));
    socket.once('error', () => undefined);
  });
const authenticate = async (session: Session, op: 'read' | 'write', key = PAIRING) => {
  const challenge = await session.json();
  expect(challenge.type).toBe('challenge');
  const mac = clipboardMac(Buffer.from(key), String(challenge.nonce), op).toString('base64');
  session.socket.send(JSON.stringify({ type: 'auth', op, mac }));
};
const fakeHost = (text = 'host text 界') => {
  const written: string[] = [];
  const host: ClipboardHost = {
    read: vi.fn(async () => text),
    write: vi.fn(async (value: string) => {
      written.push(value);
    }),
  };
  return { host, written };
};

afterEach(async () => {
  for (const entry of servers.splice(0)) {
    await entry.close();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
});

describe('clipboard route auth', () => {
  it('reports disabled when no secret file is configured and never touches the pasteboard', async () => {
    const { host } = fakeHost();
    const url = await start({ configured: false });
    const session = await open(url);
    expect(await session.json()).toMatchObject({ type: 'error', code: 'disabled' });
    expect(await session.closed).toBe(1008);
    const configuredButMissing = await start({
      loadSecret: () => ({ enabled: false, reason: 'secret file is missing' }),
      host,
    });
    const second = await open(configuredButMissing);
    expect(await second.json()).toMatchObject({ code: 'disabled' });
    expect(host.read).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret, a malformed auth message and a missing auth', async () => {
    const { host } = fakeHost();
    const url = await start({ host, authTimeoutMs: 50 });
    const wrong = await open(url);
    await authenticate(wrong, 'read', 'some-other-pairing-value');
    expect(await wrong.json()).toMatchObject({ type: 'error', code: 'auth' });
    expect(await wrong.closed).toBe(1008);

    const malformed = await open(url);
    await malformed.json();
    malformed.socket.send(JSON.stringify({ type: 'auth', op: 'read', mac: 'short' }));
    expect(await malformed.json()).toMatchObject({ code: 'auth' });

    const silent = await open(url);
    await silent.json();
    expect(await silent.json()).toMatchObject({ code: 'auth' });
    expect(await silent.closed).toBe(1008);
    expect(host.read).not.toHaveBeenCalled();
  });

  it('binds the MAC to the operation so a read proof cannot authorize a write', async () => {
    const { host } = fakeHost();
    const url = await start({ host });
    const session = await open(url);
    const challenge = await session.json();
    const mac = clipboardMac(Buffer.from(PAIRING), String(challenge.nonce), 'read');
    session.socket.send(JSON.stringify({ type: 'auth', op: 'write', mac: mac.toString('base64') }));
    expect(await session.json()).toMatchObject({ code: 'auth' });
    expect(host.write).not.toHaveBeenCalled();
  });

  it('rejects a bad or missing origin and a query string before upgrading', async () => {
    const url = await start();
    expect(await upgradeStatus(url, 'https://evil.test')).toBe(403);
    expect(await upgradeStatus(url)).toBe(403);
    expect(await upgradeStatus(`${url}?secret=x`, ORIGIN)).toBe(403);
  });

  it('refuses an IP after five auth failures a minute until the window passes', async () => {
    let now = 1_000;
    const { host } = fakeHost();
    const url = await start({ host, now: () => now });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const session = await open(url);
      await authenticate(session, 'read', 'some-other-pairing-value');
      await session.closed;
    }
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    now += 60_001;
    const session = await open(url);
    await authenticate(session, 'read');
    expect((await session.next()).data.toString('utf8')).toBe('host text 界');
  });
});

describe('clipboard route transfers', () => {
  it('sends the host clipboard to the Quest as one binary UTF-8 frame', async () => {
    const { host } = fakeHost('host text 界 😀');
    const events: unknown[] = [];
    const url = await start({ host, onEvent: (event) => events.push(event) });
    const session = await open(url);
    await authenticate(session, 'read');
    const frame = await session.next();
    expect(frame.binary).toBe(true);
    expect(frame.data.toString('utf8')).toBe('host text 界 😀');
    expect(await session.closed).toBe(1000);
    expect(events).toEqual([
      { kind: 'transfer', direction: 'host-to-quest', bytes: Buffer.byteLength('host text 界 😀') },
    ]);
    expect(JSON.stringify(events)).not.toContain('host text');
  });

  it('writes Quest text to the host only after auth succeeds', async () => {
    const { host, written } = fakeHost();
    const url = await start({ host });
    const session = await open(url);
    await authenticate(session, 'write');
    expect(await session.json()).toEqual({ type: 'ready' });
    session.socket.send(Buffer.from('quest text\n界'), { binary: true });
    expect(await session.json()).toEqual({
      type: 'ok',
      bytes: Buffer.byteLength('quest text\n界'),
    });
    expect(written).toEqual(['quest text\n界']);
  });

  it('caps writes at 256 KiB and accepts exactly the cap', async () => {
    const { host, written } = fakeHost();
    const url = await start({ host });
    const atCap = await open(url);
    await authenticate(atCap, 'write');
    await atCap.json();
    atCap.socket.send(Buffer.alloc(CLIPBOARD_MAX_BYTES, 'a'), { binary: true });
    expect(await atCap.json()).toMatchObject({ type: 'ok', bytes: CLIPBOARD_MAX_BYTES });

    const over = await open(url);
    await authenticate(over, 'write');
    await over.json();
    over.socket.send(Buffer.alloc(CLIPBOARD_MAX_BYTES + 1, 'a'), { binary: true });
    expect(await over.closed).toBe(1009);
    expect(written).toHaveLength(1);
  });

  it('rejects NUL bytes, invalid UTF-8 and text frames on write', async () => {
    const { host } = fakeHost();
    const url = await start({ host });
    for (const [payload, binary, close] of [
      [Buffer.from('a\0b'), true, 1007],
      [Buffer.from([0xff, 0xfe, 0x41]), true, 1007],
      [Buffer.from('plain text frame'), false, 1003],
    ] as const) {
      const session = await open(url);
      await authenticate(session, 'write');
      await session.json();
      session.socket.send(payload, { binary });
      expect(await session.json()).toMatchObject({ type: 'error', code: 'invalid_text' });
      expect(await session.closed).toBe(close);
    }
    expect(host.write).not.toHaveBeenCalled();
  });

  it('reports an oversized or non-text host clipboard without sending it', async () => {
    for (const code of ['too_large', 'invalid_text'] as const) {
      const host: ClipboardHost = {
        read: async () => {
          throw new ClipboardHostError(code);
        },
        write: async () => undefined,
      };
      const url = await start({ host });
      const session = await open(url);
      await authenticate(session, 'read');
      expect(await session.json()).toMatchObject({ type: 'error', code });
      expect(await session.closed).toBe(1011);
      expect(session.frames.filter((frame) => frame.binary)).toEqual([]);
    }
  });

  it('keeps /dictate behavior unchanged', async () => {
    const url = (await start()).replace('/clipboard', '/other');
    expect(await upgradeStatus(url, ORIGIN)).toBe(403);
  });
});

describe('clipboard text and secret validation', () => {
  it('decodes capped UTF-8 text without NUL', () => {
    expect(decodeClipboardText(Buffer.from('ok 界'))).toEqual({ ok: true, text: 'ok 界' });
    expect(decodeClipboardText(Buffer.alloc(CLIPBOARD_MAX_BYTES + 1))).toEqual({
      ok: false,
      code: 'too_large',
    });
    expect(decodeClipboardText(Buffer.from([0xc3]))).toEqual({ ok: false, code: 'invalid_text' });
    expect(decodeClipboardText(Buffer.from('a\0'))).toEqual({ ok: false, code: 'invalid_text' });
  });

  const fs = (mode: number, contents: string, uid = 501) => ({
    open: () => ({
      isFile: true,
      mode: 0o100000 | mode,
      uid,
      data: Buffer.from(contents),
      truncated: false,
    }),
    uid: () => 501,
  });

  it('never defaults a secret and refuses loose, empty, short or foreign files', () => {
    expect(loadClipboardSecret(undefined)).toMatchObject({ enabled: false });
    expect(
      loadClipboardSecret('/missing', {
        ...fs(0o600, PAIRING),
        open: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toEqual({ enabled: false, reason: 'secret file is missing or unreadable' });
    expect(loadClipboardSecret('/f', fs(0o644, PAIRING))).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('chmod 600'),
    });
    expect(loadClipboardSecret('/f', fs(0o640, PAIRING))).toMatchObject({ enabled: false });
    expect(loadClipboardSecret('/f', fs(0o600, '\n  \n'))).toEqual({
      enabled: false,
      reason: 'secret file is empty',
    });
    expect(loadClipboardSecret('/f', fs(0o600, 'short'))).toMatchObject({ enabled: false });
    expect(loadClipboardSecret('/f', fs(0o600, 'a'.repeat(31)))).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('at least 32 characters'),
    });
    expect(loadClipboardSecret('/f', fs(0o600, 'a'.repeat(32)))).toMatchObject({ enabled: true });
    expect(loadClipboardSecret('/f', fs(0o600, PAIRING, 0))).toMatchObject({ enabled: false });
  });

  it('trims the trailing newline openssl writes', () => {
    const secret = loadClipboardSecret('/f', fs(0o600, `${PAIRING}\n`));
    expect(secret).toEqual({ enabled: true, key: Buffer.from(PAIRING) });
  });

  it('limits failures per IP inside a sliding window', () => {
    let now = 0;
    const limiter = createFailureLimiter(() => now, 2, 100);
    limiter.fail('a');
    limiter.fail('a');
    expect(limiter.blocked('a')).toBe(true);
    expect(limiter.blocked('b')).toBe(false);
    now = 101;
    expect(limiter.blocked('a')).toBe(false);
  });
});

describe('macOS clipboard host', () => {
  const fakeExec = (
    result: { stdout?: Buffer; error?: Error & { code?: unknown } } = {},
  ): {
    execFile: Parameters<typeof createMacClipboardHost>[0] extends infer O
      ? O extends { execFile?: infer E }
        ? E
        : never
      : never;
    calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }>;
    stdin: Array<string | Buffer | undefined>;
  } => {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const stdin: Array<string | Buffer | undefined> = [];
    return {
      calls,
      stdin,
      execFile: (file, args, options, callback) => {
        calls.push({ file, args, options });
        queueMicrotask(() => callback(result.error ?? null, result.stdout ?? Buffer.alloc(0)));
        return { stdin: { on: () => undefined, end: (chunk) => void stdin.push(chunk) } };
      },
    };
  };

  it('runs pbcopy without a shell and passes the text on stdin, never argv', async () => {
    const exec = fakeExec();
    await createMacClipboardHost({ execFile: exec.execFile }).write('copy me 界');
    expect(exec.calls).toEqual([
      {
        file: '/usr/bin/pbcopy',
        args: [],
        options: expect.objectContaining({
          shell: false,
          timeout: 5_000,
          env: expect.objectContaining({ LC_CTYPE: 'UTF-8' }),
        }),
      },
    ]);
    expect(String(exec.stdin[0])).toBe('copy me 界');
  });

  it('reads pbpaste output with a size-capped buffer', async () => {
    const exec = fakeExec({ stdout: Buffer.from('pasted 界') });
    await expect(createMacClipboardHost({ execFile: exec.execFile }).read()).resolves.toBe(
      'pasted 界',
    );
    expect(exec.calls[0]).toMatchObject({
      file: '/usr/bin/pbpaste',
      args: [],
      options: { maxBuffer: CLIPBOARD_MAX_BYTES, shell: false },
    });
  });

  it('maps an overflow to too_large and hides process error details', async () => {
    const overflow = Object.assign(new Error('stdout private'), {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    });
    await expect(
      createMacClipboardHost({ execFile: fakeExec({ error: overflow }).execFile }).read(),
    ).rejects.toMatchObject({ code: 'too_large', message: 'too_large' });
    await expect(
      createMacClipboardHost({
        execFile: fakeExec({ error: new Error('private') }).execFile,
      }).read(),
    ).rejects.toMatchObject({ code: 'host_failed', message: 'host_failed' });
    await expect(
      createMacClipboardHost({
        execFile: fakeExec({ stdout: Buffer.from('a\0') }).execFile,
      }).read(),
    ).rejects.toMatchObject({ code: 'invalid_text' });
  });

  it('refuses NUL and oversized text before spawning pbcopy', async () => {
    const exec = fakeExec();
    const host = createMacClipboardHost({ execFile: exec.execFile });
    await expect(host.write('a\0b')).rejects.toMatchObject({ code: 'invalid_text' });
    await expect(host.write('a'.repeat(CLIPBOARD_MAX_BYTES + 1))).rejects.toMatchObject({
      code: 'too_large',
    });
    expect(exec.calls).toEqual([]);
  });
});

describe('security review fixes', () => {
  it('F1: survives pbcopy exiting before it reads stdin (real early-exit binary, 256 KiB)', async () => {
    const host = createMacClipboardHost({ pbcopy: '/usr/bin/true' });
    for (let attempt = 0; attempt < 3; attempt += 1)
      await host.write('a'.repeat(CLIPBOARD_MAX_BYTES)).catch((error) => {
        expect(error).toMatchObject({ code: 'host_failed' });
      });
  });

  it('F1: maps a stdin error from a fake early-exit pbcopy to host_failed', async () => {
    const host = createMacClipboardHost({
      execFile: (_file, _args, _options, callback) => {
        let onError: ((error: Error) => void) | undefined;
        setTimeout(() => callback(null, Buffer.alloc(0)), 5);
        return {
          stdin: {
            on: (_event, listener) => {
              onError = listener;
            },
            end: () => onError?.(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })),
          },
        };
      },
    });
    await expect(host.write('text')).rejects.toMatchObject({ code: 'host_failed' });
  });

  it('F4: counts in-flight auth attempts toward the per-IP limit', async () => {
    const url = await start({ authTimeoutMs: 2_000 });
    const pending: Session[] = [];
    for (let index = 0; index < 5; index += 1) {
      const session = await open(url);
      await session.json();
      pending.push(session);
    }
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    for (const session of pending) session.socket.close();
    await Promise.all(pending.map((session) => session.closed));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await open(url);
    expect(await after.json()).toMatchObject({ type: 'challenge' });
  });

  it('F4: checks the block again at auth time, even with the right secret', async () => {
    const real = createFailureLimiter();
    let blockedNow = false;
    const limiter = { ...real, blocked: (key: string) => blockedNow || real.blocked(key) };
    const { host } = fakeHost();
    const server = createServer();
    const attached = attachDictationServer(server, {
      allowedOrigins: [ORIGIN],
      transcribe: async () => 'unused',
      clipboard: { loadSecret: enabled, host, limiter },
    });
    servers.push({ server, close: attached.close });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    const session = await open(`ws://127.0.0.1:${address.port}/clipboard`);
    const challenge = await session.json();
    blockedNow = true;
    const mac = clipboardMac(Buffer.from(PAIRING), String(challenge.nonce), 'read');
    session.socket.send(JSON.stringify({ type: 'auth', op: 'read', mac: mac.toString('base64') }));
    expect(await session.json()).toMatchObject({ code: 'auth' });
    expect(host.read).not.toHaveBeenCalled();
  });

  it('F4: caps concurrent clipboard connections', async () => {
    const server = createServer();
    const attached = attachDictationServer(server, {
      allowedOrigins: [ORIGIN],
      transcribe: async () => 'unused',
      clipboard: { loadSecret: enabled, maxConnections: 2, authTimeoutMs: 2_000 },
    });
    servers.push({ server, close: attached.close });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    const url = `ws://127.0.0.1:${address.port}/clipboard`;
    await open(url);
    await open(url);
    expect(await upgradeStatus(url, ORIGIN)).toBe(503);
  });

  it('F4: groups IPv6 clients by /64 and sweeps expired limiter entries', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe(clientKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(clientKey('2001:db8:1:2::1')).not.toBe(clientKey('2001:db8:1:3::1'));
    expect(clientKey('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(clientKey('192.168.1.5')).toBe('192.168.1.5');
    expect(clientKey(undefined)).toBe('unknown');
    let now = 0;
    const limiter = createFailureLimiter(() => now, 5, 100);
    for (const key of ['a', 'b', 'c']) limiter.fail(key);
    expect(limiter.size()).toBe(3);
    now = 200;
    expect(limiter.size()).toBe(0);
    const done = limiter.begin('d');
    expect(limiter.saturated('d')).toBe(false);
    done();
    done();
    expect(limiter.size()).toBe(0);
  });

  it('F7: refuses a symlinked, oversized or loose real secret file and reads a valid one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mux-xr-secret-test-'));
    try {
      const good = join(directory, 'secret');
      writeFileSync(good, `${PAIRING}\n`, { mode: 0o600 });
      expect(loadClipboardSecret(good)).toEqual({ enabled: true, key: Buffer.from(PAIRING) });
      const link = join(directory, 'link');
      symlinkSync(good, link);
      expect(loadClipboardSecret(link)).toEqual({
        enabled: false,
        reason: 'secret path is a symlink',
      });
      const big = join(directory, 'big');
      writeFileSync(big, 'a'.repeat(4097), { mode: 0o600 });
      expect(loadClipboardSecret(big)).toMatchObject({
        enabled: false,
        reason: expect.stringContaining('larger than 4096'),
      });
      const loose = join(directory, 'loose');
      writeFileSync(loose, PAIRING, { mode: 0o600 });
      chmodSync(loose, 0o644);
      expect(loadClipboardSecret(loose)).toMatchObject({ enabled: false });
      expect(loadClipboardSecret(directory)).toMatchObject({
        enabled: false,
        reason: 'secret path is not a regular file',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('F8: runs one host clipboard operation at a time', async () => {
    let active = 0;
    let peak = 0;
    const host: ClipboardHost = {
      read: async () => 'unused',
      write: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      },
    };
    const url = await start({ host });
    const sessions = await Promise.all([open(url), open(url), open(url)]);
    await Promise.all(
      sessions.map(async (session) => {
        await authenticate(session, 'write');
        await session.json();
        session.socket.send(Buffer.from('x'), { binary: true });
        expect(await session.json()).toMatchObject({ type: 'ok' });
      }),
    );
    expect(peak).toBe(1);
  });
});
