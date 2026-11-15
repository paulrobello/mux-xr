/** Explicit, one-request-per-connection clipboard transfers with the host's dictation server. */
import { openPairedSocket, type PairedOutcome } from './host-pairing';

import { HOST_SERVICE_PORT } from './host-service';

export const HOST_CLIPBOARD_SECRET_KEY = 'mux-xr.host-clipboard-secret';
export const HOST_CLIPBOARD_MAX_BYTES = 256 * 1024;
const PROTOCOL = 'mux-xr-clipboard-v1';
const DEFAULT_TIMEOUT_MS = 10_000;

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
  unavailable: `The host clipboard service is unreachable. Check the dictation server on port ${HOST_SERVICE_PORT} is running and updated.`,
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

  const transfer = <T>(
    op: 'read' | 'write',
    payload: Uint8Array | null,
    onBinary: (bytes: Uint8Array) => HostClipboardResult<T>,
  ): Promise<HostClipboardResult<T>> => {
    const secret = options.secret();
    if (!secret) return Promise.resolve(failure('no-secret'));
    const crypto = subtle();
    if (!crypto) return Promise.resolve(failure('unavailable'));
    return openPairedSocket<T, HostClipboardFailure>({
      url: options.url(),
      secret,
      protocol: PROTOCOL,
      material: op,
      authFields: { op },
      binaryType: 'arraybuffer',
      timeoutMs,
      onTimeout: () => 'timeout',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onOpenError: () => 'unavailable',
      onServerError: (code) => SERVER_CODES[String(code)] ?? 'unavailable',
      onClose: (info) => (info.closeCode === 1009 ? 'too-large' : 'unavailable'),
      onMessage: (message, socket) => {
        if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
          const bytes = toBytes(message);
          return op === 'read' && bytes ? onBinary(bytes) : failure('unavailable');
        }
        const frame = message as { type?: unknown; bytes?: unknown };
        if (frame.type === 'ready' && op === 'write' && payload) {
          socket.send(payload);
          return null;
        }
        if (frame.type === 'ok' && op === 'write') {
          return { ok: true, value: Number(frame.bytes) || 0 } as PairedOutcome<
            T,
            HostClipboardFailure
          >;
        }
        return failure('unavailable');
      },
    }).then(
      (outcome: PairedOutcome<T, HostClipboardFailure>): HostClipboardResult<T> =>
        outcome.ok ? { ok: true, value: outcome.value } : failure(outcome.code),
    );
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
