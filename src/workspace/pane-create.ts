import { create } from '@bufbuild/protobuf';
import type { PaneDescriptor } from '../contracts';
import { decodeServerMessage, encodeClientMessage } from '../terminal/protocol';
import { paneWebSocketURL } from '../terminal/surface';
import {
  type ClientMessage,
  ClientMessageSchema,
  PaneCreateRequestSchema,
} from '../terminal/vendor/terminal_pb';

/**
 * Why a create request was refused. `disabled`, `read_only`, `no_daemon` and `unreachable`
 * are certain: no pane was created. `failed` and `error` are not: core can return
 * `pane_create_failed` after `new-window` already ran (for example a `list-panes` timeout).
 */
export type PaneCreateRefusal =
  | 'disabled'
  | 'read_only'
  | 'no_daemon'
  | 'failed'
  | 'unreachable'
  | 'error';

export type PaneCreateOutcome =
  | {
      kind: 'created';
      correlationId: string;
      sessionId: string;
      windowId: string;
      paneId: string;
    }
  | { kind: 'refused'; reason: PaneCreateRefusal; code?: string; message: string }
  | { kind: 'uncertain'; correlationId: string; cause: 'timeout' | 'closed' };

type CreatedOutcome = Extract<PaneCreateOutcome, { kind: 'created' }>;

export interface PaneCreateSocket {
  binaryType: string;
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: ArrayBuffer): void;
  close(): void;
}

export interface PaneCreateRequestOptions {
  correlationId?: string;
  /** How long to wait for `connected`, then for the reply. */
  timeoutMs?: number;
  /** How long a timed-out request keeps listening for a late correlated reply. */
  lateGraceMs?: number;
  socketFactory?: (url: string) => PaneCreateSocket;
  onLateReply?: (outcome: CreatedOutcome) => void;
  /** Aborting closes the stream; a pending result resolves `unreachable` (unsent) or `uncertain`. */
  signal?: AbortSignal;
}

const REFUSAL_CODES: Record<string, PaneCreateRefusal> = {
  pane_create_disabled: 'disabled',
  pane_create_read_only: 'read_only',
  pane_create_no_daemon: 'no_daemon',
  pane_create_failed: 'failed',
};

export function refusalFromCode(code: string | undefined): PaneCreateRefusal {
  return (code && REFUSAL_CODES[code]) || 'error';
}

export function paneCreateMessage(correlationId: string, sessionId: string): ClientMessage {
  return create(ClientMessageSchema, {
    message: {
      case: 'paneCreateRequest',
      value: create(PaneCreateRequestSchema, { correlationId, sessionId }),
    },
  });
}

