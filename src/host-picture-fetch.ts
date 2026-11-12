/** One authenticated image fetch per connection to the dictation server's `/picture-fetch`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';

const PROTOCOL = 'mux-xr-picture-fetch-v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;
const CONTROL_CHARS = /\p{Cc}/u;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heif'];

export type PictureProxyFailure =
  | 'no-secret'
  | 'disabled'
  | 'auth'
  | 'rate-limited'
  | 'bad-url'
  | 'blocked'
  | 'too-large'
  | 'not-image'
  | 'timeout'
  | 'failed'
  | 'unavailable';

export type PictureProxyResult =
  | { ok: true; blob: Blob }
  | { ok: false; code: PictureProxyFailure };

export type PictureProxyFetcher = (url: string) => Promise<PictureProxyResult>;

export interface PictureProxyClientOptions {
  url: () => string;
  secret: () => string | null;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  timeoutMs?: number;
}

const SERVER_CODES: Record<string, PictureProxyFailure> = {
  disabled: 'disabled',
  auth: 'auth',
  rate_limited: 'rate-limited',
  bad_url: 'bad-url',
  blocked: 'blocked',
  too_large: 'too-large',
  not_image: 'not-image',
  timeout: 'timeout',
  failed: 'failed',
};

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function createPictureProxyClient(options: PictureProxyClientOptions): PictureProxyFetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  return (target) => {
    if (CONTROL_CHARS.test(target)) return Promise.resolve({ ok: false, code: 'bad-url' });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return new Promise((resolve) => {
      let settled = false;
      let challenged = false;
      let header: { type: string; size: number } | null = null;
      let socket: HostClipboardSocket | undefined;
      const finish = (result: PictureProxyResult): void => {
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
      const failure = (code: PictureProxyFailure): void => finish({ ok: false, code });
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
          finish({ ok: true, blob: new Blob([data], { type: header.type }) });
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
          contentType?: unknown;
          size?: unknown;
        };
        try {
          message = JSON.parse(event.data);
        } catch {
          failure('unavailable');
          return;
        }
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
                new TextEncoder().encode(`${PROTOCOL}\n${nonce}\n${target}`),
              );
              if (!settled)
                active.send(JSON.stringify({ type: 'auth', url: target, mac: base64(mac) }));
            } catch {
              failure('unavailable');
            }
          })();
        } else if (
          message.type === 'image' &&
          typeof message.contentType === 'string' &&
          IMAGE_TYPES.includes(message.contentType) &&
          typeof message.size === 'number' &&
          Number.isInteger(message.size) &&
          message.size > 0
        ) {
          header = { type: message.contentType, size: message.size };
        } else failure('unavailable');
      };
    });
  };
}

/** The production client: port 4242 on the page's host, paired by the host clipboard secret. */
export function createDefaultPictureProxy(): PictureProxyFetcher {
  const secret = createHostClipboardSecretStore();
  return createPictureProxyClient({
    url: () => {
      const url = new URL('/picture-fetch', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.port = '4242';
      url.search = '';
      url.hash = '';
      return url.href;
    },
    secret: () => secret.get(),
  });
}
