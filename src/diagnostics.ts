/**
 * Client-side diagnostics log: errors the caller recovers from, uncaught errors and unhandled
 * rejections land in a fixed-size ring an in-headset widget lists and a browser button copies.
 * Pass only a static scope and the error to any of this module's entry points: never clipboard
 * contents, dictated or pasted text, request bodies, secrets or paths.
 */

/** One stored report. `at` is a wall-clock millisecond timestamp; `count` collapses repeats. */
export type DiagnosticEntry = {
  at: number;
  scope: string;
  name: string;
  message: string;
  count: number;
};

/** Reports the ring keeps, oldest at the end. */
export const DIAGNOSTIC_CAPACITY = 200;

/** Stored messages are truncated to this many characters, after redaction. */
const MESSAGE_LIMIT = 200;

/**
 * Token-like runs of base64, base64url or hex characters, including their padding and separators,
 * are replaced with `[redacted]` before anything is stored.
 */
const TOKEN_RUN = /[A-Za-z0-9+/=_-]{24,}/g;

/** Removes the query string and fragment from an embedded http(s) URL. */
const EMBEDDED_URL = /(https?:\/\/[^\s?#]+)[?#]\S*/g;

/**
 * Best-effort redaction of anything that looks like a URL or a token. It cannot undo a secret a
 * caller already embedded in `error.message`, which is why callers must still pass only a static
 * scope and the error object itself.
 */
export const redact = (message: string): string => {
  let stripped = message;
  try {
    const url = new URL(stripped);
    stripped = `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    stripped = stripped.replace(EMBEDDED_URL, '$1');
  }
  return stripped.replace(TOKEN_RUN, '[redacted]');
};

const truncate = (message: string): string =>
  Array.from(message).length <= MESSAGE_LIMIT
    ? message
    : `${Array.from(message)
        .slice(0, MESSAGE_LIMIT - 1)
        .join('')}…`;

const ring: DiagnosticEntry[] = [];
const listeners = new Set<() => void>();

/**
 * Stores one report in the ring, newest first. A report matching the newest entry in scope, name
 * and message bumps that entry's `count` and refreshes its `at` instead of adding a row, so a
 * failure repeating every frame cannot flood the ring. Redaction is best-effort: callers must
 * never pass clipboard text, dictated text, pasted text, request bodies or secrets.
 */
const report = (scope: string, error: unknown): void => {
  const name = error instanceof Error ? error.name : '';
  const message = truncate(redact(error instanceof Error ? error.message : String(error)));
  const at = Date.now();
  const newest = ring[0];
  if (
    newest &&
    newest.scope === scope &&
    newest.name === name &&
    newest.message === message &&
    newest.count < Number.MAX_SAFE_INTEGER
  ) {
    newest.count += 1;
    newest.at = at;
  } else {
    ring.unshift({ at, scope, name, message, count: 1 });
    if (ring.length > DIAGNOSTIC_CAPACITY) ring.length = DIAGNOSTIC_CAPACITY;
  }
  for (const listener of listeners) listener();
};

/** The stored reports, newest first. Treat the array as read-only. */
const entries = (): readonly DiagnosticEntry[] => ring;

/** Empties the ring and notifies subscribers. */
const clear = (): void => {
  if (!ring.length) return;
  ring.length = 0;
  for (const listener of listeners) listener();
};

/** Subscribes to every report and clear; returns the unsubscribe function. */
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const diagnostics = { report, entries, clear, subscribe };

/** Leaves a trace for an error the caller recovers from, in the console and the diagnostics log. */
export const reportSwallowed = (scope: string, error: unknown): void => {
  diagnostics.report(scope, error);
  console.debug(`[mux-xr] ${scope}`, error);
};

/** Server code logs the error class only, because messages can carry file paths. */
export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'unknown';

/** A `.catch` handler that reports the error and resolves to `fallback`. */
export const swallowTo =
  <T>(scope: string, fallback: T) =>
  (error: unknown): T => {
    reportSwallowed(scope, error);
    return fallback;
  };
