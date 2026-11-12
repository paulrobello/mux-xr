// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { HostClipboardSocket } from '../src/host-clipboard';
import { createPictureDepthClient } from '../src/host-picture-depth';
import {
  createOnnxDepthEstimator,
  type DepthEstimator,
  depthInputSize,
  normalizeDepth,
} from '../src/server/depth-estimator';
import { attachDictationServer } from '../src/server/dictation-server';
import { pictureDepthMac } from '../src/server/picture-depth-server';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';
const MODEL = '.local/models/depth-anything-v2-small.onnx';

const webp = (width = 48, height = 32): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: '#c08040' } })
    .webp()
    .toBuffer();
const blob = (bytes: Buffer, type?: string): Blob => new Blob([new Uint8Array(bytes)], { type });

const servers: { server: Server; close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const { server, close } of servers.splice(0)) {
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const start = async (
  options: { enabled?: boolean; estimator?: DepthEstimator; maxBytes?: number } = {},
) => {
  const server = createServer();
  const attached = attachDictationServer(server, {
    allowedOrigins: [ORIGIN],
    transcribe: async () => 'unused',
    clipboard: {
      loadSecret: () => ({ enabled: true, key: Buffer.from(PAIRING) }),
      host: { read: async () => '', write: async () => undefined },
    },
    pictureDepth: {
      enabled: options.enabled ?? true,
      estimator: options.estimator,
      maxBytes: options.maxBytes,
    },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `ws://127.0.0.1:${address.port}/picture-depth`;
};

const factory = (target: string) =>
  new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket;
const clientFor = (url: string, secret: string | null = PAIRING) =>
  createPictureDepthClient({ url: () => url, secret: () => secret, socketFactory: factory });

const fakeEstimator = () => {
  const seen: Buffer[] = [];
  const estimator: DepthEstimator = {
    estimate: vi.fn(async (image: Buffer) => {
      seen.push(image);
      return { width: 3, height: 2, png: Buffer.from('fake-png') };
    }),
  };
  return { estimator, seen };
};

/** Speaks the protocol by hand, to send what a well-behaved client never would. */
const raw = (
  url: string,
  steps: { size: number; sha256: string; upload?: Buffer; binaryFirst?: boolean },
) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = new WebSocket(url, { origin: ORIGIN });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(String(data));
      if (message.type === 'challenge') {
        if (steps.binaryFirst) {
          socket.send(Buffer.from('early'), { binary: true });
          return;
        }
        const mac = pictureDepthMac(Buffer.from(PAIRING), message.nonce, steps.size, steps.sha256);
        socket.send(
          JSON.stringify({
            type: 'auth',
            size: steps.size,
            sha256: steps.sha256,
            mac: mac.toString('base64'),
          }),
        );
      } else if (message.type === 'ready') {
        socket.send(steps.upload ?? Buffer.alloc(0), { binary: true });
      } else {
        resolve(message);
        socket.close();
      }
    });
    socket.once('error', reject);
  });

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('base64');

describe('depth input sizing', () => {
  it('scales the short side to 518 in multiples of 14, capping a panorama by its long side', () => {
    expect(depthInputSize(1536, 2048)).toEqual({ width: 518, height: 686 });
    expect(depthInputSize(2048, 1536)).toEqual({ width: 686, height: 518 });
    const wide = depthInputSize(2048, 200);
    expect(wide.width).toBe(1036);
    expect(wide.height % 14).toBe(0);
  });

  it('normalizes inverse depth to 0..255 with near bright, and a flat map to zero', () => {
    expect([...normalizeDepth([1, 3, 5])]).toEqual([0, 128, 255]);
    expect([...normalizeDepth([2, 2])]).toEqual([0, 0]);
    expect([...normalizeDepth([0, Number.NaN, 4])]).toEqual([0, 0, 255]);
  });
});

