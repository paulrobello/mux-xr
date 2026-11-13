/**
 * Toast messages that outside programs post to the host service's `/toast` route and the headset
 * receives on `/toasts`. Shared by the server and the browser, so it has no Node or DOM imports.
 */
export const TOAST_LEVELS = ['info', 'success', 'warn', 'error'] as const;
export type ToastLevel = (typeof TOAST_LEVELS)[number];

export const TOAST_PLACEMENTS = ['top', 'center', 'bottom', 'hud', 'pane'] as const;
export type ToastPlacement = (typeof TOAST_PLACEMENTS)[number];

export const TOAST_MESSAGE_MAX = 280;
export const TOAST_TITLE_MAX = 60;
export const TOAST_SOURCE_MAX = 40;
export const TOAST_ID_MAX = 64;
export const TOAST_PANE_ID_MAX = 64;
/** Longest timed toast, in seconds; 0 keeps a toast until it is dismissed. */
export const TOAST_TIMEOUT_MAX = 3600;

/** Seconds a toast stays when the sender gives no timeout. */
export const TOAST_DEFAULT_TIMEOUT: Record<ToastLevel, number> = {
  info: 6,
  success: 6,
  warn: 10,
  error: 15,
};

/** Accent colors per level, from the app's state palette (cyan, green, amber, coral). */
export const TOAST_LEVEL_COLORS: Record<ToastLevel, string> = {
  info: '#5ad1e6',
  success: '#6ee7a8',
  warn: '#f2b84b',
  error: '#ff7a6b',
};

export interface Toast {
  /** Sender-chosen or generated; a toast with an existing id replaces that toast. */
  id: string;
  message: string;
  title: string | null;
  level: ToastLevel;
  /** `#rrggbb` accent; the level color unless the sender overrides it. */
  color: string;
  /** Seconds on screen; 0 means until dismissed. */
  timeout: number;
  placement: ToastPlacement;
  /** For `pane` placement: the pane to sit above; null means the selected pane. */
  paneId: string | null;
  source: string | null;
}

export type ToastEnvelope =
  /** `replay` marks a toast resent to a headset that just subscribed; it gets no cue or feed row. */
  { type: 'toast'; toast: Toast; replay?: boolean } | { type: 'dismiss'; id: string };

export type ToastParseResult = { ok: true; value: ToastEnvelope } | { ok: false; error: string };

const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9._:-]+$/;
// par-mux pane ids look like `%12`.
const PANE_ID = /^[A-Za-z0-9._:%$@+-]+$/;
// C0/C1 controls (newline and tab excepted) and bidi overrides never reach a label.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the controls are what it strips.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

const clean = (value: string): string => value.replace(CONTROL, '').replace(/\t/g, ' ').trim();

const optionalText = (
  body: Record<string, unknown>,
  key: string,
  max: number,
): { ok: true; value: string | null } | { ok: false; error: string } => {
  const value = body[key];
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${key} must be a string` };
  const text = clean(value);
  if ([...text].length > max)
    return { ok: false, error: `${key} is longer than ${max} characters` };
  return { ok: true, value: text || null };
};

const identifier = (
  value: unknown,
  key: string,
  max: number,
  pattern = ID,
): string | null | Error => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value || value.length > max || !pattern.test(value))
    return new Error(
      `${key} must be 1-${max} letters, digits or ${pattern === ID ? "'.', '_', ':', '-'" : "'.', '_', ':', '%', '$', '@', '+', '-'"}`,
    );
  return value;
};

/**
 * Validates a sender's toast request. `dismiss: true` with an `id` clears that toast; anything
 * else needs a message. `makeId` supplies the id when the sender gives none.
 */
export function parseToastRequest(body: unknown, makeId: () => string): ToastParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { ok: false, error: 'body must be a JSON object' };
  const data = body as Record<string, unknown>;
  const id = identifier(data.id, 'id', TOAST_ID_MAX);
  if (id instanceof Error) return { ok: false, error: id.message };
  if (data.dismiss !== undefined && typeof data.dismiss !== 'boolean')
    return { ok: false, error: 'dismiss must be true or false' };
  if (data.dismiss === true) {
    if (!id) return { ok: false, error: 'dismiss needs the id of the toast to clear' };
    return { ok: true, value: { type: 'dismiss', id } };
  }
  if (typeof data.message !== 'string') return { ok: false, error: 'message is required' };
  const message = clean(data.message);
  if (!message) return { ok: false, error: 'message is empty' };
  if ([...message].length > TOAST_MESSAGE_MAX)
    return { ok: false, error: `message is longer than ${TOAST_MESSAGE_MAX} characters` };
  const title = optionalText(data, 'title', TOAST_TITLE_MAX);
  if (!title.ok) return title;
  const source = optionalText(data, 'source', TOAST_SOURCE_MAX);
  if (!source.ok) return source;
  const level = data.level ?? 'info';
  if (!TOAST_LEVELS.includes(level as ToastLevel))
    return { ok: false, error: `level must be one of ${TOAST_LEVELS.join(', ')}` };
  const placement = data.placement ?? 'top';
  if (!TOAST_PLACEMENTS.includes(placement as ToastPlacement))
    return { ok: false, error: `placement must be one of ${TOAST_PLACEMENTS.join(', ')}` };
  const color = data.color ?? null;
  if (color !== null && (typeof color !== 'string' || !COLOR.test(color)))
    return { ok: false, error: 'color must be #rrggbb' };
  const timeout = data.timeout ?? TOAST_DEFAULT_TIMEOUT[level as ToastLevel];
  if (
    typeof timeout !== 'number' ||
    !Number.isFinite(timeout) ||
    timeout < 0 ||
    timeout > TOAST_TIMEOUT_MAX
  )
    return { ok: false, error: `timeout must be 0-${TOAST_TIMEOUT_MAX} seconds (0 keeps it)` };
  const paneId = identifier(data.paneId, 'paneId', TOAST_PANE_ID_MAX, PANE_ID);
  if (paneId instanceof Error) return { ok: false, error: paneId.message };
  return {
    ok: true,
    value: {
      type: 'toast',
      toast: {
        id: id ?? makeId(),
        message,
        title: title.value,
        level: level as ToastLevel,
        color: (color ?? TOAST_LEVEL_COLORS[level as ToastLevel]).toLowerCase(),
        timeout,
        placement: placement as ToastPlacement,
        paneId,
        source: source.value,
      },
    },
  };
}

/** The headset's check of a pushed envelope; it re-validates rather than trusting the socket. */
export function parseToastEnvelope(message: unknown): ToastEnvelope | null {
  const data = message as { type?: unknown; id?: unknown; toast?: unknown; replay?: unknown };
  if (data?.type === 'dismiss') {
    const id = identifier(data.id, 'id', TOAST_ID_MAX);
    return typeof id === 'string' ? { type: 'dismiss', id } : null;
  }
  if (data?.type !== 'toast' || !data.toast || typeof data.toast !== 'object') return null;
  const toast = data.toast as Record<string, unknown>;
  if (typeof toast.id !== 'string') return null;
  const parsed = parseToastRequest({ ...toast }, () => '');
  if (!parsed.ok || parsed.value.type !== 'toast' || !parsed.value.toast.id) return null;
  return data.replay === true ? { ...parsed.value, replay: true } : parsed.value;
}
