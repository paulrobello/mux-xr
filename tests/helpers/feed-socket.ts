import { webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { expect } from 'vitest';
import WebSocket from 'ws';
import type { HostClipboardSocket } from '../../src/host-clipboard';
import { createHostFeedClient, type HostFeedResult } from '../../src/host-feed';
import { type ClipboardSecret, createFailureLimiter } from '../../src/server/clipboard-server';
import {
  attachDictationServer,
  type DictationServerOptions,
} from '../../src/server/dictation-server';
import { feedMac } from '../../src/server/feed-route';

export const PAIRING = 'not-a-real-pairing-value-for-tests-only';
export const WRONG_PAIRING = 'a-different-pairing-value-for-tests';
export const ORIGIN = 'https://allowed.test';
export const enabledSecret = (): ClipboardSecret => ({
  enabled: true,
  key: Buffer.from(PAIRING),
});

const servers: Array<{ server: Server; close: () => Promise<void> }> = [];

/** A dictation server on a loopback port with clipboard pairing and the given feed options. */
export const startFeedServer = async (
  options: Omit<DictationServerOptions, 'allowedOrigins' | 'transcribe' | 'clipboard'> & {
    paired?: boolean;
  },
) => {
  const server = createServer();
  const limiter = createFailureLimiter();
  const { paired, ...rest } = options;
  const attached = attachDictationServer(server, {
    ...rest,
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard:
      paired === false
        ? undefined
        : {
            loadSecret: enabledSecret,
            limiter,
            host: { read: async () => '', write: async () => undefined },
          },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return { base: `ws://127.0.0.1:${address.port}`, limiter };
};

export const stopFeedServers = async (): Promise<void> => {
  for (const entry of servers.splice(0)) {
    await entry.close();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
};

type Session = {
  socket: WebSocket;
  json(): Promise<Record<string, unknown>>;
  closed: Promise<number>;
};

export const openFeed = (url: string, origin: string | undefined = ORIGIN) =>
  new Promise<Session>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    const frames: string[] = [];
    const waiters: Array<(frame: string) => void> = [];
    socket.on('message', (data) => {
      const text = Buffer.from(data as Buffer).toString('utf8');
      const waiter = waiters.shift();
      if (waiter) waiter(text);
      else frames.push(text);
    });
    const closed = new Promise<number>((done) => socket.once('close', (code) => done(code)));
    const next = () =>
      new Promise<string>((done) => {
        const frame = frames.shift();
        if (frame !== undefined) done(frame);
        else waiters.push(done);
      });
    socket.once('open', () =>
      resolve({ socket, json: async () => JSON.parse(await next()), closed }),
    );
    socket.once('error', reject);
  });

/** One signed request; `signed` overrides the text the MAC covers. */
export const requestFeed = async (
  url: string,
  protocol: string,
  request: string,
  key = PAIRING,
  signed = request,
) => {
  const session = await openFeed(url);
  const challenge = await session.json();
  expect(challenge).toMatchObject({ type: 'challenge', protocol });
  const mac = feedMac(Buffer.from(key), protocol, String(challenge.nonce), signed).toString(
    'base64',
  );
  session.socket.send(JSON.stringify({ type: 'auth', request, mac }));
  return { reply: await session.json(), code: await session.closed };
};

export const upgradeStatus = (url: string, origin?: string) =>
  new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once('open', () => reject(new Error('upgrade unexpectedly accepted')));
    socket.once('error', () => undefined);
  });

/** The browser client against a real route. */
export const clientRequest = <T>(
  url: string,
  protocol: string,
  parse: (data: unknown) => T | null,
  request: string,
  secret: string | null = PAIRING,
): Promise<HostFeedResult<T>> =>
  createHostFeedClient({
    protocol,
    parse,
    url: () => url,
    secret: () => secret,
    socketFactory: (target) =>
      new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket,
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
  })(request);
