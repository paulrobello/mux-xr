/** A long-lived subscription to toasts that outside programs post to the host service's `/toast`. */
import type { HostClipboardSocket } from './host-clipboard';
import { parseToastEnvelope, type ToastEnvelope } from './toast-contract';

const PROTOCOL = 'mux-xr-toasts-v1';
const NONCE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;
/** How often a subscription without a secret checks whether one has been paired since. */
const SECRET_POLL_MS = 5_000;

export type ToastSubscriptionState = 'idle' | 'connecting' | 'subscribed' | 'refused';

export interface ToastSubscriptionOptions {
  url: () => string;
  secret: () => string | null;
  onEnvelope: (envelope: ToastEnvelope) => void;
  onState?: (state: ToastSubscriptionState) => void;
  socketFactory?: (url: string) => HostClipboardSocket;
  subtle?: Pick<SubtleCrypto, 'importKey' | 'sign'>;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ToastSubscription {
  start(): void;
  stop(): void;
  /** Asks the host to clear a toast on every headset; false while not subscribed. */
  dismiss(id: string): boolean;
}

const base64 = (bytes: ArrayBuffer): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function createToastSubscription(options: ToastSubscriptionOptions): ToastSubscription {
  const factory =
    options.socketFactory ??
    ((url: string) => new WebSocket(url) as unknown as HostClipboardSocket);
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let running = false;
  let socket: HostClipboardSocket | null = null;
  let timer: unknown = null;
  let retryMs = RETRY_MIN_MS;
  let state: ToastSubscriptionState = 'idle';
  const setState = (next: ToastSubscriptionState): void => {
    if (state === next) return;
    state = next;
    options.onState?.(next);
  };
  const schedule = (ms: number): void => {
    if (!running) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      connect();
    }, ms);
  };
  const retry = (): void => {
    schedule(retryMs);
    retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
  };
  const connect = (): void => {
    if (!running || socket) return;
    const secret = options.secret();
    const crypto = options.subtle ?? globalThis.crypto?.subtle;
    if (!secret || !crypto) {
      setState('idle');
      schedule(SECRET_POLL_MS);
      return;
    }
    setState('connecting');
    let active: HostClipboardSocket;
    try {
      active = factory(options.url());
    } catch {
      retry();
      return;
    }
    socket = active;
    let challenged = false;
    let refused = false;
    const drop = (): void => {
      try {
        active.close(1000, 'done');
      } catch {
        /* Already closed. */
      }
    };
    active.onerror = () => undefined;
    active.onclose = () => {
      if (socket !== active) return;
      socket = null;
      if (!running) return;
      // An auth refusal or a disabled server will not fix itself quickly; back off to the maximum.
      if (refused) {
        setState('refused');
        retryMs = RETRY_MAX_MS;
      } else setState('connecting');
      retry();
    };
    active.onmessage = (event) => {
      let message: { type?: unknown; nonce?: unknown };
      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : {};
      } catch {
        message = {};
      }
      if (message.type === 'challenge') {
        if (challenged || typeof message.nonce !== 'string' || !NONCE_FORMAT.test(message.nonce)) {
          drop();
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
              new TextEncoder().encode(`${PROTOCOL}\n${nonce}\nsubscribe`),
            );
            if (socket === active) active.send(JSON.stringify({ type: 'auth', mac: base64(mac) }));
          } catch {
            drop();
          }
        })();
      } else if (message.type === 'ready') {
        retryMs = RETRY_MIN_MS;
        setState('subscribed');
      } else if (message.type === 'error') {
        refused = true;
      } else if (state === 'subscribed') {
        const envelope = parseToastEnvelope(message);
        if (envelope) options.onEnvelope(envelope);
      }
    };
  };
  return {
    start() {
      if (running) return;
      running = true;
      retryMs = RETRY_MIN_MS;
      connect();
    },
    dismiss(id) {
      if (state !== 'subscribed' || !socket) return false;
      try {
        socket.send(JSON.stringify({ type: 'dismiss', id }));
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
      const active = socket;
      socket = null;
      try {
        active?.close(1000, 'stopped');
      } catch {
        /* Already closed. */
      }
      setState('idle');
    },
  };
}
