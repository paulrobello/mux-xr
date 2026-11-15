/** A long-lived subscription to toasts that outside programs post to the host service's `/toast`. */
import type { HostClipboardSocket } from './host-clipboard';
import { openPairedSocket } from './host-pairing';
import { parseToastEnvelope, type ToastEnvelope } from './toast-contract';

const PROTOCOL = 'mux-xr-toasts-v1';
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

export function createToastSubscription(options: ToastSubscriptionOptions): ToastSubscription {
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
    let refused = false;
    let opened = false;
    const drop = (): void => {
      try {
        socket?.close(1000, 'done');
      } catch {
        /* Already closed. */
      }
    };
    void openPairedSocket<void, string>({
      url: options.url(),
      secret,
      protocol: PROTOCOL,
      material: 'subscribe',
      socketFactory: options.socketFactory,
      subtle: crypto,
      onSocket: (active) => {
        socket = active;
        opened = true;
      },
      onOpenError: () => {
        if (opened) drop();
        else retry();
        return null;
      },
      onServerError: () => {
        refused = true;
        return null;
      },
      onClose: (info) => {
        if (socket !== info.socket) return null;
        socket = null;
        if (!running) return null;
        // An auth refusal or a disabled server will not fix itself quickly; back off to the maximum.
        if (refused) {
          setState('refused');
          retryMs = RETRY_MAX_MS;
        } else setState('connecting');
        retry();
        return null;
      },
      onTimeout: () => 'timeout',
      onMessage: (message) => {
        const frame = message as { type?: unknown };
        if (frame.type === 'ready') {
          retryMs = RETRY_MIN_MS;
          setState('subscribed');
        } else if (state === 'subscribed') {
          const envelope = parseToastEnvelope(message);
          if (envelope) options.onEnvelope(envelope);
        }
        return null;
      },
    });
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
