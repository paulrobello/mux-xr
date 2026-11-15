/** One authenticated depth estimate per connection to the dictation server's `/picture-depth`. */

import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';
import { hostServiceUrl } from './host-service';

const PROTOCOL = 'mux-xr-picture-depth-v1';
/** Covers the upload and an inference queued behind another frame's. */
const DEFAULT_TIMEOUT_MS = 30_000;
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
    let header: { width: number; height: number; size: number } | null = null;
    return openPairedSocket<{ depth: Blob; width: number; height: number }, PictureDepthFailure>({
      url: options.url(),
      secret,
      protocol: PROTOCOL,
      material: `${bytes.byteLength}\n${digest}`,
      authFields: { size: bytes.byteLength, sha256: digest },
      binaryType: 'arraybuffer',
      timeoutMs,
      onTimeout: () => 'timeout',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onOpenError: () => 'unavailable',
      onServerError: (code) => SERVER_CODES[String(code)] ?? 'unavailable',
      onClose: () => 'unavailable',
      onMessage: (message, socket, challenged) => {
        if (header) {
          if (!(message instanceof ArrayBuffer) || message.byteLength !== header.size) {
            return { ok: false, code: 'unavailable' };
          }
          return {
            ok: true,
            value: {
              depth: new Blob([message], { type: 'image/png' }),
              width: header.width,
              height: header.height,
            },
          };
        }
        const frame = message as {
          type?: unknown;
          width?: unknown;
          height?: unknown;
          size?: unknown;
        };
        if (frame.type === 'ready' && challenged) {
          socket.send(bytes);
          return null;
        }
        const dimension = (value: unknown): value is number =>
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value > 0 &&
          value <= MAX_DEPTH_EDGE;
        if (
          frame.type === 'depth' &&
          dimension(frame.width) &&
          dimension(frame.height) &&
          typeof frame.size === 'number' &&
          Number.isInteger(frame.size) &&
          frame.size > 0 &&
          frame.size <= MAX_DEPTH_REPLY_BYTES
        ) {
          header = { width: frame.width, height: frame.height, size: frame.size };
          return null;
        }
        return { ok: false, code: 'unavailable' };
      },
    }).then((outcome) =>
      outcome.ok
        ? {
            ok: true,
            depth: outcome.value.depth,
            width: outcome.value.width,
            height: outcome.value.height,
          }
        : outcome,
    );
  };
}

/** The production client: the host service port on the page's host, paired by the host clipboard secret. */
export function createDefaultPictureDepth(): PictureDepthEstimator {
  const secret = createHostClipboardSecretStore();
  return createPictureDepthClient({
    url: () => hostServiceUrl('/picture-depth', window.location),
    secret: () => secret.get(),
  });
}
