import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { HostClipboardSocket } from '../src/host-clipboard';
import { createPictureProxyClient, type PictureProxyFailure } from '../src/host-picture-fetch';
import type { ClipboardSecret } from '../src/server/clipboard-server';
import { attachDictationServer } from '../src/server/dictation-server';
import {
  defaultResolver,
  defaultTransport,
  fetchPicture,
  type InterfaceMap,
  isBlockedAddress,
  isOnOwnNetwork,
  PICTURE_MAX_REDIRECTS,
  type PictureFetchEvent,
  type PictureFetchRouteOptions,
  type PictureHop,
  type PictureResolver,
  type PictureTransport,
  pictureFetchMac,
  sniffImageType,
} from '../src/server/picture-fetch-server';
import { loadPictureUrl, type PictureLoaderDeps } from '../src/xr/picture-image';
import { PictureLoadError, pictureErrorNotice } from '../src/xr/picture-sizing';

const PAIRING = 'not-a-real-pairing-value-for-tests-only';
const ORIGIN = 'https://allowed.test';
const PUBLIC_IP = '93.184.216.34';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pixels'),
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = Buffer.from('GIF89a-data');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const HTML = Buffer.from('<html>not an image</html>');

const publicResolver: PictureResolver = async () => [{ address: PUBLIC_IP, family: 4 }];

type Reply = {
  status?: number;
  location?: string;
  contentType?: string;
  contentLength?: number;
  body?: Buffer | AsyncIterable<Uint8Array>;
};

const hop = (reply: Reply): PictureHop => {
  const body = reply.body ?? PNG;
  return {
    status: reply.status ?? 200,
    location: reply.location,
    contentType: 'contentType' in reply ? reply.contentType : 'image/png',
    contentLength: reply.contentLength,
    body: Buffer.isBuffer(body)
      ? (async function* () {
          yield body;
        })()
      : body,
    destroy: vi.fn(),
  };
};

const scripted = (...replies: Reply[]) => {
  const calls: { url: string; address: string }[] = [];
  const transport: PictureTransport = async ({ url, address }) => {
    calls.push({ url: url.href, address: address.address });
    return hop(replies[Math.min(calls.length - 1, replies.length - 1)]);
  };
  return { transport, calls };
};

describe('isBlockedAddress', () => {
  const blocked = [
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '0.1.2.3',
    '224.0.0.1',
    '239.255.255.255',
    '255.255.255.255',
    '240.0.0.1',
    '::',
    '::1',
    '0:0:0:0:0:0:0:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%en0',
    'febf::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:192.168.0.1',
    '::ffff:c0a8:1',
    '::ffff:172.16.0.1',
    '::ffff:169.254.169.254',
    '::ffff:100.64.0.1',
    '::ffff:0.0.0.0',
    '192.88.99.1',
    '192.88.99.254',
    '::ffff:0:8.8.8.8',
    '::ffff:0:808:808',
    '2001:20::1',
    '2001:2f:ffff::1',
    '3fff::1',
    '3fff:fff:ffff::1',
    '::ffff:255.255.255.255',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2002:a00:1::1',
    'not an address',
    '',
  ];
  const allowed = [
    PUBLIC_IP,
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '192.169.0.1',
    '192.88.98.1',
    '192.88.100.1',
    '2001:1f::1',
    '2001:30::1',
    '3fff:1000::1',
    '3ffe::1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '::ffff:5db8:d822',
    '64:ff9b::808:808',
  ];
  it.each(blocked)('refuses %j', (address) => expect(isBlockedAddress(address)).toBe(true));
  it.each(allowed)('allows %s', (address) => expect(isBlockedAddress(address)).toBe(false));
});

