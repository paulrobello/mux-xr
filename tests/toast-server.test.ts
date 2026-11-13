import { webcrypto } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { HostClipboardSocket } from '../src/host-clipboard';
import { createToastSubscription, type ToastSubscriptionState } from '../src/host-toasts';
import type { ClipboardSecret } from '../src/server/clipboard-server';
import { attachDictationServer } from '../src/server/dictation-server';
import {
  bearerMatches,
  createToastHub,
  isLoopbackAddress,
  TOAST_BODY_MAX_BYTES,
  type ToastEvent,
  toastsMac,
} from '../src/server/toast-server';
import type { ToastEnvelope } from '../src/toast-contract';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';
const enabled = (): ClipboardSecret => ({ enabled: true, key: Buffer.from(PAIRING) });

const servers: Array<{ server: Server; close: () => Promise<void> }> = [];
const start = async (options: { loadSecret?: () => ClipboardSecret } = {}) => {
  const events: ToastEvent[] = [];
  let attached: ReturnType<typeof attachDictationServer> | undefined;
  const server = createServer((request, response) => {
    if (attached?.handleRequest(request, response)) return;
    response.writeHead(404);
    response.end();
  });
  let next = 0;
  attached = attachDictationServer(server, {
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard: { loadSecret: options.loadSecret ?? enabled },
    toasts: { onEvent: (event) => events.push(event), makeId: () => `t${++next}` },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return { port: address.port, events };
};

const post = (
  port: number,
  body: string,
  headers: Record<string, string> = {
    authorization: `Bearer ${PAIRING}`,
    'content-type': 'application/json',
  },
  method = 'POST',
) =>
  new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/toast', method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode ?? 0, json: text ? JSON.parse(text) : {} });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });

const subscribe = (port: number, secret = PAIRING) => {
  const envelopes: ToastEnvelope[] = [];
  const states: ToastSubscriptionState[] = [];
  const subscription = createToastSubscription({
    url: () => `ws://127.0.0.1:${port}/toasts`,
    secret: () => secret,
    onEnvelope: (envelope) => envelopes.push(envelope),
    onState: (state) => states.push(state),
    socketFactory: (target) =>
      new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket,
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
  });
  subscription.start();
  return { subscription, envelopes, states };
};

const until = async (check: () => boolean, ms = 2_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

afterEach(async () => {
  for (const entry of servers.splice(0)) {
    await entry.close();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }
});

describe('toast route', () => {
  it('delivers a posted toast to a paired headset with defaults filled in', async () => {
    const { port, events } = await start();
    const headset = subscribe(port);
    await until(() => headset.states.includes('subscribed'));
    const reply = await post(port, JSON.stringify({ message: 'Build finished', level: 'warn' }));
    expect(reply).toEqual({ status: 202, json: { id: 't1', delivered: 1 } });
    await until(() => headset.envelopes.length === 1);
    expect(headset.envelopes[0]).toEqual({
      type: 'toast',
      toast: {
        id: 't1',
        message: 'Build finished',
        title: null,
        level: 'warn',
        color: '#f2b84b',
        timeout: 10,
        placement: 'top',
        paneId: null,
        source: null,
      },
    });
    expect(events).toContainEqual({ kind: 'toast', level: 'warn', delivered: 1 });
    headset.subscription.stop();
  });

  it('replays live toasts to a headset that connects later and forwards dismissals', async () => {
    const { port } = await start();
    await post(port, JSON.stringify({ id: 'deploy', message: 'Deploying', timeout: 0 }));
    await post(port, JSON.stringify({ id: 'gone', message: 'Cleared before anyone looked' }));
    await post(port, JSON.stringify({ id: 'gone', dismiss: true }));
    const headset = subscribe(port);
    await until(() => headset.envelopes.length === 1);
    expect(
      headset.envelopes.map((envelope) => envelope.type === 'toast' && envelope.toast.id),
    ).toEqual(['deploy']);
    expect((await post(port, JSON.stringify({ id: 'deploy', dismiss: true }))).json).toEqual({
      id: 'deploy',
      delivered: 1,
    });
    await until(() => headset.envelopes.length === 2);
    expect(headset.envelopes[1]).toEqual({ type: 'dismiss', id: 'deploy' });
    headset.subscription.stop();
  });

  it('lets a headset dismiss a sticky toast for every headset, so it never replays', async () => {
    const { port } = await start();
    await post(port, JSON.stringify({ id: 'sticky', message: 'Until dismissed', timeout: 0 }));
    await post(port, JSON.stringify({ id: 'timed', message: 'Ten seconds', timeout: 10 }));
    const a = subscribe(port);
    const c = subscribe(port);
    await until(() => a.envelopes.length === 2 && c.envelopes.length === 2);
    const replayed = a.envelopes.find(
      (envelope) => envelope.type === 'toast' && envelope.toast.id === 'timed',
    );
    expect(replayed).toMatchObject({ replay: true, toast: { timeout: 10 } });
    expect(a.subscription.dismiss('sticky')).toBe(true);
    await until(() => c.envelopes.length === 3);
    expect(c.envelopes[2]).toEqual({ type: 'dismiss', id: 'sticky' });
    const b = subscribe(port);
    await until(() => b.states.includes('subscribed'));
    await until(() => b.envelopes.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(b.envelopes.map((envelope) => envelope.type === 'toast' && envelope.toast.id)).toEqual([
      'timed',
    ]);
    for (const headset of [a, b, c]) headset.subscription.stop();
  });

  it('closes a subscriber that sends anything but a dismissal', async () => {
    const { port } = await start();
    const session = new WebSocket(`ws://127.0.0.1:${port}/toasts`, { origin: ORIGIN });
    const frames: Array<Record<string, unknown>> = [];
    session.on('message', (data) => frames.push(JSON.parse(String(data))));
    await until(() => frames.length === 1);
    const mac = toastsMac(Buffer.from(PAIRING), String(frames[0].nonce)).toString('base64');
    session.send(JSON.stringify({ type: 'auth', mac }));
    await until(() => frames.some((frame) => frame.type === 'ready'));
    const closed = new Promise<number>((done) => session.once('close', (code) => done(code)));
    session.send(JSON.stringify({ type: 'toast', toast: { id: 'x', message: 'forged' } }));
    expect(await closed).toBe(1008);
  });

  it('refuses a missing or wrong bearer token, a browser Origin and other methods', async () => {
    const { port } = await start();
    const json = { 'content-type': 'application/json' };
    expect((await post(port, '{"message":"x"}', json)).status).toBe(401);
    expect(
      (
        await post(port, '{"message":"x"}', {
          ...json,
          authorization: 'Bearer wrong-pairing-value-xyz',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post(port, '{"message":"x"}', {
          ...json,
          authorization: `Bearer ${PAIRING}`,
          origin: 'https://evil.test',
        })
      ).status,
    ).toBe(403);
    expect((await post(port, '', { authorization: `Bearer ${PAIRING}` }, 'GET')).status).toBe(405);
  });

  it('rejects bad bodies with a reason', async () => {
    const { port } = await start();
    expect(
      (await post(port, '{"message":"x"}', { authorization: `Bearer ${PAIRING}` })).status,
    ).toBe(415);
    expect((await post(port, 'not json')).status).toBe(400);
    const level = await post(port, JSON.stringify({ message: 'x', level: 'fatal' }));
    expect(level.status).toBe(400);
    expect(level.json.error).toMatch(/level must be one of info, success, warn, error/);
    expect((await post(port, JSON.stringify({ message: 'x', color: 'red' }))).status).toBe(400);
    expect((await post(port, JSON.stringify({ message: 'x', timeout: -1 }))).status).toBe(400);
    expect((await post(port, JSON.stringify({ message: 'x', placement: 'left' }))).status).toBe(
      400,
    );
    expect((await post(port, JSON.stringify({ dismiss: true }))).status).toBe(400);
    expect((await post(port, 'x'.repeat(TOAST_BODY_MAX_BYTES + 1))).status).toBe(413);
  });

  it('answers 503 while no pairing secret is configured, and refuses unpaired headsets', async () => {
    const { port } = await start({ loadSecret: () => ({ enabled: false, reason: 'none' }) });
    expect((await post(port, '{"message":"x"}')).status).toBe(503);
    const headset = subscribe(port);
    await until(() => headset.states.includes('refused'));
    headset.subscription.stop();
  });

  it('never subscribes a headset whose secret is wrong', async () => {
    const { port } = await start();
    const headset = subscribe(port, 'a-different-pairing-value-for-tests');
    await until(() => headset.states.includes('refused'));
    await post(port, JSON.stringify({ message: 'secret news' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(headset.envelopes).toEqual([]);
    headset.subscription.stop();
  });

  it('does not accept a MAC from another route', () => {
    const key = Buffer.from(PAIRING);
    expect(toastsMac(key, 'n').equals(toastsMac(key, 'n'))).toBe(true);
    expect(
      toastsMac(key, 'n').equals(toastsMac(Buffer.from('other-pairing-value-1234'), 'n')),
    ).toBe(false);
  });
});

describe('toast sender checks', () => {
  it('recognises loopback addresses only', () => {
    for (const address of ['127.0.0.1', '127.8.0.1', '::1', '::ffff:127.0.0.1'])
      expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ['192.168.1.20', '::ffff:192.168.1.20', 'fe80::1', undefined])
      expect(isLoopbackAddress(address)).toBe(false);
  });

  it('matches only the exact bearer secret', () => {
    const key = Buffer.from(PAIRING);
    expect(bearerMatches(`Bearer ${PAIRING}`, key)).toBe(true);
    expect(bearerMatches(`bearer  ${PAIRING} `, key)).toBe(true);
    expect(bearerMatches(PAIRING, key)).toBe(false);
    expect(bearerMatches(`Bearer ${PAIRING}x`, key)).toBe(false);
    expect(bearerMatches(undefined, key)).toBe(false);
  });

  const fakeRequest = (remoteAddress: string): IncomingMessage =>
    Object.assign(new EventEmitter(), {
      url: '/toast',
      method: 'POST',
      headers: { authorization: `Bearer ${PAIRING}`, 'content-type': 'application/json' },
      socket: { remoteAddress },
      resume: () => undefined,
      destroy: () => undefined,
    }) as unknown as IncomingMessage;
  const fakeResponse = () => {
    const result = { status: 0, body: '' };
    const response = {
      writeHead: (status: number) => {
        result.status = status;
        return response;
      },
      end: (body: string) => {
        result.body = body;
      },
    } as unknown as ServerResponse;
    return { response, result };
  };

  it('refuses LAN senders unless they are allowed, and still checks their secret', () => {
    const closed = createToastHub({ allowedOrigins: [ORIGIN], loadSecret: enabled });
    const refused = fakeResponse();
    expect(closed.handleRequest(fakeRequest('192.168.1.20'), refused.response)).toBe(true);
    expect(refused.result.status).toBe(403);

    const open = createToastHub({
      allowedOrigins: [ORIGIN],
      loadSecret: enabled,
      allowRemoteSenders: true,
    });
    const request = fakeRequest('192.168.1.20');
    const accepted = fakeResponse();
    expect(open.handleRequest(request, accepted.response)).toBe(true);
    request.emit('data', Buffer.from(JSON.stringify({ message: 'from the LAN' })));
    request.emit('end');
    expect(accepted.result.status).toBe(202);
  });

  it('leaves other paths to the caller', () => {
    const hub = createToastHub({ allowedOrigins: [ORIGIN], loadSecret: enabled });
    const other = Object.assign(fakeRequest('127.0.0.1'), { url: '/health' });
    expect(hub.handleRequest(other, fakeResponse().response)).toBe(false);
  });
});
