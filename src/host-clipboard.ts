/** Explicit, one-request-per-connection clipboard transfers with the host's dictation server. */

export const HOST_CLIPBOARD_SECRET_KEY = 'mux-xr.host-clipboard-secret';
export const HOST_CLIPBOARD_MAX_BYTES = 256 * 1024;
const PROTOCOL = 'mux-xr-clipboard-v1';
const DEFAULT_TIMEOUT_MS = 10_000;
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;

export const HOST_CLIPBOARD_SETUP =
  'On the Mac run: mkdir -p .local && (umask 077; openssl rand -base64 32 > .local/clipboard-secret), then paste that value (at least 32 characters) in Settings → Host clipboard.';

export type HostClipboardFailure =
  | 'no-secret'
  | 'disabled'
  | 'auth'
  | 'too-large'
  | 'invalid-text'
  | 'host-failed'
  | 'unavailable'
  | 'timeout';

export type HostClipboardResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: HostClipboardFailure; message: string };

export interface HostClipboardClient {
  read(): Promise<HostClipboardResult<string>>;
  write(text: string): Promise<HostClipboardResult<number>>;
}

export interface HostClipboardSocket {
  binaryType: string;
  readyState: number;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface HostClipboardOptions {
  url: () => string;
  secret: () => string | null;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  timeoutMs?: number;
}

export const HOST_CLIPBOARD_MESSAGES: Record<HostClipboardFailure, string> = {
  'no-secret': 'Host clipboard is not paired. Enter the host clipboard secret in Settings.',
  disabled: `Host clipboard sync is off on the Mac. It needs the dictation server running as a LaunchAgent (make install-whisper-agent) and a secret file. ${HOST_CLIPBOARD_SETUP}`,
  auth: 'The host rejected the clipboard secret. Check it in Settings → Host clipboard.',
  'too-large': 'Clipboard text is over the 256 KiB limit.',
  'invalid-text': 'Only plain UTF-8 text without NUL bytes can be transferred.',
  'host-failed': 'The Mac could not access its clipboard.',
  unavailable:
    'The host clipboard service is unreachable. Check the dictation server on port 4242 is running and updated.',
  timeout: 'The host clipboard did not answer in time.',
};

const SERVER_CODES: Record<string, HostClipboardFailure> = {
  disabled: 'disabled',
  auth: 'auth',
  too_large: 'too-large',
  invalid_text: 'invalid-text',
  host_failed: 'host-failed',
};

const failure = <T>(code: HostClipboardFailure): HostClipboardResult<T> => ({
  ok: false,
  code,
  message: HOST_CLIPBOARD_MESSAGES[code],
});

/** Plain text under the cap with no NUL, or the reason it cannot be sent. */
export const checkHostClipboardText = (
  text: string,
): { ok: true; bytes: Uint8Array } | { ok: false; code: 'too-large' | 'invalid-text' } => {
  if (text.includes('\0')) return { ok: false, code: 'invalid-text' };
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > HOST_CLIPBOARD_MAX_BYTES) return { ok: false, code: 'too-large' };
  return { ok: true, bytes };
};

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const toBytes = (data: unknown): Uint8Array | null => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
};

export function createHostClipboardClient(options: HostClipboardOptions): HostClipboardClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const subtle = (): Pick<SubtleCrypto, 'importKey' | 'sign'> | undefined =>
    options.subtle ?? globalThis.crypto?.subtle;
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);

  const transfer = <T>(
    op: 'read' | 'write',
    payload: Uint8Array | null,
    onBinary: (bytes: Uint8Array) => HostClipboardResult<T>,
  ): Promise<HostClipboardResult<T>> => {
    const secret = options.secret();
    if (!secret) return Promise.resolve(failure('no-secret'));
    const crypto = subtle();
    if (!crypto) return Promise.resolve(failure('unavailable'));
    return new Promise((resolve) => {
      let settled = false;
      let challenged = false;
      let socket: HostClipboardSocket | undefined;
      const finish = (result: HostClipboardResult<T>): void => {
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
      const timer = setTimeout(() => finish(failure('timeout')), timeoutMs);
      try {
        socket = factory(options.url());
      } catch {
        finish(failure('unavailable'));
        return;
      }
      const active = socket;
      active.binaryType = 'arraybuffer';
      active.onerror = () => undefined;
      active.onclose = (event) =>
        finish(failure(event.code === 1009 ? 'too-large' : 'unavailable'));
      active.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          const bytes = toBytes(event.data);
          finish(op === 'read' && bytes ? onBinary(bytes) : failure('unavailable'));
          return;
        }
        let message: { type?: unknown; code?: unknown; nonce?: unknown; bytes?: unknown };
        try {
          message = JSON.parse(event.data);
        } catch {
          finish(failure('unavailable'));
          return;
        }
        if (message.type === 'error') {
          finish(failure(SERVER_CODES[String(message.code)] ?? 'unavailable'));
        } else if (message.type === 'challenge') {
          // The server sends exactly one 32-byte base64 nonce per connection.
          if (
            challenged ||
            typeof message.nonce !== 'string' ||
            !NONCE_FORMAT.test(message.nonce)
          ) {
            finish(failure('unavailable'));
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
                new TextEncoder().encode(`${PROTOCOL}\n${nonce}\n${op}`),
              );
              if (!settled) active.send(JSON.stringify({ type: 'auth', op, mac: base64(mac) }));
            } catch {
              finish(failure('unavailable'));
            }
          })();
        } else if (message.type === 'ready' && op === 'write' && payload) {
          active.send(payload);
        } else if (message.type === 'ok' && op === 'write') {
          finish({ ok: true, value: Number(message.bytes) || 0 } as HostClipboardResult<T>);
        } else finish(failure('unavailable'));
      };
    });
  };

  return {
    read: () =>
      transfer<string>('read', null, (bytes) => {
        if (bytes.byteLength > HOST_CLIPBOARD_MAX_BYTES) return failure('too-large');
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          return failure('invalid-text');
        }
        return text.includes('\0') ? failure('invalid-text') : { ok: true, value: text };
      }),
    write: (text) => {
      const checked = checkHostClipboardText(text);
      if (!checked.ok) return Promise.resolve(failure(checked.code));
      return transfer<number>('write', checked.bytes, () => failure('unavailable'));
    },
  };
}

type SecretStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): SecretStorage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The pairing secret lives under its own key, never inside workspace settings. */
export function createHostClipboardSecretStore(
  storage: () => SecretStorage | undefined = browserStorage,
) {
  return {
    get(): string | null {
      try {
        return storage()?.getItem(HOST_CLIPBOARD_SECRET_KEY)?.trim() || null;
      } catch {
        return null;
      }
    },
    set(secret: string): boolean {
      const value = secret.trim();
      if (!value) return false;
      try {
        storage()?.setItem(HOST_CLIPBOARD_SECRET_KEY, value);
        return true;
      } catch {
        return false;
      }
    },
    forget(): void {
      try {
        storage()?.removeItem(HOST_CLIPBOARD_SECRET_KEY);
      } catch {
        /* Storage unavailable. */
      }
    },
  };
}

export type HostClipboardSecretStore = ReturnType<typeof createHostClipboardSecretStore>;