describe('/picture-depth', () => {
  it('returns the depth map for the exact uploaded WebP', async () => {
    const { estimator, seen } = fakeEstimator();
    const url = await start({ estimator });
    const image = await webp();
    const result = await clientFor(url)(blob(image, 'image/webp'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(Buffer.from(await result.depth.arrayBuffer()).toString()).toBe('fake-png');
    expect(seen).toHaveLength(1);
    expect(seen[0].equals(image)).toBe(true);
  });

  it('is off unless enabled, and without an estimator', async () => {
    const image = blob(await webp());
    expect(await clientFor(await start({ enabled: false, ...fakeEstimator() }))(image)).toEqual({
      ok: false,
      code: 'disabled',
    });
    expect(await clientFor(await start({ enabled: true }))(image)).toEqual({
      ok: false,
      code: 'disabled',
    });
  });

  it('refuses a wrong pairing secret and never reaches the estimator', async () => {
    const { estimator } = fakeEstimator();
    const url = await start({ estimator });
    expect(await clientFor(url, 'wrong-secret')(blob(await webp()))).toEqual({
      ok: false,
      code: 'auth',
    });
    expect(estimator.estimate).not.toHaveBeenCalled();
    expect(await clientFor(url, null)(blob(await webp()))).toEqual({
      ok: false,
      code: 'no-secret',
    });
  });

  it('refuses anything that is not WebP, and an upload over the byte cap', async () => {
    const { estimator } = fakeEstimator();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect(await clientFor(await start({ estimator }))(blob(png))).toEqual({
      ok: false,
      code: 'not-image',
    });
    expect(await clientFor(await start({ estimator, maxBytes: 64 }))(blob(await webp()))).toEqual({
      ok: false,
      code: 'too-large',
    });
    expect(estimator.estimate).not.toHaveBeenCalled();
  });

  it('refuses bytes that do not match the signed size and hash, and binary before auth', async () => {
    const { estimator } = fakeEstimator();
    const url = await start({ estimator });
    const image = await webp();
    const other = await webp(40, 30);
    expect(await raw(url, { size: image.length, sha256: sha(image), upload: other })).toEqual({
      type: 'error',
      code: 'protocol',
    });
    expect(await raw(url, { size: image.length, sha256: sha(other), upload: image })).toMatchObject(
      { type: 'error' },
    );
    expect(await raw(url, { size: 1, sha256: sha(image), binaryFirst: true })).toEqual({
      type: 'error',
      code: 'auth',
    });
    expect(estimator.estimate).not.toHaveBeenCalled();
  });

  it('reports an estimator failure as failed', async () => {
    const url = await start({
      estimator: {
        estimate: async () => {
          throw new Error('corrupt');
        },
      },
    });
    expect(await clientFor(url)(blob(await webp()))).toEqual({ ok: false, code: 'failed' });
  });

  it('aborts a queued inference when its client goes away', async () => {
    let signal: AbortSignal | undefined;
    const url = await start({
      estimator: {
        estimate: (_image, abort) => {
          signal = abort;
          return new Promise((_resolve, reject) =>
            abort?.addEventListener('abort', () => reject(new Error('aborted'))),
          );
        },
      },
    });
    const client = createPictureDepthClient({
      url: () => url,
      secret: () => PAIRING,
      socketFactory: factory,
      timeoutMs: 300,
    });
    expect(await client(blob(await webp()))).toEqual({ ok: false, code: 'timeout' });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it('refuses a depth reply over the client cap', async () => {
    const url = await start({
      estimator: {
        estimate: async () => ({ width: 4, height: 4, png: Buffer.alloc(4 * 1024 * 1024 + 1) }),
      },
    });
    expect(await clientFor(url)(blob(await webp()))).toEqual({ ok: false, code: 'unavailable' });
  });

  it('refuses an origin outside the allow-list at upgrade', async () => {
    const url = await start(fakeEstimator());
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(url, { origin: 'https://elsewhere.test' });
      socket.once('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0);
        socket.terminate();
      });
      socket.once('open', () => reject(new Error('accepted')));
      socket.on('error', () => undefined);
    });
    expect(status).toBe(403);
  });
});

describe.skipIf(!existsSync(MODEL))('Depth Anything V2 Small', () => {
  it('returns a model-sized depth map normalized to the full 0..255 range', async () => {
    const image = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#303030' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 120, height: 120, channels: 3, background: '#e0e0e0' },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 60,
        },
      ])
      .webp()
      .toBuffer();
    const depth = await createOnnxDepthEstimator({ modelPath: MODEL, threads: 2 }).estimate(image);
    expect(depth).toMatchObject({ width: 686, height: 518 });
    const pixels = await sharp(depth.png).extractChannel(0).raw().toBuffer();
    expect(pixels.length).toBe(686 * 518);
    expect(pixels.reduce((high, value) => Math.max(high, value), 0)).toBe(255);
    expect(pixels.reduce((low, value) => Math.min(low, value), 255)).toBe(0);
  }, 30_000);
});