describe('sniffImageType', () => {
  it('recognises the four allowed formats from their first bytes only', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF)).toBe('image/gif');
    expect(sniffImageType(Buffer.from('GIF87a'))).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(HTML)).toBeNull();
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('fetchPicture', () => {
  it('returns the bytes and the sniffed type for each allowed format', async () => {
    for (const [body, contentType] of [
      [PNG, 'image/png'],
      [JPEG, 'image/jpeg'],
      [GIF, 'image/gif'],
      [WEBP, 'image/webp'],
    ] as const) {
      const { transport } = scripted({ body, contentType: `${contentType}; charset=binary` });
      const result = await fetchPicture('https://img.example.com/a', {
        resolve: publicResolver,
        transport,
      });
      expect(result).toEqual({ ok: true, bytes: body, contentType });
    }
  });

  it('refuses private, loopback, link-local, CGNAT and mapped addresses without connecting', async () => {
    const targets = [
      'http://127.0.0.1/a.png',
      'http://2130706433/a.png',
      'http://0x7f.1/a.png',
      'http://10.1.2.3/a.png',
      'http://172.16.0.9/a.png',
      'http://192.168.0.9/a.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.1.1/a.png',
      'http://0.0.0.0/a.png',
      'http://224.0.0.1/a.png',
      'http://255.255.255.255/a.png',
      'http://[::1]/a.png',
      'http://[::]/a.png',
      'http://[fc00::1]/a.png',
      'http://[fd00::1]/a.png',
      'http://[fe80::1]/a.png',
      'http://[::ffff:127.0.0.1]/a.png',
      'http://[::ffff:10.0.0.1]/a.png',
      'http://[::ffff:192.168.1.1]/a.png',
      'http://[::ffff:169.254.169.254]/a.png',
      'http://[::ffff:100.64.0.1]/a.png',
    ];
    for (const target of targets) {
      const { transport, calls } = scripted({});
      const result = await fetchPicture(target, { resolve: defaultResolver, transport });
      expect(result, target).toEqual({ ok: false, code: 'blocked' });
      expect(calls, target).toEqual([]);
    }
  });

  it('refuses a hostname that resolves to any private address, even beside a public one', async () => {
    for (const answers of [
      [{ address: '127.0.0.1', family: 4 as const }],
      [{ address: '::ffff:10.0.0.5', family: 6 as const }],
      [
        { address: PUBLIC_IP, family: 4 as const },
        { address: '192.168.1.1', family: 4 as const },
      ],
      [
        { address: '2606:4700::1111', family: 6 as const },
        { address: 'fd00::1', family: 6 as const },
      ],
    ]) {
      const { transport, calls } = scripted({});
      const result = await fetchPicture('https://evil.example.com/a.png', {
        resolve: async () => answers,
        transport,
      });
      expect(result).toEqual({ ok: false, code: 'blocked' });
      expect(calls).toEqual([]);
    }
  });

  it('pins the validated address so a DNS rebinding answer is never connected to', async () => {
    const lookups: string[] = [];
    // First lookup is public, every later lookup points at the loopback.
    const rebinding: PictureResolver = async (hostname) => {
      lookups.push(hostname);
      return lookups.length === 1
        ? [{ address: PUBLIC_IP, family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    };
    const { transport, calls } = scripted({});
    const result = await fetchPicture('https://rebind.example.com/a.png', {
      resolve: rebinding,
      transport,
    });
    expect(result.ok).toBe(true);
    expect(lookups).toEqual(['rebind.example.com']);
    expect(calls).toEqual([{ url: 'https://rebind.example.com/a.png', address: PUBLIC_IP }]);
  });

  it('keeps the original hostname in the request while connecting to the pinned address', async () => {
    const seen: { host?: string; cookie?: string; auth?: string; path?: string }[] = [];
    const server: Server = createServer((request, response) => {
      seen.push({
        host: request.headers.host,
        cookie: request.headers.cookie,
        auth: request.headers.authorization,
        path: request.url,
      });
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test address');
      const hopResult = await defaultTransport({
        url: new URL(`http://pinned.example.test:${address.port}/p.png?x=1`),
        address: { address: '127.0.0.1', family: 4 },
        signal: new AbortController().signal,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of hopResult.body) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(PNG);
      expect(seen).toEqual([
        {
          host: `pinned.example.test:${address.port}`,
          cookie: undefined,
          auth: undefined,
          path: '/p.png?x=1',
        },
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuses a redirect whose hostname resolves to a private address', async () => {
    const resolve: PictureResolver = async (hostname) =>
      hostname === 'internal.example.com'
        ? [{ address: '10.0.0.7', family: 4 }]
        : [{ address: PUBLIC_IP, family: 4 }];
    const { transport, calls } = scripted(
      { status: 301, location: 'https://internal.example.com/a.png' },
      {},
    );
    const result = await fetchPicture('https://img.example.com/a.png', { resolve, transport });
    expect(result).toEqual({ ok: false, code: 'blocked' });
    expect(calls.map((call) => call.url)).toEqual(['https://img.example.com/a.png']);
  });

  it('re-validates every redirect hop, refusing one that lands on a private literal', async () => {
    const resolve: PictureResolver = async (hostname) =>
      defaultResolver(hostname).then((answers) =>
        answers.length === 1 && answers[0].address === hostname
          ? answers
          : [{ address: PUBLIC_IP, family: 4 }],
      );
    // 'img.example.com' is not an IP literal: defaultResolver would do real DNS, so short-circuit.
    const named: PictureResolver = async (hostname) =>
      hostname === 'img.example.com' ? [{ address: PUBLIC_IP, family: 4 }] : resolve(hostname);
    for (const location of [
      'http://127.0.0.1/secret.png',
      'http://169.254.169.254/latest',
      'http://[::ffff:10.0.0.1]/a.png',
      '//192.168.1.1/a.png',
    ]) {
      const { transport, calls } = scripted({ status: 302, location }, {});
      const result = await fetchPicture('https://img.example.com/a.png', {
        resolve: named,
        transport,
      });
      expect(result, location).toEqual({ ok: false, code: 'blocked' });
      expect(calls, location).toHaveLength(1);
    }
  });

  it('follows at most three redirects, resolving relative locations', async () => {
    const hops = (count: number): Reply[] => [
      ...Array.from({ length: count }, (_, index) => ({
        status: 302,
        location: `/hop${index + 1}.png`,
      })),
      {},
    ];
    const ok = scripted(...hops(PICTURE_MAX_REDIRECTS));
    expect(
      (
        await fetchPicture('https://img.example.com/a.png', {
          resolve: publicResolver,
          transport: ok.transport,
        })
      ).ok,
    ).toBe(true);
    expect(ok.calls.map((call) => call.url)).toEqual([
      'https://img.example.com/a.png',
      'https://img.example.com/hop1.png',
      'https://img.example.com/hop2.png',
      'https://img.example.com/hop3.png',
    ]);
    const tooMany = scripted(...hops(PICTURE_MAX_REDIRECTS + 1));
    expect(
      await fetchPicture('https://img.example.com/a.png', {
        resolve: publicResolver,
        transport: tooMany.transport,
      }),
    ).toEqual({ ok: false, code: 'failed' });
    expect(tooMany.calls).toHaveLength(PICTURE_MAX_REDIRECTS + 1);
  });

  it('refuses a redirect to a non-http scheme or with credentials', async () => {
    for (const location of [
      'file:///etc/passwd',
      'ftp://img.example.com/a',
      'https://u:p@img.example.com/a.png',
    ]) {
      const { transport } = scripted({ status: 302, location }, {});
      expect(
        await fetchPicture('https://img.example.com/a.png', { resolve: publicResolver, transport }),
        location,
      ).toEqual({ ok: false, code: 'bad_url' });
    }
  });

  it('refuses userinfo, other schemes, control characters and overlong URLs before resolving', async () => {
    const resolve = vi.fn(publicResolver);
    const { transport, calls } = scripted({});
    for (const target of [
      'https://user:pass@img.example.com/a.png',
      'https://user@img.example.com/a.png',
      'https://:pass@img.example.com/a.png',
      'file:///etc/passwd',
      'ftp://img.example.com/a.png',
      'javascript:alert(1)',
      'not a url',
      'https://img.example.com/a\nb.png',
      `https://img.example.com/${'a'.repeat(3000)}`,
    ])
      expect(await fetchPicture(target, { resolve, transport }), target).toEqual({
        ok: false,
        code: 'bad_url',
      });
    expect(resolve).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('refuses anything that is not a PNG, JPEG, GIF or WebP by header', async () => {
    for (const contentType of [
      'text/html',
      'image/svg+xml',
      'application/octet-stream',
      'image/bmp',
      undefined,
    ]) {
      const { transport } = scripted({ contentType });
      expect(
        await fetchPicture('https://img.example.com/a', { resolve: publicResolver, transport }),
        String(contentType),
      ).toEqual({ ok: false, code: 'not_image' });
    }
  });

  it('refuses wrong magic bytes, including a declared type that disagrees with the bytes', async () => {
    for (const [body, contentType] of [
      [HTML, 'image/png'],
      [PNG, 'image/jpeg'],
      [JPEG, 'image/gif'],
      [Buffer.alloc(0), 'image/png'],
    ] as const) {
      const { transport } = scripted({ body, contentType });
      expect(
        await fetchPicture('https://img.example.com/a', { resolve: publicResolver, transport }),
      ).toEqual({ ok: false, code: 'not_image' });
    }
  });

  it('accepts HEVC HEIF declared as image/heic or image/heif, and reports it as image/heif', async () => {
    const heif = readFileSync('tests/fixtures/gradient.heic');
    expect(sniffImageType(heif)).toBe('image/heif');
    for (const contentType of ['image/heic', 'image/heif', 'image/HEIC; charset=binary']) {
      const { transport } = scripted({ body: heif, contentType });
      const result = await fetchPicture('https://img.example.com/a.heic', {
        resolve: publicResolver,
        transport,
      });
      expect(result.ok && result.contentType, contentType).toBe('image/heif');
    }
    const mislabelled = scripted({ body: PNG, contentType: 'image/heic' });
    expect(
      await fetchPicture('https://img.example.com/a', {
        resolve: publicResolver,
        transport: mislabelled.transport,
      }),
    ).toEqual({ ok: false, code: 'not_image' });
  });

  it('refuses an oversized body by Content-Length and by streaming', async () => {
    const declared = scripted({ contentLength: 11, body: PNG });
    expect(
      await fetchPicture('https://img.example.com/a', {
        resolve: publicResolver,
        transport: declared.transport,
        maxBytes: 10,
      }),
    ).toEqual({ ok: false, code: 'too_large' });

    let pulled = 0;
    const endless = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          pulled += 1;
          return { done: false, value: new Uint8Array(1024) };
        },
      }),
    } as AsyncIterable<Uint8Array>;
    const streamed = scripted({ body: endless });
    expect(
      await fetchPicture('https://img.example.com/a', {
        resolve: publicResolver,
        transport: streamed.transport,
        maxBytes: 10 * 1024,
      }),
    ).toEqual({ ok: false, code: 'too_large' });
    expect(pulled).toBeLessThanOrEqual(11);
  });

  it('enforces the 10 MiB default cap while streaming', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const endless = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          pulled += 1;
          return { done: false, value: chunk };
        },
      }),
    } as AsyncIterable<Uint8Array>;
    const { transport } = scripted({ body: endless });
    expect(
      await fetchPicture('https://img.example.com/a', { resolve: publicResolver, transport }),
    ).toEqual({ ok: false, code: 'too_large' });
    expect(pulled).toBe(11);
  });

  it('times out a stalled body, a stalled connection and a stalled lookup', async () => {
    const stalled = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }),
    } as AsyncIterable<Uint8Array>;
    const body = scripted({ body: stalled });
    expect(
      await fetchPicture('https://img.example.com/a', {
        resolve: publicResolver,
        transport: body.transport,
        timeoutMs: 30,
      }),
    ).toEqual({ ok: false, code: 'timeout' });
    expect(
      await fetchPicture('https://img.example.com/a', {
        resolve: publicResolver,
        transport: () => new Promise<PictureHop>(() => undefined),
        timeoutMs: 30,
      }),
    ).toEqual({ ok: false, code: 'timeout' });
    expect(
      await fetchPicture('https://img.example.com/a', {
        resolve: () => new Promise(() => undefined),
        transport: body.transport,
        timeoutMs: 30,
      }),
    ).toEqual({ ok: false, code: 'timeout' });
  });

  it('reports upstream errors and unresolvable names as failed', async () => {
    const { transport } = scripted({ status: 404 });
    expect(
      await fetchPicture('https://img.example.com/a', { resolve: publicResolver, transport }),
    ).toEqual({ ok: false, code: 'failed' });
    expect(
      await fetchPicture('https://nope.example.com/a', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
        transport,
      }),
    ).toEqual({ ok: false, code: 'failed' });
    expect(
      await fetchPicture('https://nope.example.com/a', { resolve: async () => [], transport }),
    ).toEqual({ ok: false, code: 'failed' });
    expect(
      await fetchPicture('https://img.example.com/a', {
        resolve: publicResolver,
        transport: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    ).toEqual({ ok: false, code: 'failed' });
  });
});

