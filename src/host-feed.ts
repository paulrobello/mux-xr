/** One authenticated read-only JSON feed per connection to a dictation server feed route. */
import { createHostClipboardSecretStore, type HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';
import { hostServiceUrl } from './host-service';

const DEFAULT_TIMEOUT_MS = 20_000;
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

export function createHostFeedClient<T>(options: HostFeedClientOptions<T>): HostFeedSource<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // A browser cannot read the 429 status, so once this server has answered before, a close before
  // its challenge is most likely a rate-limit refusal rather than a server that went away.
  let answeredBefore = false;
  return (request) => {
    if (CONTROL_CHARS.test(request)) return Promise.resolve({ ok: false, code: 'unavailable' });
    const secret = options.secret();
    if (!secret) return Promise.resolve({ ok: false, code: 'no-secret' });
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!crypto) return Promise.resolve({ ok: false, code: 'unavailable' });
    return openPairedSocket<T, HostFeedFailure>({
      url: options.url(),
      secret,
      protocol: options.protocol,
      material: request,
      authFields: { request },
      timeoutMs,
      onTimeout: () => 'timeout',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onChallenge: () => {
        answeredBefore = true;
      },
      onOpenError: () => 'unavailable',
      onServerError: (code) => SERVER_CODES[String(code)] ?? 'unavailable',
      onClose: (info) => (!info.challenged && answeredBefore ? 'rate-limited' : 'unavailable'),
      onMessage: (message, _socket, challenged) => {
        const frame = message as { type?: unknown; data?: unknown };
        if (frame.type === 'feed' && challenged) {
          const value = options.parse(frame.data);
          return value === null ? { ok: false, code: 'unavailable' } : { ok: true, value };
        }
        return { ok: false, code: 'unavailable' };
      },
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
      url: () => hostServiceUrl(path, window.location),
      secret: createHostClipboardSecretStore().get,
    });
    return client(request);
  };
}
