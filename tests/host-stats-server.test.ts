import { webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { HostClipboardSocket } from '../src/host-clipboard';
import { createHostStatsClient } from '../src/host-stats';
import {
  type ClipboardHost,
  type ClipboardSecret,
  clipboardMac,
  createFailureLimiter,
} from '../src/server/clipboard-server';
import { attachDictationServer } from '../src/server/dictation-server';
import {
  cpuPercent,
  createHostStatsSampler,
  createRequestLimiter,
  HOST_STATS_REQUEST_LIMIT,
  type HostStats,
  type HostStatsEvent,
  hostStatsMac,
} from '../src/server/host-stats-server';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';
const enabled = (): ClipboardSecret => ({ enabled: true, key: Buffer.from(PAIRING) });
const STATS: HostStats = { type: 'stats', load: [3.21, 2.8, 2.1], cpu: 42.5, cores: 12 };

const servers: Array<{ server: Server; close: () => Promise<void> }> = [];
const start = async (
  options: {
    loadSecret?: () => ClipboardSecret;
    configured?: boolean;
    sample?: () => Promise<HostStats>;
    authTimeoutMs?: number;
    sessionTimeoutMs?: number;
    maxConnectionsPerClient?: number;
  } = {},
) => {
  const server = createServer();
  const sample = vi.fn(options.sample ?? (async () => STATS));
  const limiter = createFailureLimiter();
  const events: HostStatsEvent[] = [];
  const host: ClipboardHost = { read: async () => 'host text', write: async () => undefined };
  const attached = attachDictationServer(server, {
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard:
      options.configured === false
        ? undefined
        : { loadSecret: options.loadSecret ?? enabled, limiter, host },
    hostStats: {
      sampler: { sample },
      authTimeoutMs: options.authTimeoutMs,
      sessionTimeoutMs: options.sessionTimeoutMs,
      maxConnectionsPerClient: options.maxConnectionsPerClient,
      onEvent: (event) => events.push(event),
    },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return {
    url: `ws://127.0.0.1:${address.port}/host-stats`,
    clipboardUrl: `ws://127.0.0.1:${address.port}/clipboard`,
    sample,
    limiter,
    events,
  };
};

type Session = {
  socket: WebSocket;
  json(): Promise<Record<string, unknown>>;
  closed: Promise<number>;
};
const open = (url: string, origin: string | undefined = ORIGIN) =>
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
const request = async (url: string, key = PAIRING) => {
  const session = await open(url);
  const challenge = await session.json();
  expect(challenge).toMatchObject({ type: 'challenge', protocol: 'mux-xr-host-stats-v1' });
  const mac = hostStatsMac(Buffer.from(key), String(challenge.nonce)).toString('base64');
  session.socket.send(JSON.stringify({ type: 'auth', mac }));
  return { reply: await session.json(), code: await session.closed };
};

afterEach(async () => {
  for (const entry of servers.splice(0)) {
    await entry.close();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
});

describe('host stats route', () => {
  it('returns load, CPU and core count, and nothing else, after the secret proof', async () => {
    const { url, sample } = await start();
    const { reply, code } = await request(url);
    expect(reply).toEqual(STATS);
    expect(Object.keys(reply).sort()).toEqual(['cores', 'cpu', 'load', 'type']);
    expect(code).toBe(1000);
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('round-trips with the browser client', async () => {
    const { url } = await start();
    const client = (secret: string) =>
      createHostStatsClient({
        url: () => url,
        secret: () => secret,
        socketFactory: (target) =>
          new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket,
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
      })();
    expect(await client(PAIRING)).toEqual({
      ok: true,
      value: { load: STATS.load, cpu: STATS.cpu, cores: STATS.cores },
    });
    expect(await client('a-different-pairing-value-for-tests')).toEqual({
      ok: false,
      code: 'auth',
    });
  });

  it('refuses a wrong secret without sampling', async () => {
    const { url, sample } = await start();
    const { reply, code } = await request(url, 'a-different-pairing-value-for-tests');
    expect(reply).toMatchObject({ type: 'error', code: 'auth' });
    expect(code).toBe(1008);
    expect(sample).not.toHaveBeenCalled();
  });

  it('does not accept a clipboard MAC for the same nonce', async () => {
    const { url, sample } = await start();
    const session = await open(url);
    const challenge = await session.json();
    const mac = clipboardMac(Buffer.from(PAIRING), String(challenge.nonce), 'read');
    session.socket.send(JSON.stringify({ type: 'auth', op: 'read', mac: mac.toString('base64') }));
    expect(await session.json()).toMatchObject({ type: 'error', code: 'auth' });
    expect(sample).not.toHaveBeenCalled();
  });

  it('answers disabled when no pairing secret is configured', async () => {
    const { url, sample } = await start({ configured: false });
    const session = await open(url);
    expect(await session.json()).toMatchObject({ type: 'error', code: 'disabled' });
    expect(await session.closed).toBe(1008);
    expect(sample).not.toHaveBeenCalled();
  });

  it('fails auth when no proof arrives in time', async () => {
    const { url } = await start({ authTimeoutMs: 50 });
    const session = await open(url);
    expect((await session.json()).type).toBe('challenge');
    expect(await session.json()).toMatchObject({ type: 'error', code: 'auth' });
  });

  it('refuses other origins, a missing origin and a query string at the upgrade', async () => {
    const { url } = await start();
    expect(await upgradeStatus(url, 'https://evil.test')).toBe(403);
    expect(await upgradeStatus(url)).toBe(403);
    expect(await upgradeStatus(`${url}?x=1`, ORIGIN)).toBe(403);
  });

  it('blocks a client after five failed proofs, shared with the clipboard route', async () => {
    const { url } = await start();
    for (let index = 0; index < 5; index += 1)
      await request(url, 'a-different-pairing-value-for-tests');
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    expect(await upgradeStatus(url.replace('/host-stats', '/clipboard'), ORIGIN)).toBe(429);
  });

  it(`rate-limits successful requests to ${HOST_STATS_REQUEST_LIMIT} a minute`, async () => {
    const { url, sample } = await start();
    for (let index = 0; index < HOST_STATS_REQUEST_LIMIT; index += 1)
      expect((await request(url)).reply.type).toBe('stats');
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    expect(sample).toHaveBeenCalledTimes(HOST_STATS_REQUEST_LIMIT);
  });

  it('caps open connections at 2 per client and 4 in all', async () => {
    const perClient = await start();
    const two = await Promise.all([open(perClient.url), open(perClient.url)]);
    expect(await upgradeStatus(perClient.url, ORIGIN)).toBe(503);
    two[0].socket.close();
    await two[0].closed;
    const third = await open(perClient.url);
    for (const session of [two[1], third]) session.socket.close();
    const total = await start({ maxConnectionsPerClient: 10 });
    const four = await Promise.all(Array.from({ length: 4 }, () => open(total.url)));
    expect(await upgradeStatus(total.url, ORIGIN)).toBe(503);
    for (const session of four) session.socket.close();
  });

  it('logs refusals by code and never successes', async () => {
    const ok = await start();
    await request(ok.url);
    expect(ok.events).toEqual([]);
    await upgradeStatus(ok.url, 'https://evil.test');
    await request(ok.url, 'a-different-pairing-value-for-tests');
    const held = await Promise.all([open(ok.url), open(ok.url)]);
    await upgradeStatus(ok.url, ORIGIN);
    for (const session of held) session.socket.close();
    for (let index = 0; index < 4; index += 1) ok.limiter.fail('127.0.0.1');
    await upgradeStatus(ok.url, ORIGIN);
    const off = await start({ configured: false });
    await (await open(off.url)).closed;
    expect(ok.events.map((event) => event.code)).toEqual([
      'origin',
      'auth',
      'busy',
      'rate_limited',
    ]);
    expect(off.events).toEqual([{ kind: 'refused', code: 'disabled' }]);
  });

  it('leaves /clipboard working after 25 successful stats requests', async () => {
    const { url, clipboardUrl } = await start();
    for (let index = 0; index < 25; index += 1)
      expect((await request(url)).reply.type).toBe('stats');
    const session = await open(clipboardUrl);
    const challenge = await session.json();
    const text = new Promise<string>((resolve) =>
      session.socket.once('message', (data) => resolve(String(data))),
    );
    const mac = clipboardMac(Buffer.from(PAIRING), String(challenge.nonce), 'read');
    session.socket.send(JSON.stringify({ type: 'auth', op: 'read', mac: mac.toString('base64') }));
    expect(await text).toBe('host text');
    expect(await session.closed).toBe(1000);
  });

  it('blocks /host-stats with 429 after five clipboard auth failures', async () => {
    const { url, clipboardUrl } = await start();
    for (let index = 0; index < 5; index += 1) {
      const session = await open(clipboardUrl);
      await session.json();
      session.socket.send(JSON.stringify({ type: 'auth', op: 'read', mac: 'AAAA' }));
      await session.closed;
    }
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
  });

  it('re-checks the block at proof time and does not sample', async () => {
    const { url, sample, limiter } = await start();
    const session = await open(url);
    const challenge = await session.json();
    for (let index = 0; index < 5; index += 1) limiter.fail('127.0.0.1');
    const mac = hostStatsMac(Buffer.from(PAIRING), String(challenge.nonce)).toString('base64');
    session.socket.send(JSON.stringify({ type: 'auth', mac }));
    expect(await session.json()).toMatchObject({ type: 'error', code: 'auth' });
    expect(sample).not.toHaveBeenCalled();
  });

  it('answers protocol to a binary message and to a second message', async () => {
    const binary = await start();
    const first = await open(binary.url);
    await first.json();
    first.socket.send(Buffer.from([1, 2, 3]));
    expect(await first.json()).toMatchObject({ type: 'error', code: 'protocol' });
    const slow = await start({ sample: () => new Promise<HostStats>(() => undefined) });
    const second = await open(slow.url);
    const challenge = await second.json();
    const mac = hostStatsMac(Buffer.from(PAIRING), String(challenge.nonce)).toString('base64');
    second.socket.send(JSON.stringify({ type: 'auth', mac }));
    second.socket.send(JSON.stringify({ type: 'auth', mac }));
    expect(await second.json()).toMatchObject({ type: 'error', code: 'protocol' });
  });

  it('closes with 1011 when sampling fails', async () => {
    const { url } = await start({ sample: async () => Promise.reject(new Error('cpus')) });
    const session = await open(url);
    const challenge = await session.json();
    const mac = hostStatsMac(Buffer.from(PAIRING), String(challenge.nonce)).toString('base64');
    session.socket.send(JSON.stringify({ type: 'auth', mac }));
    expect(await session.closed).toBe(1011);
  });

  it('ends a session that outlives the session timeout', async () => {
    const { url } = await start({
      sample: () => new Promise<HostStats>(() => undefined),
      sessionTimeoutMs: 60,
    });
    const session = await open(url);
    const challenge = await session.json();
    const mac = hostStatsMac(Buffer.from(PAIRING), String(challenge.nonce)).toString('base64');
    session.socket.send(JSON.stringify({ type: 'auth', mac }));
    expect(await session.closed).toBe(1000);
  });
});

describe('request limiter', () => {
  it('blocks at the limit inside the window and frees as entries age out', () => {
    let clock = 0;
    const limiter = createRequestLimiter(() => clock, 2, 1_000);
    limiter.record('a');
    limiter.record('a');
    expect(limiter.blocked('a')).toBe(true);
    expect(limiter.blocked('b')).toBe(false);
    clock = 1_001;
    expect(limiter.blocked('a')).toBe(false);
  });
});

describe('host stats sampler', () => {
  const cpu = (busy: number, idle: number) => ({
    times: { user: busy, nice: 0, sys: 0, idle, irq: 0 },
  });

  it('computes busy share from tick deltas', () => {
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75);
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBeNull();
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 90, total: 300 })).toBeNull();
  });

  it('takes two snapshots on the first call, then deltas against the last one', async () => {
    let clock = 0;
    const ticks = [
      [cpu(100, 900), cpu(100, 900)],
      [cpu(150, 950), cpu(150, 950)],
      [cpu(450, 1050), cpu(450, 1050)],
    ];
    let call = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const sampler = createHostStatsSampler({
      cpus: () => ticks[Math.min(call++, ticks.length - 1)],
      loadavg: () => [16.004, 5, Number.NaN],
      now: () => clock,
      sleep,
    });
    expect(await sampler.sample()).toEqual({
      type: 'stats',
      load: [16, 5, 0],
      cpu: 50,
      cores: 2,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    clock += 5_000;
    expect((await sampler.sample()).cpu).toBe(75);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