const servers: { server: Server; close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const { server, close } of servers.splice(0)) {
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const start = async (
  options: {
    loadSecret?: () => ClipboardSecret;
    configured?: boolean;
    enabled?: boolean;
    pictureProxy?: Omit<PictureFetchRouteOptions, 'allowedOrigins' | 'loadSecret'>;
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
            loadSecret:
              options.loadSecret ?? (() => ({ enabled: true, key: Buffer.from(PAIRING) })),
            host: { read: async () => '', write: async () => undefined },
          },
    pictureProxy: {
      enabled: options.enabled ?? true,
      resolve: publicResolver,
      ...options.pictureProxy,
    },
  });
  servers.push({ server, close: attached.close });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `ws://127.0.0.1:${address.port}/picture-fetch`;
};

const factory = (target: string) =>
  new WebSocket(target, { origin: ORIGIN }) as unknown as HostClipboardSocket;
const clientFor = (url: string, secret: string | null = PAIRING) =>
  createPictureProxyClient({ url: () => url, secret: () => secret, socketFactory: factory });

const rawQuery = (
  url: string,
  target: string,
  options: { key?: string; signedUrl?: string } = {},
) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = new WebSocket(url, { origin: ORIGIN });
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(String(data));
      if (message.type === 'challenge') {
        const mac = pictureFetchMac(
          Buffer.from(options.key ?? PAIRING),
          message.nonce,
          options.signedUrl ?? target,
        );
        socket.send(JSON.stringify({ type: 'auth', url: target, mac: mac.toString('base64') }));
      } else if (message.type === 'error') {
        resolve(message);
        socket.close();
      }
    });
    socket.once('error', reject);
  });

