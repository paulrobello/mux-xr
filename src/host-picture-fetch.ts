/** One authenticated image fetch per connection to the dictation server's `/picture-fetch`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';
import { hostServiceUrl } from './host-service';

const PROTOCOL = 'mux-xr-picture-fetch-v1';
const DEFAULT_TIMEOUT_MS = 15_000;
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

export function createPictureProxyClient(options: PictureProxyClientOptions): PictureProxyFetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return (target) => {
    if (CONTROL_CHARS.test(target)) return Promise.resolve({ ok: false, code: 'bad-url' });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    let header: { type: string; size: number } | null = null;
    return openPairedSocket<{ blob: Blob }, PictureProxyFailure>({
      url: options.url(),
      secret,
      protocol: PROTOCOL,
      material: target,
      authFields: { url: target },
      binaryType: 'arraybuffer',
      timeoutMs,
      onTimeout: () => 'timeout',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onOpenError: () => 'unavailable',
      onServerError: (code) => SERVER_CODES[String(code)] ?? 'unavailable',
      onClose: () => 'unavailable',
      onMessage: (message) => {
        if (header) {
          if (!(message instanceof ArrayBuffer) || message.byteLength !== header.size) {
            return { ok: false, code: 'unavailable' };
          }
          return { ok: true, value: { blob: new Blob([message], { type: header.type }) } };
        }
        const frame = message as {
          type?: unknown;
          contentType?: unknown;
          size?: unknown;
        };
        if (
          frame.type === 'image' &&
          typeof frame.contentType === 'string' &&
          IMAGE_TYPES.includes(frame.contentType) &&
          typeof frame.size === 'number' &&
          Number.isInteger(frame.size) &&
          frame.size > 0
        ) {
          header = { type: frame.contentType, size: frame.size };
          return null;
        }
        return { ok: false, code: 'unavailable' };
      },
    }).then((outcome) => (outcome.ok ? { ok: true, blob: outcome.value.blob } : outcome));
  };
}

/** The production client: the host service port on the page's host, paired by the host clipboard secret. */
export function createDefaultPictureProxy(): PictureProxyFetcher {
  const secret = createHostClipboardSecretStore();
  return createPictureProxyClient({
    url: () => hostServiceUrl('/picture-fetch', window.location),
    secret: () => secret.get(),
  });
}
