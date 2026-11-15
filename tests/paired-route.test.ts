import { randomBytes, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { type WebSocket as ClientSocket, WebSocket, WebSocketServer } from 'ws';
import type { HostClipboardSocket } from '../src/host-clipboard';
import { openPairedSocket, PAIRED_NONCE_FORMAT } from '../src/host-pairing';
import { HOST_STATS_PROTOCOL, type HostStats } from '../src/server/host-stats-server';
import { pairedHmac } from '../src/server/paired-route';
import { WEATHER_PROTOCOL } from '../src/server/weather-server';
import {
  ORIGIN,
  openFeed,
  PAIRING,
  requestFeed,
  startFeedServer,
  stopFeedServers,
  upgradeStatus,
  WRONG_PAIRING,
} from './helpers/feed-socket';

const STATS: HostStats = { type: 'stats', load: [3.21, 2.8, 2.1], cpu: 42.5, cores: 12 };
const statsSampler = { sample: async () => STATS };
const fakeServers: WebSocketServer[] = [];

afterEach(async () => {
  await stopFeedServers();
  for (const server of fakeServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** A WebSocketServer on a loopback port that runs `wire` per connection. */
const fakeServer = async (wire: (socket: ClientSocket) => void): Promise<string> => {
  const server = new WebSocketServer({ port: 0 });
  fakeServers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No fake server port');
  server.on('connection', wire);
  return `ws://127.0.0.1:${address.port}`;
};

describe('paired-route handshake failures', () => {
  it('rejects origins outside the allow-list with 403', async () => {
    const { base } = await startFeedServer({});
    await expect(upgradeStatus(`${base}/weather`, 'https://other.test')).resolves.toBe(403);
    await expect(upgradeStatus(`${base}/weather`, undefined)).resolves.toBe(403);
  });

  it('blocks a client after repeated auth failures with 429 on every route', async () => {
    const { base } = await startFeedServer({
      hostStats: { sampler: statsSampler },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { reply } = await requestFeed(
        `${base}/host-stats`,
        HOST_STATS_PROTOCOL,
        'stats',
        WRONG_PAIRING,
      );
      expect(reply).toMatchObject({ type: 'error', code: 'auth' });
    }
    await expect(upgradeStatus(`${base}/bookings`, ORIGIN)).resolves.toBe(429);
  });

  it('caps connections per client at 503 and releases the slot on close', async () => {
    const { base } = await startFeedServer({
      hostStats: { sampler: statsSampler, maxConnectionsPerClient: 1 },
    });
    const first = await openFeed(`${base}/host-stats`);
    await expect(upgradeStatus(`${base}/host-stats`, ORIGIN)).resolves.toBe(503);
    first.socket.close();
    await first.closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await openFeed(`${base}/host-stats`);
    await expect(again.json()).resolves.toMatchObject({
      type: 'challenge',
      protocol: HOST_STATS_PROTOCOL,
    });
    again.socket.close();
  });

  it('fails the handshake as auth when the auth timer expires', async () => {
    const { base } = await startFeedServer({
      hostStats: { sampler: statsSampler, authTimeoutMs: 20 },
    });
    const session = await openFeed(`${base}/host-stats`);
    await expect(session.json()).resolves.toMatchObject({
      type: 'challenge',
      protocol: HOST_STATS_PROTOCOL,
    });
    await expect(session.json()).resolves.toMatchObject({ type: 'error', code: 'auth' });
    await expect(session.closed).resolves.toBe(1008);
  });

  it('fails a binary frame during auth as protocol', async () => {
    const { base } = await startFeedServer({});
    const session = await openFeed(`${base}/weather`);
    await expect(session.json()).resolves.toMatchObject({
      type: 'challenge',
      protocol: WEATHER_PROTOCOL,
    });
    session.socket.send(Buffer.alloc(8));
    await expect(session.json()).resolves.toMatchObject({ type: 'error', code: 'protocol' });
    await expect(session.closed).resolves.toBe(1008);
  });

  it('fails malformed JSON during auth as auth', async () => {
    const { base } = await startFeedServer({});
    const session = await openFeed(`${base}/weather`);
    await expect(session.json()).resolves.toMatchObject({
      type: 'challenge',
      protocol: WEATHER_PROTOCOL,
    });
    session.socket.send('not json');
    await expect(session.json()).resolves.toMatchObject({ type: 'error', code: 'auth' });
    await expect(session.closed).resolves.toBe(1008);
  });

  it('rejects a wrong MAC with auth and 1008', async () => {
    const { base } = await startFeedServer({ hostStats: { sampler: statsSampler } });
    const { reply, code } = await requestFeed(
      `${base}/host-stats`,
      HOST_STATS_PROTOCOL,
      'stats',
      WRONG_PAIRING,
    );
    expect(reply).toMatchObject({ type: 'error', code: 'auth' });
    expect(code).toBe(1008);
  });

  it('answers a disabled secret with disabled before any challenge', async () => {
    const { base } = await startFeedServer({ paired: false });
    const session = await openFeed(`${base}/weather`);
    await expect(session.json()).resolves.toMatchObject({ type: 'error', code: 'disabled' });
    await expect(session.closed).resolves.toBe(1008);
  });

  it('closes an authenticated session at the session timeout with 1000', async () => {
    const { base } = await startFeedServer({
      hostStats: { sampler: statsSampler, sessionTimeoutMs: 30 },
    });
    const { reply, code } = await requestFeed(
      `${base}/host-stats`,
      HOST_STATS_PROTOCOL,
      'stats',
      PAIRING,
    );
    expect(reply).toMatchObject({ type: 'stats' });
    expect(code).toBe(1000);
  });
});

describe('openPairedSocket client pairing flow', () => {
  it('answers the challenge with one HMAC auth frame over protocol\\nnonce\\nmaterial', async () => {
    const nonce = randomBytes(32).toString('base64');
    expect(PAIRED_NONCE_FORMAT.test(nonce)).toBe(true);
    let authFrame: Record<string, unknown> | undefined;
    const url = await fakeServer((socket) => {
      socket.on('message', (data) => {
        authFrame = JSON.parse(String(data)) as Record<string, unknown>;
        socket.send(JSON.stringify({ type: 'feed', data: 'ok' }));
      });
      socket.send(JSON.stringify({ type: 'challenge', nonce, protocol: WEATHER_PROTOCOL }));
    });
    const outcome = await openPairedSocket<string, string>({
      url,
      secret: PAIRING,
      protocol: WEATHER_PROTOCOL,
      material: 'weather request text',
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
      socketFactory: (target) => new WebSocket(target) as unknown as HostClipboardSocket,
      timeoutMs: 2000,
      onOpenError: () => 'open-failed',
      onServerError: () => 'server-error',
      onClose: () => null,
      onTimeout: () => 'timeout',
      onMessage: (message) =>
        message !== null &&
        typeof message === 'object' &&
        (message as { type?: string }).type === 'feed'
          ? { ok: true, value: 'settled' }
          : null,
    });
    expect(outcome).toEqual({ ok: true, value: 'settled' });
    expect(authFrame).toEqual({
      type: 'auth',
      mac: pairedHmac(
        Buffer.from(PAIRING),
        WEATHER_PROTOCOL,
        nonce,
        'weather request text',
      ).toString('base64'),
    });
  });

  it('rejects a nonce outside the paired nonce format without sending an auth frame', async () => {
    expect(PAIRED_NONCE_FORMAT.test('too-short')).toBe(false);
    let clientSentFrame = false;
    const url = await fakeServer((socket) => {
      socket.on('message', () => {
        clientSentFrame = true;
      });
      socket.send(
        JSON.stringify({ type: 'challenge', nonce: 'too-short', protocol: WEATHER_PROTOCOL }),
      );
    });
    const outcome = await openPairedSocket<string, string>({
      url,
      secret: PAIRING,
      protocol: WEATHER_PROTOCOL,
      material: 'unused',
      socketFactory: (target) => new WebSocket(target) as unknown as HostClipboardSocket,
      timeoutMs: 2000,
      onOpenError: () => 'bad-nonce',
      onServerError: () => 'server-error',
      onClose: () => null,
      onTimeout: () => 'timeout',
      onMessage: () => null,
    });
    expect(outcome).toEqual({ ok: false, code: 'bad-nonce' });
    expect(clientSentFrame).toBe(false);
  });

  it('completes a real paired session end to end over webcrypto', async () => {
    const { base } = await startFeedServer({ hostStats: { sampler: statsSampler } });
    const outcome = await openPairedSocket<unknown, string>({
      url: `${base}/host-stats`,
      secret: PAIRING,
      protocol: HOST_STATS_PROTOCOL,
      material: 'stats',
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
      socketFactory: (target) =>
        new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket,
      timeoutMs: 2000,
      onOpenError: () => 'open-failed',
      onServerError: (code) => `server-error:${String(code)}`,
      onClose: () => 'closed-early',
      onTimeout: () => 'timeout',
      onMessage: (message) =>
        message !== null &&
        typeof message === 'object' &&
        (message as { type?: string }).type === 'stats'
          ? { ok: true, value: message }
          : null,
    });
    expect(outcome).toMatchObject({ ok: true, value: { type: 'stats' } });
  });
});