const upgradeStatus = (url: string, origin?: string) =>
  new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, origin ? { origin } : undefined);
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once('open', () => {
      socket.terminate();
      reject(new Error('upgrade unexpectedly accepted'));
    });
    socket.once('error', () => undefined);
  });

const TARGET = 'https://img.example.com/photos/a.png?token=secret-query';

describe('/picture-fetch route', () => {
  it('returns the image bytes and type to an authenticated client', async () => {
    const { transport, calls } = scripted({ body: JPEG, contentType: 'image/jpeg' });
    const url = await start({ pictureProxy: { transport } });
    const result = await clientFor(url)(TARGET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.type).toBe('image/jpeg');
    expect(Buffer.from(await result.blob.arrayBuffer())).toEqual(JPEG);
    expect(calls).toEqual([{ url: TARGET, address: PUBLIC_IP }]);
  });

  it('refuses a wrong secret, a missing secret and a proof signed for another URL', async () => {
    const { transport, calls } = scripted({});
    const url = await start({ pictureProxy: { transport } });
    expect(await rawQuery(url, TARGET, { key: 'wrong-secret-value-of-enough-length' })).toEqual({
      type: 'error',
      code: 'auth',
    });
    expect(await rawQuery(url, TARGET, { signedUrl: 'https://img.example.com/other.png' })).toEqual(
      {
        type: 'error',
        code: 'auth',
      },
    );
    expect(await clientFor(url, 'wrong-secret-value-of-enough-length')(TARGET)).toEqual({
      ok: false,
      code: 'auth',
    });
    expect(await clientFor(url, null)(TARGET)).toEqual({ ok: false, code: 'no-secret' });
    expect(calls).toEqual([]);
  });

  it('answers disabled when the option is off, even with clipboard pairing configured', async () => {
    const { transport, calls } = scripted({});
    const url = await start({ enabled: false, pictureProxy: { transport } });
    expect(await clientFor(url)(TARGET)).toEqual({ ok: false, code: 'disabled' });
    expect(calls).toEqual([]);
  });

  it('answers disabled when clipboard pairing is not configured', async () => {
    const { transport, calls } = scripted({});
    const url = await start({ configured: false, pictureProxy: { transport } });
    expect(await clientFor(url)(TARGET)).toEqual({ ok: false, code: 'disabled' });
    expect(calls).toEqual([]);
  });

  it('maps each fetch refusal to its own code', async () => {
    const cases: [Reply | PictureResolver, string, PictureProxyFailure][] = [
      [{ contentType: 'text/html' }, TARGET, 'not-image'],
      [{ body: HTML }, TARGET, 'not-image'],
      [{ contentLength: 11 * 1024 * 1024 }, TARGET, 'too-large'],
      [{ status: 500 }, TARGET, 'failed'],
      [async () => [{ address: '10.0.0.1', family: 4 }], TARGET, 'blocked'],
      [{}, 'https://user:pw@img.example.com/a.png', 'bad-url'],
    ];
    for (const [reply, target, code] of cases) {
      const options =
        typeof reply === 'function'
          ? { resolve: reply, transport: scripted({}).transport }
          : { transport: scripted(reply).transport };
      const url = await start({ pictureProxy: options });
      expect(await clientFor(url)(target), `${code} ${typeof reply}`).toEqual({ ok: false, code });
    }
  });

  it('times out slow upstreams with its own code', async () => {
    const url = await start({
      pictureProxy: { transport: () => new Promise<PictureHop>(() => undefined), timeoutMs: 30 },
    });
    expect(await clientFor(url)(TARGET)).toEqual({ ok: false, code: 'timeout' });
  });

  it('rejects other origins with 403 and enforces the per-client connection cap with 429', async () => {
    const url = await start({
      pictureProxy: {
        transport: () => new Promise<PictureHop>(() => undefined),
        maxConnectionsPerClient: 1,
        timeoutMs: 5_000,
      },
    });
    expect(await upgradeStatus(url, 'https://evil.test')).toBe(403);
    expect(await upgradeStatus(url)).toBe(403);
    const first = new WebSocket(url, { origin: ORIGIN });
    await new Promise<void>((resolve) => first.once('open', () => resolve()));
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    first.terminate();
  });

  it('reports only codes and byte counts to the event callback, never a URL', async () => {
    const events: PictureFetchEvent[] = [];
    const { transport } = scripted({});
    const url = await start({
      pictureProxy: { transport, onEvent: (event) => events.push(event) },
    });
    await clientFor(url)(TARGET);
    await rawQuery(url, TARGET, { key: 'wrong-secret-value-of-enough-length' });
    expect(events).toEqual([
      { kind: 'transfer', bytes: PNG.length },
      { kind: 'refused', code: 'auth' },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret-query');
    expect(JSON.stringify(events)).not.toContain('example.com');
  });
});

describe('picture loading with the proxy fallback', () => {
  const makeDeps = (
    direct: Response | Error,
    proxy?: PictureLoaderDeps['proxy'],
  ): PictureLoaderDeps & { fetch: ReturnType<typeof vi.fn> } => ({
    fetch: vi.fn(async () => {
      if (direct instanceof Error) throw direct;
      return direct;
    }),
    decode: vi.fn(async () => ({ width: 1, height: 1 })),
    createCanvas: (width, height) =>
      ({
        width,
        height,
        getContext: () => ({ drawImage: () => undefined }),
        toBlob: (done: (blob: Blob | null) => void) =>
          done(new Blob(['x'], { type: 'image/webp' })),
      }) as unknown as HTMLCanvasElement,
    pageProtocol: 'https:',
    proxy,
  });
  const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });
  const proxied = new Blob([PNG], { type: 'image/png' });

  it('tries the direct CORS fetch first and never calls the proxy when it works', async () => {
    const proxy = vi.fn(async () => ({ ok: true as const, blob: proxied }));
    const deps = makeDeps(png(), proxy);
    await loadPictureUrl('https://img.example.com/a.png', deps);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(proxy).not.toHaveBeenCalled();
  });

  it('falls back to the proxy only after the direct fetch fails as CORS', async () => {
    const order: string[] = [];
    const proxy = vi.fn(async (url: string) => {
      order.push(`proxy ${url}`);
      return { ok: true as const, blob: proxied };
    });
    const deps = makeDeps(new TypeError('Failed to fetch'), proxy);
    deps.fetch.mockImplementation(async () => {
      order.push('direct');
      throw new TypeError('Failed to fetch');
    });
    const picture = await loadPictureUrl('https://img.example.com/a.png', deps);
    expect(order).toEqual(['direct', 'proxy https://img.example.com/a.png']);
    expect(picture.name).toBe('a.png');
    expect(deps.decode).toHaveBeenCalledWith(proxied);
  });

  it('keeps the plain CORS error without a pairing secret or an unreachable server', async () => {
    for (const code of ['no-secret', 'unavailable'] as const) {
      const deps = makeDeps(new TypeError('x'), async () => ({ ok: false, code }));
      await expect(loadPictureUrl('https://img.example.com/a.png', deps)).rejects.toMatchObject({
        code: 'cors',
      });
    }
    await expect(
      loadPictureUrl('https://img.example.com/a.png', makeDeps(new TypeError('x'))),
    ).rejects.toMatchObject({ code: 'cors' });
  });

  it('does not use the proxy for HTTP errors, timeouts or oversized direct responses', async () => {
    const proxy = vi.fn(async () => ({ ok: true as const, blob: proxied }));
    await expect(
      loadPictureUrl(
        'https://img.example.com/a.png',
        makeDeps(new Response('', { status: 404 }), proxy),
      ),
    ).rejects.toMatchObject({ code: 'http' });
    await expect(
      loadPictureUrl(
        'https://img.example.com/a.png',
        makeDeps(
          new Response('x', { headers: { 'content-length': String(50 * 1024 * 1024) } }),
          proxy,
        ),
      ),
    ).rejects.toMatchObject({ code: 'too-large' });
    const aborted = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(aborted.signal);
    aborted.abort();
    await expect(
      loadPictureUrl('https://img.example.com/a.png', makeDeps(new TypeError('x'), proxy)),
    ).rejects.toMatchObject({ code: 'timeout' });
    timeout.mockRestore();
    expect(proxy).not.toHaveBeenCalled();
  });

  it('turns each proxy refusal into its own error and notice', async () => {
    const expected: [PictureProxyFailure, string, RegExp][] = [
      ['disabled', 'proxy-disabled', /--picture-proxy on/],
      ['auth', 'proxy-auth', /pairing secret/],
      ['rate-limited', 'proxy-rate-limited', /Too many/],
      ['blocked', 'proxy-blocked', /private or local address/],
      ['too-large', 'proxy-too-large', /10 MB/],
      ['not-image', 'proxy-not-image', /PNG, JPEG, GIF, WebP or HEIF/],
      ['timeout', 'proxy-timeout', /timed out/],
      ['failed', 'proxy-failed', /could not fetch/],
    ];
    const notices = new Set<string>();
    for (const [failure, code, notice] of expected) {
      const deps = makeDeps(new TypeError('x'), async () => ({ ok: false, code: failure }));
      const error = await loadPictureUrl('https://img.example.com/a.png', deps).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(PictureLoadError);
      expect((error as PictureLoadError).code).toBe(code);
      const text = pictureErrorNotice(
        (error as PictureLoadError).code,
        'https://img.example.com/a.png',
      );
      expect(text).toMatch(notice);
      notices.add(text);
    }
    expect(notices.size).toBe(expected.length);
  });

  it('refuses a proxy blob that is not an image before decoding', async () => {
    const deps = makeDeps(new TypeError('x'), async () => ({
      ok: true,
      blob: new Blob([HTML], { type: 'text/html' }),
    }));
    await expect(loadPictureUrl('https://img.example.com/a.png', deps)).rejects.toMatchObject({
      code: 'not-image',
    });
    expect(deps.decode).not.toHaveBeenCalled();
  });
});