function newCorrelationId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `mux-xr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sends one `pane_create_request` over a short-lived writable connection to an existing pane.
 * The metadata socket is always read-only, so it cannot carry the request. Opening a pane
 * stream seeds the mirror at the pane's current size and sends no resize or input.
 * The request is never retried: a missing reply resolves `uncertain`.
 */
export function requestPaneCreate(
  endpoint: string,
  anchorPaneId: string,
  sessionId: string,
  options: PaneCreateRequestOptions = {},
): Promise<PaneCreateOutcome> {
  const correlationId = options.correlationId ?? newCorrelationId();
  const timeoutMs = options.timeoutMs ?? 10000;
  const lateGraceMs = options.lateGraceMs ?? 10000;
  const factory =
    options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as PaneCreateSocket);
  return new Promise((resolve) => {
    let socket: PaneCreateSocket;
    try {
      socket = factory(paneWebSocketURL(endpoint, anchorPaneId));
    } catch (error) {
      resolve({
        kind: 'refused',
        reason: 'unreachable',
        message: error instanceof Error ? error.message : 'The streamer could not be reached.',
      });
      return;
    }
    socket.binaryType = 'arraybuffer';
    let sent = false;
    let settled = false;
    let late = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = (): void => {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    };
    const finish = (outcome: PaneCreateOutcome): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(outcome);
    };
    const expire = (): void => {
      if (!sent) {
        finish({
          kind: 'refused',
          reason: 'unreachable',
          message: 'The streamer did not accept a pane connection in time.',
        });
        return;
      }
      settled = true;
      late = true;
      resolve({ kind: 'uncertain', correlationId, cause: 'timeout' });
      clearTimeout(timer);
      timer = setTimeout(close, lateGraceMs);
    };
    timer = setTimeout(expire, timeoutMs);
    const abort = (): void => {
      late = false;
      if (settled) close();
      else if (sent) finish({ kind: 'uncertain', correlationId, cause: 'closed' });
      else finish({ kind: 'refused', reason: 'unreachable', message: 'Cancelled.' });
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    socket.onmessage = (event) => {
      let message: ReturnType<typeof decodeServerMessage>;
      try {
        message = decodeServerMessage(event.data as ArrayBuffer);
      } catch {
        return;
      }
      const value = message.message;
      if (value.case === 'connected') {
        if (sent) return;
        if (value.value.readonly) {
          finish({
            kind: 'refused',
            reason: 'read_only',
            message: 'This streamer connection is read-only.',
          });
          return;
        }
        socket.send(encodeClientMessage(paneCreateMessage(correlationId, sessionId)));
        sent = true;
        clearTimeout(timer);
        timer = setTimeout(expire, timeoutMs);
        return;
      }
      if (value.case === 'paneCreated') {
        if (value.value.correlationId !== correlationId) return;
        const created: CreatedOutcome = {
          kind: 'created',
          correlationId,
          sessionId: value.value.sessionId,
          windowId: value.value.windowId,
          paneId: value.value.paneId,
        };
        if (late) {
          close();
          late = false;
          options.onLateReply?.(created);
        } else finish(created);
        return;
      }
      if (value.case === 'error' && !late) {
        // Error frames carry no correlation id; once sent, only creation codes answer the request.
        if (sent && !value.value.code?.startsWith('pane_create_')) return;
        finish({
          kind: 'refused',
          reason: sent ? refusalFromCode(value.value.code) : 'unreachable',
          code: value.value.code,
          message: value.value.message,
        });
      }
    };
    socket.onerror = () => {
      if (!sent) finish({ kind: 'refused', reason: 'unreachable', message: 'Connection failed.' });
    };
    socket.onclose = () => {
      if (late) {
        clearTimeout(timer);
        late = false;
        return;
      }
      if (sent) finish({ kind: 'uncertain', correlationId, cause: 'closed' });
      else finish({ kind: 'refused', reason: 'unreachable', message: 'Connection closed.' });
    };
  });
}

/** User-facing text for an outcome. */
export function describePaneCreateOutcome(outcome: PaneCreateOutcome, sessionName = ''): string {
  const where = sessionName ? ` in ${sessionName}` : '';
  if (outcome.kind === 'created') return `Created terminal ${outcome.paneId}${where}.`;
  if (outcome.kind === 'uncertain')
    return 'No reply to the create request. The streamer may predate terminal creation, or the reply was lost. The workspace was refreshed and nothing is retried automatically.';
  switch (outcome.reason) {
    case 'disabled':
      return 'Terminal creation is turned off on this streamer. It must be started with --allow-pane-create.';
    case 'read_only':
      return 'This streamer connection is read-only, so it cannot create terminals.';
    case 'no_daemon':
      return 'This streamer is not backed by a par-mux daemon, so it cannot create terminals.';
    case 'failed':
      return `The mux daemon could not create the terminal: ${outcome.message.slice(0, 160)}`;
    case 'unreachable':
      return `Could not reach the streamer to create a terminal: ${outcome.message.slice(0, 160)} Nothing was created.`;
    default:
      return `The streamer refused terminal creation${outcome.code ? ` (${outcome.code})` : ''}: ${outcome.message.slice(0, 160)}`;
  }
}

export interface PaneCreationState {
  /** False when this streamer is known not to support creation for this connection. */
  available: boolean;
  /** True while a request or its confirmation is outstanding. */
  pending: boolean;
  /** Why creation is unavailable or pending; absent when idle and available. */
  reason?: string;
}

export interface PaneCreatorDeps {
  request(
    anchorPaneId: string,
    sessionId: string,
    token: number,
    signal: AbortSignal,
  ): Promise<PaneCreateOutcome>;
  refreshTree(): void;
  attach(paneId: string): void;
  notify(message: string): void;
  onChange(state: PaneCreationState): void;
  attachTimeoutMs?: number;
  /** How long an unconfirmed outcome watches refreshed snapshots for a new pane. */
  confirmMs?: number;
  /** Confirmation window after a timeout; covers the request's late-reply grace. */
  lateConfirmMs?: number;
}

export interface PaneCreator {
  readonly state: PaneCreationState;
  create(sessionId: string, panes: readonly PaneDescriptor[]): boolean;
  observeSnapshot(panes: readonly PaneDescriptor[]): void;
  /** A correlated reply that arrived after its request timed out; `token` is the request's. */
  lateReply(outcome: CreatedOutcome, token: number): void;
  reset(): void;
}

const PERMANENT_REFUSALS = new Set<PaneCreateRefusal>(['disabled', 'read_only', 'no_daemon']);

/**
 * Per-connection creation state. One request at a time. Refusals that describe the server
 * disable creation until reconnect. Outcomes that may follow a created window (no reply,
 * `failed`, unknown errors) lock creation while refreshed snapshots are checked for a new pane.
 */
export function createPaneCreator(deps: PaneCreatorDeps): PaneCreator {
  const attachTimeoutMs = deps.attachTimeoutMs ?? 10000;
  const confirmMs = deps.confirmMs ?? 3000;
  const lateConfirmMs = deps.lateConfirmMs ?? 10000;
  let state: PaneCreationState = { available: true, pending: false };
  let epoch = 0;
  let inFlight: AbortController | null = null;
  let pendingAttach: { paneId: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let confirming: {
    sessionId: string;
    before: Set<string>;
    outcome: PaneCreateOutcome;
    timers: ReturnType<typeof setTimeout>[];
  } | null = null;
  const surfaced = new Set<string>();
  let lastPanes: readonly PaneDescriptor[] = [];
  const set = (next: PaneCreationState): void => {
    state = next;
    deps.onChange(state);
  };
  const clearAttach = (): void => {
    if (pendingAttach) clearTimeout(pendingAttach.timer);
    pendingAttach = null;
  };
  const clearConfirm = (): void => {
    for (const timer of confirming?.timers ?? []) clearTimeout(timer);
    confirming = null;
  };
  const awaitAttach = (paneId: string, sessionLabel: string): void => {
    clearAttach();
    if (lastPanes.some((pane) => pane.id === paneId)) {
      deps.attach(paneId);
      set({ available: true, pending: false });
      return;
    }
    const token = epoch;
    set({ available: true, pending: true, reason: `Waiting for terminal ${paneId} to appear.` });
    pendingAttach = {
      paneId,
      timer: setTimeout(() => {
        if (token !== epoch || pendingAttach?.paneId !== paneId) return;
        pendingAttach = null;
        deps.notify(
          `Created terminal ${paneId}${sessionLabel}, but it has not appeared in the workspace yet. Refresh to open it.`,
        );
        set({ available: true, pending: false });
      }, attachTimeoutMs),
    };
    deps.refreshTree();
  };
  const appearedIn = (sessionId: string, before: Set<string>): PaneDescriptor[] =>
    lastPanes.filter((pane) => pane.sessionId === sessionId && !before.has(pane.id));
  const settleConfirm = (): void => {
    if (!confirming) return;
    const { sessionId, before, outcome } = confirming;
    clearConfirm();
    const appeared = appearedIn(sessionId, before);
    if (appeared.length) {
      for (const pane of appeared) surfaced.add(pane.id);
      deps.notify(
        `New terminal ${appeared.map((pane) => pane.id).join(', ')} appeared after the unconfirmed request. It was not opened automatically; choose it from the workspace.`,
      );
      set({ available: true, pending: false });
      return;
    }
    if (outcome.kind === 'uncertain') {
      const message =
        'No new terminal has appeared and the streamer did not reply. It may predate terminal creation (core 0.77.0 or later). Reconnect to try again.';
      deps.notify(message);
      set({ available: false, pending: false, reason: message });
      return;
    }
    deps.notify(`${describePaneCreateOutcome(outcome)} No new terminal appeared.`);
    set({ available: true, pending: false });
  };
  const confirm = (
    sessionId: string,
    before: Set<string>,
    outcome: PaneCreateOutcome,
    token: number,
  ): void => {
    deps.notify(
      outcome.kind === 'uncertain'
        ? describePaneCreateOutcome(outcome)
        : `${describePaneCreateOutcome(outcome)} Checking whether a terminal was created anyway.`,
    );
    clearConfirm();
    const span =
      outcome.kind === 'uncertain' && outcome.cause === 'timeout' ? lateConfirmMs : confirmMs;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let at = confirmMs / 2; at < span; at += confirmMs) {
      timers.push(
        setTimeout(() => {
          if (token === epoch) deps.refreshTree();
        }, at),
      );
    }
    timers.push(
      setTimeout(() => {
        if (token === epoch) settleConfirm();
      }, span),
    );
    confirming = { sessionId, before, outcome, timers };
    set({
      available: true,
      pending: true,
      reason: 'Confirming the previous create request before allowing another.',
    });
    deps.refreshTree();
  };
  return {
    get state() {
      return state;
    },
    create(sessionId, panes) {
      if (state.pending || !state.available) {
        if (state.reason) deps.notify(state.reason);
        return false;
      }
      const inSession = panes.filter((pane) => pane.sessionId === sessionId);
      const anchor = inSession.find((pane) => pane.active) ?? inSession[0];
      if (!anchor) {
        deps.notify('Choose a session that already has a terminal to create another.');
        return false;
      }
      const sessionLabel = anchor.sessionName ? ` in ${anchor.sessionName}` : '';
      const before = new Set(inSession.map((pane) => pane.id));
      const token = ++epoch;
      lastPanes = panes;
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      set({ available: true, pending: true, reason: 'Creating a terminal…' });
      const settled = deps.request(anchor.id, sessionId, token, controller.signal).catch(
        (error: unknown): PaneCreateOutcome => ({
          kind: 'refused',
          reason: 'unreachable',
          message: error instanceof Error ? error.message : 'The request failed.',
        }),
      );
      void settled.then((outcome) => {
        if (token !== epoch) return;
        // A timed-out request keeps listening for a late reply; reset() or the next create aborts it.
        if (outcome.kind !== 'uncertain' || outcome.cause !== 'timeout') inFlight = null;
        if (outcome.kind === 'created') {
          deps.notify(describePaneCreateOutcome(outcome, anchor.sessionName));
          awaitAttach(outcome.paneId, sessionLabel);
          return;
        }
        if (outcome.kind === 'refused' && outcome.reason === 'unreachable') {
          deps.notify(describePaneCreateOutcome(outcome));
          set({ available: true, pending: false });
          return;
        }
        if (outcome.kind === 'refused' && PERMANENT_REFUSALS.has(outcome.reason)) {
          const message = describePaneCreateOutcome(outcome);
          deps.notify(message);
          set({ available: false, pending: false, reason: message });
          return;
        }
        confirm(sessionId, before, outcome, token);
      });
      return true;
    },
    observeSnapshot(panes) {
      lastPanes = panes;
      if (pendingAttach && panes.some((pane) => pane.id === pendingAttach?.paneId)) {
        const paneId = pendingAttach.paneId;
        clearAttach();
        deps.attach(paneId);
        set({ available: true, pending: false });
        return;
      }
      if (confirming && appearedIn(confirming.sessionId, confirming.before).length) settleConfirm();
    },
    lateReply(outcome, token) {
      if (token !== epoch || surfaced.has(outcome.paneId)) return;
      if (state.pending && !confirming) return;
      clearConfirm();
      deps.notify(describePaneCreateOutcome(outcome));
      awaitAttach(outcome.paneId, '');
    },
    reset() {
      epoch += 1;
      inFlight?.abort();
      inFlight = null;
      clearAttach();
      clearConfirm();
      surfaced.clear();
      set({ available: true, pending: false });
    },
  };
}
