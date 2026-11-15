/**
 * The shared browser side of the paired-route handshake: one place that validates the nonce,
 * answers the challenge with an HMAC auth frame and owns the timeout and settle-once scaffolding.
 * Route clients supply the signed request text, any extra auth fields, and callbacks for the
 * server's error, close and payload frames.
 */
import type { HostClipboardSocket } from './host-clipboard';

/** The server sends exactly one 32-byte base64 nonce per connection. */
export const PAIRED_NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export type PairedSessionSocket = {
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
};

export type PairedOutcome<V, F extends string> = { ok: true; value: V } | { ok: false; code: F };

export type PairedCloseInfo = {
  /** True once this session answered its challenge. */
  challenged: boolean;
  closeCode: number;
  socket: HostClipboardSocket;
};

export type PairedSocketOptions<V, F extends string> = {
  url: string;
  secret: string;
  protocol: string;
  /** The signed request text: the MAC covers `protocol\nnonce\nmaterial`. */
  material: string;
  /** Extra auth-message fields beyond `{type:'auth', mac}`, sent before mac. */
  authFields?: Record<string, unknown>;
  /** Set for routes that deliver payloads as ArrayBuffer frames. */
  binaryType?: 'arraybuffer';
  timeoutMs?: number;
  socketFactory?: (url: string) => HostClipboardSocket;
  /** Runs with the socket right after it is created, for subscriptions that must track it. */
  onSocket?: (socket: HostClipboardSocket) => void;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  /**
   * A session that never starts (socket factory throws, bad challenge, crypto failure) maps to a
   * failure, or to null to leave the promise pending; the socket close then drives the outcome.
   */
  onOpenError: () => F | null;
  /** Runs when this session accepts its challenge, so route clients can keep cross-call state. */
  onChallenge?: () => void;
  /** `{type:'error', code}` frames; return the failure to settle, or null to keep the session. */
  onServerError: (code: unknown) => F | null;
  /** The socket closed; return the failure to settle, or null to leave the promise pending. */
  onClose: (info: PairedCloseInfo) => F | null;
  /** Runs when the timeout expires; only used when timeoutMs is set. */
  onTimeout: () => F;
  /**
   * Route frames: parsed JSON for text and raw data for binary. Return the outcome to settle the
   * session, or null to keep waiting.
   */
  onMessage: (
    message: unknown,
    socket: PairedSessionSocket,
    challenged: boolean,
  ) => PairedOutcome<V, F> | null;
};

/**
 * Opens one authenticated request-per-connection session, or a long-lived subscription when the
 * callbacks never settle. The promise settles exactly once and closes the socket.
 */
export function openPairedSocket<V, F extends string>(
  options: PairedSocketOptions<V, F>,
): Promise<PairedOutcome<V, F>> {
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  return new Promise((resolve) => {
    let settled = false;
    let challenged = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: HostClipboardSocket | undefined;
    const settle = (result: PairedOutcome<V, F>): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        socket?.close(1000, 'done');
      } catch {
        /* Already closed. */
      }
      resolve(result);
    };
    const route = (data: unknown): void => {
      const outcome = options.onMessage(data, socket as PairedSessionSocket, challenged);
      if (outcome !== null) settle(outcome);
    };
    const startCryptoFailure = (): void => {
      const code = options.onOpenError();
      if (code !== null) settle({ ok: false, code });
      else {
        try {
          socket?.close(1000, 'done');
        } catch {
          /* Already closed. */
        }
      }
    };
    if (options.timeoutMs !== undefined)
      timer = setTimeout(() => settle({ ok: false, code: options.onTimeout() }), options.timeoutMs);
    try {
      socket = factory(options.url);
    } catch {
      startCryptoFailure();
      return;
    }
    options.onSocket?.(socket);
    if (options.binaryType) socket.binaryType = options.binaryType;
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      const code = options.onClose({
        challenged,
        closeCode: event.code,
        socket: socket as HostClipboardSocket,
      });
      if (code !== null) settle({ ok: false, code });
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        route(event.data);
        return;
      }
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data);
      } catch {
        message = {};
      }
      if (message?.type === 'error') {
        const code = options.onServerError(message.code);
        if (code !== null) settle({ ok: false, code });
        return;
      }
      if (message?.type === 'challenge') {
        if (
          challenged ||
          typeof message.nonce !== 'string' ||
          !PAIRED_NONCE_FORMAT.test(message.nonce)
        ) {
          startCryptoFailure();
          return;
        }
        challenged = true;
        options.onChallenge?.();
        void (async () => {
          const crypto = options.subtle;
          if (!crypto) {
            startCryptoFailure();
            return;
          }
          try {
            const key = await crypto.importKey(
              'raw',
              new TextEncoder().encode(options.secret),
              { name: 'HMAC', hash: 'SHA-256' },
              false,
              ['sign'],
            );
            const mac = await crypto.sign(
              'HMAC',
              key,
              new TextEncoder().encode(
                `${options.protocol}\n${String(message.nonce)}\n${options.material}`,
              ),
            );
            if (!settled)
              socket?.send(
                JSON.stringify({ type: 'auth', ...options.authFields, mac: base64(mac) }),
              );
          } catch {
            startCryptoFailure();
          }
        })();
        return;
      }
      route(message);
    };
  });
}