const nic = (address: string, netmask: string, family: 'IPv4' | 'IPv6'): NetworkInterfaceInfo =>
  ({
    address,
    netmask,
    family,
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: null,
    scopeid: 0,
  }) as NetworkInterfaceInfo;
const OWN_V6 = '2600:1700:8400:5f90::44';
const OWN_V4 = '93.184.216.34';
const hostInterfaces = (): InterfaceMap => ({
  en0: [
    nic(OWN_V6, 'ffff:ffff:ffff:ffff::', 'IPv6'),
    nic('2600:1700:8400:5f90:1c2d:3e4f:5a6b:7c8d', 'ffff:ffff:ffff:ffff::', 'IPv6'),
    nic(OWN_V4, '255.255.255.0', 'IPv4'),
    nic('192.168.1.20', '255.255.255.0', 'IPv4'),
  ],
});

describe('own network refusal (SEC-001)', () => {
  const namedPublic =
    (extra: Record<string, string> = {}): PictureResolver =>
    async (hostname) =>
      hostname in extra
        ? [{ address: extra[hostname], family: extra[hostname].includes(':') ? 6 : 4 }]
        : hostname === 'img.example.com'
          ? [{ address: '8.8.8.8', family: 4 }]
          : defaultResolver(hostname);

  it('matches own addresses and on-link prefixes, IPv4 and IPv6, and nothing else', () => {
    const own = hostInterfaces();
    for (const address of [
      OWN_V6,
      '2600:1700:8400:5f90::1',
      '2600:1700:8400:5f90:aaaa:bbbb:cccc:dddd',
      OWN_V4,
      '93.184.216.200',
      '::ffff:93.184.216.34',
      '::ffff:5db8:d8c8',
    ])
      expect(isOnOwnNetwork(address, own), address).toBe(true);
    for (const address of [
      '2600:1700:8400:5f91::44',
      '2606:4700::1111',
      '93.184.217.1',
      '8.8.8.8',
      '::ffff:8.8.8.8',
    ])
      expect(isOnOwnNetwork(address, own), address).toBe(false);
    expect(isOnOwnNetwork(OWN_V6, {})).toBe(false);
  });

  it('refuses the host own global IPv6 and IPv4 addresses and same-prefix neighbours', async () => {
    for (const target of [
      `http://[${OWN_V6}]/a.png`,
      'http://[2600:1700:8400:5f90::1234]/a.png',
      `http://${OWN_V4}/a.png`,
      'http://93.184.216.77/a.png',
      'http://[::ffff:93.184.216.34]/a.png',
    ]) {
      const { transport, calls } = scripted({});
      const result = await fetchPicture(target, {
        resolve: defaultResolver,
        transport,
        networkInterfaces: hostInterfaces,
      });
      expect(result, target).toEqual({ ok: false, code: 'blocked' });
      expect(calls, target).toEqual([]);
    }
  });

  it('refuses a hostname that resolves to the host or an on-link neighbour', async () => {
    for (const address of [OWN_V6, '2600:1700:8400:5f90::9999', OWN_V4, '93.184.216.9']) {
      const { transport, calls } = scripted({});
      const result = await fetchPicture('https://lan.example.com/a.png', {
        resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
        transport,
        networkInterfaces: hostInterfaces,
      });
      expect(result, address).toEqual({ ok: false, code: 'blocked' });
      expect(calls).toEqual([]);
    }
  });

  it('refuses a redirect to each own or on-link address', async () => {
    for (const location of [
      `http://[${OWN_V6}]/x.png`,
      'http://[2600:1700:8400:5f90::1234]/x.png',
      `http://${OWN_V4}/x.png`,
      'http://93.184.216.77/x.png',
    ]) {
      const { transport, calls } = scripted({ status: 302, location }, {});
      const result = await fetchPicture('https://img.example.com/a.png', {
        resolve: namedPublic(),
        transport,
        networkInterfaces: hostInterfaces,
      });
      expect(result, location).toEqual({ ok: false, code: 'blocked' });
      expect(calls, location).toHaveLength(1);
    }
  });

  it('reads the interfaces fresh on every hop', async () => {
    let reads = 0;
    const rotating = (): InterfaceMap => {
      reads += 1;
      // The temporary address only appears from the second hop on.
      return reads >= 2 ? { en0: [nic('8.8.4.4', '255.255.255.255', 'IPv4')] } : {};
    };
    const { transport, calls } = scripted(
      { status: 302, location: 'https://cdn.example.com/b.png' },
      {},
    );
    const result = await fetchPicture('https://img.example.com/a.png', {
      resolve: namedPublic({ 'cdn.example.com': '8.8.4.4' }),
      transport,
      networkInterfaces: rotating,
    });
    expect(result).toEqual({ ok: false, code: 'blocked' });
    expect(reads).toBe(2);
    expect(calls).toHaveLength(1);
  });
});

