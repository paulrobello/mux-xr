/** One authenticated read-only JSON feed per connection to a dictation server feed route. */
import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';
import { dictationServiceUrl } from './host-stats';

const DEFAULT_TIMEOUT_MS = 20_000;
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;
const CONTROL_CHARS = /\p{Cc}/u;

export type HostFeedFailure =
  | 'no-secret'
  | 'disabled'
  | 'not-configured'
  | 'upstream'
  | 'auth'
  | 'rate-limited'
  | 'unavailable'
  | 'timeout';

export type HostFeedResult<T> = { ok: true; value: T } | { ok: false; code: HostFeedFailure };

/** `request` is the signed request text; feeds that take no input send `{}`. */
export type HostFeedSource<T> = (request: string) => Promise<HostFeedResult<T>>;

export interface HostFeedClientOptions<T> {
  protocol: string;
  url: () => string;
  secret: () => string | null;
  /** Rebuilds the payload field by field; null rejects it. */
  parse: (data: unknown) => T | null;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  timeoutMs?: number;
}

const SERVER_CODES: Record<string, HostFeedFailure> = {
  disabled: 'disabled',
  not_configured: 'not-configured',
  upstream: 'upstream',
  auth: 'auth',
  rate_limited: 'rate-limited',
};

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function createHostFeedClient<T>(options: HostFeedClientOptions<T>): HostFeedSource<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  // A browser cannot read the 429 status, so once this server has answered before, a close before
  // its challenge is most likely a rate-limit refusal rather than a server that went away.
  let answeredBefore = false;
  return (request) => {
    if (CONTROL_CHARS.test(request)) return Promise.resolve({ ok: false, code: 'unavailable' });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return new Promise((resolve) => {
      let settled = false;
      let challenged = false;
      let socket: HostClipboardSocket | undefined;
      const finish = (result: HostFeedResult<T>): void => {
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
      const fail = (code: HostFeedFailure): void => finish({ ok: false, code });
      const timer = setTimeout(() => fail('timeout'), timeoutMs);
      try {
        socket = factory(options.url());
      } catch {
        fail('unavailable');
        return;
      }
      const active = socket;
      active.onerror = () => undefined;
      active.onclose = () => fail(!challenged && answeredBefore ? 'rate-limited' : 'unavailable');
      active.onmessage = (event) => {
        let message: { type?: unknown; code?: unknown; nonce?: unknown; data?: unknown };
        try {
          message = typeof event.data === 'string' ? JSON.parse(event.data) : {};
        } catch {
          message = {};
        }
        if (message.type === 'error') {
          fail(SERVER_CODES[String(message.code)] ?? 'unavailable');
        } else if (message.type === 'challenge') {
          if (
            challenged ||
            typeof message.nonce !== 'string' ||
            !NONCE_FORMAT.test(message.nonce)
          ) {
            fail('unavailable');
            return;
          }
          challenged = true;
          answeredBefore = true;
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
                new TextEncoder().encode(`${options.protocol}\n${nonce}\n${request}`),
              );
              if (!settled)
                active.send(JSON.stringify({ type: 'auth', request, mac: base64(mac) }));
            } catch {
              fail('unavailable');
            }
          })();
        } else if (message.type === 'feed' && challenged) {
          const value = options.parse(message.data);
          if (value === null) fail('unavailable');
          else finish({ ok: true, value });
        } else fail('unavailable');
      };
    });
  };
}

/** A feed client on the dictation server's `path`, paired with the host clipboard secret. */
export function defaultHostFeedSource<T>(
  path: string,
  protocol: string,
  parse: (data: unknown) => T | null,
): HostFeedSource<T> {
  let client: HostFeedSource<T> | undefined;
  return (request) => {
    client ??= createHostFeedClient({
      protocol,
      parse,
      url: () => dictationServiceUrl(path, window.location),
      secret: createHostClipboardSecretStore().get,
    });
    return client(request);
  };
}
