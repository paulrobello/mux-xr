/** One authenticated depth estimate per connection to the dictation server's `/picture-depth`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';

const PROTOCOL = 'mux-xr-picture-depth-v1';
/** Covers the upload and an inference queued behind another frame's. */
const DEFAULT_TIMEOUT_MS = 30_000;
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;
/** The server's depth map is the model's output, well under this edge. */
const MAX_DEPTH_EDGE = 2048;

/** An 8-bit PNG of at most 2048 x 2048 compresses far below this. */
const MAX_DEPTH_REPLY_BYTES = 4 * 1024 * 1024;

export type PictureDepthFailure =
  | 'no-secret'
  | 'disabled'
  | 'auth'
  | 'rate-limited'
  | 'too-large'
  | 'not-image'
  | 'timeout'
  | 'failed'
  | 'unavailable';

export type PictureDepthResult =
  | { ok: true; depth: Blob; width: number; height: number }
  | { ok: false; code: PictureDepthFailure };

/** Estimates depth for the stored WebP of a picture. */
export type PictureDepthEstimator = (image: Blob) => Promise<PictureDepthResult>;

export interface PictureDepthClientOptions {
  url: () => string;
  secret: () => string | null;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign' | 'digest'>;
  timeoutMs?: number;
}

const SERVER_CODES: Record<string, PictureDepthFailure> = {
  disabled: 'disabled',
  auth: 'auth',
  rate_limited: 'rate-limited',
  busy: 'rate-limited',
  too_large: 'too-large',
  not_image: 'not-image',
  failed: 'failed',
};

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function createPictureDepthClient(
  options: PictureDepthClientOptions,
): PictureDepthEstimator {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  return async (image) => {
    const secret = options.secret();
    if (!secret) return { ok: false, code: 'no-secret' };
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return { ok: false, code: 'unavailable' };
    let bytes: ArrayBuffer;
    let digest: string;
    try {
      bytes = await image.arrayBuffer();
      digest = base64(await crypto.digest('SHA-256', bytes));
    } catch {
      return { ok: false, code: 'unavailable' };
    }
    return new Promise((resolve) => {
      let settled = false;
      let challenged = false;
      let header: { width: number; height: number; size: number } | null = null;
      let socket: HostClipboardSocket | undefined;
      const finish = (result: PictureDepthResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket?.close(1000, 'done');
        } catch {
          /* Already closed. */
        }
        resolve(result);
      };
      const failure = (code: PictureDepthFailure): void => finish({ ok: false, code });
      const timer = setTimeout(() => failure('timeout'), timeoutMs);
      try {
        socket = factory(options.url());
      } catch {
        failure('unavailable');
        return;
      }
      const active = socket;
      active.binaryType = 'arraybuffer';
      active.onerror = () => undefined;
      active.onclose = () => failure('unavailable');
      active.onmessage = (event) => {
        if (header) {
          const data = event.data;
          if (!(data instanceof ArrayBuffer) || data.byteLength !== header.size) {
            failure('unavailable');
            return;
          }
          finish({
            ok: true,
            depth: new Blob([data], { type: 'image/png' }),
            width: header.width,
            height: header.height,
          });
          return;
        }
        if (typeof event.data !== 'string') {
          failure('unavailable');
          return;
        }
        let message: {
          type?: unknown;
          code?: unknown;
          nonce?: unknown;
          width?: unknown;
          height?: unknown;
          size?: unknown;
        };
        try {
          message = JSON.parse(event.data);
        } catch {
          failure('unavailable');
          return;
        }
        const dimension = (value: unknown): value is number =>
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value > 0 &&
          value <= MAX_DEPTH_EDGE;
        if (message.type === 'error') {
          failure(SERVER_CODES[String(message.code)] ?? 'unavailable');
        } else if (message.type === 'challenge') {
          if (
            challenged ||
            typeof message.nonce !== 'string' ||
            !NONCE_FORMAT.test(message.nonce)
          ) {
            failure('unavailable');
            return;
          }
          challenged = true;
          const nonce = message.nonce;
          void (async () => {
            try {
              const key = await crypto.importKey(
                'raw',
                new TextEncoder().encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign'],
              );
              const mac = await crypto.sign(
                'HMAC',
                key,
                new TextEncoder().encode(`${PROTOCOL}\n${nonce}\n${bytes.byteLength}\n${digest}`),
              );
              if (!settled)
                active.send(
                  JSON.stringify({
                    type: 'auth',
                    size: bytes.byteLength,
                    sha256: digest,
                    mac: base64(mac),
                  }),
                );
            } catch {
              failure('unavailable');
            }
          })();
        } else if (message.type === 'ready' && challenged) {
          active.send(bytes);
        } else if (
          message.type === 'depth' &&
          dimension(message.width) &&
          dimension(message.height) &&
          typeof message.size === 'number' &&
          Number.isInteger(message.size) &&
          message.size > 0 &&
          message.size <= MAX_DEPTH_REPLY_BYTES
        ) {
          header = { width: message.width, height: message.height, size: message.size };
        } else failure('unavailable');
      };
    });
  };
}

/** The production client: port 4242 on the page's host, paired by the host clipboard secret. */
export function createDefaultPictureDepth(): PictureDepthEstimator {
  const secret = createHostClipboardSecretStore();
  return createPictureDepthClient({
    url: () => {
      const url = new URL('/picture-depth', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.port = '4242';
      url.search = '';
      url.hash = '';
      return url.href;
    },
    secret: () => secret.get(),
  });
}