describe('destination ports (SEC-002)', () => {
  it('refuses any port other than the scheme default, on the first URL', async () => {
    for (const target of [
      'https://img.example.com:8443/a.png',
      'http://img.example.com:8080/a.png',
      'http://img.example.com:443/a.png',
      'https://img.example.com:80/a.png',
      'http://img.example.com:22/a.png',
    ]) {
      const { transport, calls } = scripted({});
      const resolve = vi.fn(publicResolver);
      expect(await fetchPicture(target, { resolve, transport }), target).toEqual({
        ok: false,
        code: 'blocked',
      });
      expect(calls, target).toEqual([]);
      expect(resolve, target).not.toHaveBeenCalled();
    }
  });

  it('allows the explicit default port of each scheme', async () => {
    for (const target of ['https://img.example.com:443/a.png', 'http://img.example.com:80/a.png']) {
      const { transport } = scripted({});
      expect((await fetchPicture(target, { resolve: publicResolver, transport })).ok, target).toBe(
        true,
      );
    }
  });

  it('refuses a redirect to a non-default port and allows one to a default port', async () => {
    const bad = scripted({ status: 302, location: 'https://img.example.com:8443/x.png' }, {});
    expect(
      await fetchPicture('https://img.example.com/a.png', {
        resolve: publicResolver,
        transport: bad.transport,
      }),
    ).toEqual({ ok: false, code: 'blocked' });
    expect(bad.calls).toHaveLength(1);
    const good = scripted({ status: 302, location: 'http://img.example.com:80/x.png' }, {});
    expect(
      (
        await fetchPicture('https://img.example.com/a.png', {
          resolve: publicResolver,
          transport: good.transport,
        })
      ).ok,
    ).toBe(true);
    expect(good.calls).toHaveLength(2);
  });
});

