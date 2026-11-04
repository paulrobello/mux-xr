import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { attachDictationServer } from '../src/server/dictation-server';

const servers: Array<{ server: Server; close: () => Promise<void> }> = [];
const start = async (
  transcribe: Parameters<typeof attachDictationServer>[1]['transcribe'],
  timeoutMs?: number,
  telemetry?: Parameters<typeof attachDictationServer>[1]['telemetry'],
) => {
  const server = createServer();
  const attached = attachDictationServer(server, {
    allowedOrigins: ['https://allowed.test'],
    transcribe,
    timeoutMs,
    telemetry,
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `ws://127.0.0.1:${address.port}/dictate`;
};
const connect = (url: string, origin?: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
const nextMessage = (socket: WebSocket) =>
  new Promise<Record<string, string>>((resolve) =>
    socket.once('message', (data) =>
      resolve(JSON.parse(data.toString()) as Record<string, string>),
    ),
  );

afterEach(async () => {
  for (const entry of servers.splice(0)) {
    await entry.close();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
});

describe('local dictation server', () => {
  it.each(['success', 'error', 'timeout', 'cancelled'] as const)(
    'records %s without exposing text to telemetry',
    async (outcome) => {
      let started!: () => void, ended!: (value: string) => void;
      const begin = new Promise<void>((done) => {
        started = done;
      });
      const end = new Promise<string>((done) => {
        ended = done;
      });
      const finish = vi.fn((value: string) => ended(value));
      const telemetry = {
        connected: vi.fn(),
        disconnected: vi.fn(),
        rejected: vi.fn(),
        beginTranscription: vi.fn((_bytes: number) => finish),
      };
      const url = await start(
        async (_bytes, signal) => {
          started();
          if (outcome === 'success') return 'private transcript';
          if (outcome === 'error') throw new Error('private error details');
          return new Promise<string>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        },
        20,
        telemetry,
      );
      const socket = await connect(url, 'https://allowed.test');
      socket.send(Buffer.from('audio'));
      await begin;
      if (outcome === 'cancelled') socket.close();
      await expect(end).resolves.toBe(outcome);
      expect(telemetry.beginTranscription).toHaveBeenCalledExactlyOnceWith(5);
      expect(finish).toHaveBeenCalledExactlyOnceWith(outcome);
    },
  );

  it('continues dictation when telemetry hooks throw', async () => {
    const failed = (): never => {
      throw new Error('observer unavailable');
    };
    const url = await start(async () => 'still works', undefined, {
      connected: failed,
      disconnected: failed,
      rejected: failed,
      beginTranscription: failed,
    });
    const socket = await connect(url, 'https://allowed.test');
    const message = nextMessage(socket);
    socket.send(Buffer.from('audio'));
    await expect(message).resolves.toMatchObject({ type: 'transcript', text: 'still works' });
  });
  it('transcribes one allowed binary clip', async () => {
    const url = await start(async (bytes) => `heard ${bytes.length}`);
    const socket = await connect(url, 'https://allowed.test');
    const message = nextMessage(socket);
    socket.send(Buffer.from('audio'));
    await expect(message).resolves.toEqual({ type: 'transcript', text: 'heard 5' });
  });

  it('rejects missing and disallowed origins and wrong paths', async () => {
    const url = await start(async () => 'unused');
    await expect(connect(url)).rejects.toBeTruthy();
    await expect(connect(url, 'https://other.test')).rejects.toBeTruthy();
    await expect(
      connect(url.replace('/dictate', '/wrong'), 'https://allowed.test'),
    ).rejects.toBeTruthy();
  });

  it('cancels an active transcription when the client closes', async () => {
    let aborted = false;
    const url = await start(
      (_bytes, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    const socket = await connect(url, 'https://allowed.test');
    socket.send(Buffer.from('audio'));
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(aborted).toBe(true);
  });

  it('rejects text messages and concurrent jobs', async () => {
    let release: (() => void) | undefined;
    let firstAborted = false;
    const url = await start(
      (_bytes, signal) =>
        new Promise<string>((resolve) => {
          release = () => resolve('done');
          signal.addEventListener(
            'abort',
            () => {
              firstAborted = true;
            },
            { once: true },
          );
        }),
    );
    const first = await connect(url, 'https://allowed.test');
    const second = await connect(url, 'https://allowed.test');
    first.send(Buffer.from('audio'));
    const busy = nextMessage(second);
    second.send(Buffer.from('audio'));
    await expect(busy).resolves.toMatchObject({ type: 'error' });
    second.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(firstAborted).toBe(false);
    const textError = nextMessage(first);
    first.send('not binary');
    await expect(textError).resolves.toMatchObject({ type: 'error' });
    release?.();
  });

  it('reports a timeout and closes the timed-out socket', async () => {
    const url = await start(
      (_bytes, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      5,
    );
    const socket = await connect(url, 'https://allowed.test');
    const message = nextMessage(socket);
    socket.send(Buffer.from('audio'));
    await expect(message).resolves.toMatchObject({
      type: 'error',
      message: 'Local dictation timed out.',
    });
  });

  it('closes oversized binary payloads at the WebSocket boundary', async () => {
    const url = await start(async () => 'unused');
    const socket = await connect(url, 'https://allowed.test');
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    socket.send(Buffer.alloc(8 * 1024 * 1024 + 1));
    await expect(closed).resolves.toBe(1009);
  });
});