describe('aborting an in-flight fetch (SEC-003)', () => {
  it('aborts the transport when the caller signal aborts', async () => {
    const seen: AbortSignal[] = [];
    const caller = new AbortController();
    const pending = fetchPicture('https://img.example.com/a.png', {
      resolve: publicResolver,
      transport: ({ signal }) => {
        seen.push(signal);
        return new Promise<PictureHop>(() => undefined);
      },
      signal: caller.signal,
      timeoutMs: 5_000,
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].aborted).toBe(false);
    caller.abort();
    expect((await pending).ok).toBe(false);
    expect(seen[0].aborted).toBe(true);
  });

  it('aborts the transport and frees the client slot when the client socket closes', async () => {
    const seen: AbortSignal[] = [];
    const url = await start({
      pictureProxy: {
        transport: ({ signal }) => {
          seen.push(signal);
          return new Promise<PictureHop>(() => undefined);
        },
        maxConnectionsPerClient: 1,
        timeoutMs: 20_000,
      },
    });
    const socket = new WebSocket(url, { origin: ORIGIN });
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      if (message.type !== 'challenge') return;
      const mac = pictureFetchMac(Buffer.from(PAIRING), message.nonce, TARGET);
      socket.send(JSON.stringify({ type: 'auth', url: TARGET, mac: mac.toString('base64') }));
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].aborted).toBe(false);
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    socket.terminate();
    await vi.waitFor(() => expect(seen[0].aborted).toBe(true));
  });
});

describe('route limits shared with the other routes (SEC-007)', () => {
  const clipboardBadAuth = (url: string) =>
    new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, { origin: ORIGIN });
      socket.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (message.type === 'challenge')
          socket.send(JSON.stringify({ type: 'auth', op: 'read', mac: 'AAAA' }));
        else if (message.type === 'error') {
          resolve();
          socket.close();
        }
      });
      socket.once('error', reject);
    });
  const FAILURES = 5;

  it('counts picture-fetch auth failures against /clipboard', async () => {
    const url = await start({ pictureProxy: { transport: scripted({}).transport } });
    const clipboard = url.replace('/picture-fetch', '/clipboard');
    expect(await upgradeStatus(clipboard, ORIGIN).catch(() => 0)).not.toBe(429);
    for (let index = 0; index < FAILURES; index += 1)
      await rawQuery(url, TARGET, { key: 'wrong-secret-value-of-enough-length' });
    expect(await upgradeStatus(clipboard, ORIGIN)).toBe(429);
  });

  it('counts /clipboard auth failures against /picture-fetch', async () => {
    const url = await start({ pictureProxy: { transport: scripted({}).transport } });
    const clipboard = url.replace('/picture-fetch', '/clipboard');
    for (let index = 0; index < FAILURES; index += 1) await clipboardBadAuth(clipboard);
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
  });

  it('answers 503 once the global connection cap is full', async () => {
    const url = await start({
      pictureProxy: {
        transport: () => new Promise<PictureHop>(() => undefined),
        maxConnections: 2,
        maxConnectionsPerClient: 10,
      },
    });
    const held = [0, 1].map(() => new WebSocket(url, { origin: ORIGIN }));
    await Promise.all(
      held.map((socket) => new Promise<void>((resolve) => socket.once('open', () => resolve()))),
    );
    expect(await upgradeStatus(url, ORIGIN)).toBe(503);
    held[0].terminate();
    await vi.waitFor(
      () =>
        new Promise<void>((resolve, reject) => {
          const probe = new WebSocket(url, { origin: ORIGIN });
          probe.once('open', () => {
            probe.terminate();
            resolve();
          });
          probe.once('unexpected-response', () => reject(new Error('still full')));
          probe.once('error', () => undefined);
        }),
    );
    held[1].terminate();
  });

  it('allows exactly 20 authenticated requests a minute per client, then answers 429', async () => {
    const url = await start({ pictureProxy: { transport: scripted({}).transport } });
    for (let index = 1; index <= 20; index += 1)
      expect((await clientFor(url)(TARGET)).ok, `request ${index}`).toBe(true);
    expect(await upgradeStatus(url, ORIGIN)).toBe(429);
    expect(await clientFor(url)(TARGET)).toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('http pictures from an https page', () => {
  const mixedDeps = (proxy?: PictureLoaderDeps['proxy']) => {
    const fetch = vi.fn(
      async () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    );
    const deps: PictureLoaderDeps = {
      fetch,
      decode: vi.fn(async () => ({ width: 1, height: 1 })),
      createCanvas: (width, height) =>
        ({
          width,
          height,
          getContext: () => ({ drawImage: () => undefined }),
          toBlob: (done: (blob: Blob | null) => void) =>
            done(new Blob(['x'], { type: 'image/webp' })),
        }) as unknown as HTMLCanvasElement,
      pageProtocol: 'https:',
      proxy,
    };
    return { deps, fetch };
  };

  it('skips the direct fetch and goes straight to the proxy when a secret exists', async () => {
    const proxy = vi.fn(async () => ({
      ok: true as const,
      blob: new Blob([PNG], { type: 'image/png' }),
    }));
    const { deps, fetch } = mixedDeps(proxy);
    const picture = await loadPictureUrl('http://img.example.com/a.png', deps);
    expect(proxy).toHaveBeenCalledWith('http://img.example.com/a.png');
    expect(fetch).not.toHaveBeenCalled();
    expect(picture.name).toBe('a.png');
  });

  it('keeps the mixed-content error without a secret, without a proxy or when it is unreachable', async () => {
    for (const proxy of [
      undefined,
      async () => ({ ok: false as const, code: 'no-secret' as const }),
      async () => ({ ok: false as const, code: 'unavailable' as const }),
    ]) {
      const { deps, fetch } = mixedDeps(proxy);
      await expect(loadPictureUrl('http://img.example.com/a.png', deps)).rejects.toMatchObject({
        code: 'mixed-content',
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('reports a proxy refusal for an http URL with the proxy notice', async () => {
    const { deps } = mixedDeps(async () => ({ ok: false, code: 'disabled' }));
    await expect(loadPictureUrl('http://img.example.com/a.png', deps)).rejects.toMatchObject({
      code: 'proxy-disabled',
    });
  });
});
